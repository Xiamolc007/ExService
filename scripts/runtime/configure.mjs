import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { root, localRoot } from '../docs-integration/configure.mjs'
import { atomicJson, digest, loadLocal, otherOutboxTargets, readJson, readSecrets, validateConfig, websiteEnvironment, websiteTarget, secretNames, toolchain, verifyWebsiteDatabase, LocalError } from '../docs-integration/local-config.mjs'
import { acquireLock } from '../docs-integration/ownership.mjs'
import { Foundation } from '../docs-integration/foundation.mjs'
import { localOwnershipCheck, preparedState } from '../docs-integration/local-dev.mjs'
import { environmentFile, portKeys, readRuntimeConfiguration, validateReceipt, pick, websiteKeys } from './configuration.mjs'

export function serializeEnvironment(values) {
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || typeof value !== 'string') throw new LocalError('RUNTIME_ENV_INVALID')
    // Single quotes keep dollar-containing passwords literal in both Node and Compose env parsers.
    const quote = ["'", '"', '`'].find(character => !value.includes(character))
    if (!quote) throw new LocalError(`RUNTIME_ENV_UNREPRESENTABLE_${key}`)
    const line = `${key}=${quote}${value}${quote}\n`
    if (parseEnv(line)[key] !== value) throw new LocalError(`RUNTIME_ENV_UNREPRESENTABLE_${key}`)
    return line
  }).join('')
}
const hashFile = path => existsSync(path) ? digest(readFileSync(path, 'utf8')) : null
export function receiptFor(state, id = randomUUID(), source = 'root') {
  return { version: 2, profile: state.profile, source, upgradeReceiptId: id, websiteTarget: state.config.websiteTarget,
    configurationFingerprint: state.configurationFingerprint, resourceFingerprint: state.fingerprint, resourceProjection: state.config }
}
/** Converts only complete, historically proven v1 configuration under the original mutex. */
export async function importExisting({ workspace = root, inherited = process.env, acquire = acquireLock,
  verifyDatabase = verifyWebsiteDatabase,
  verify = (state, prior) => { const foundation = new Foundation(state); localOwnershipCheck(state, foundation)(prior); foundation.preflight(true, preparedState(state).volumes) },
  checkpoint = () => {} } = {}) {
  const directory = join(workspace, '.local/docs-integration/local-dev'), file = join(directory, 'config.json'), journalPath = join(directory, 'upgrade.json')
  const previous = existsSync(journalPath) ? readJson(journalPath) : undefined
  if (previous?.state === 'committed') {
    const state = readRuntimeConfiguration({ workspace, inherited, profile: 'local' }); validateReceipt(state); return state
  }
  const backup = join(directory, 'config.v1.json'), original = existsSync(backup) ? backup : file
  const state = existsSync(backup) ? { config: validateConfig(readJson(backup), workspace, directory), secrets: readSecrets(join(directory, 'secrets.env')),
    website: websiteEnvironment(workspace, inherited), workspace, directory } : loadLocal({ workspace, directory, inherited, checkEnvironment: true })
  // A crash after config replacement is recovered from the retained original, never from new container samples.
  if (existsSync(backup)) {
    state.fingerprint = digest({ config: state.config, secrets: state.secrets })
    if (digest(websiteTarget(state.website)) !== digest(state.config.websiteTarget)) throw new LocalError('WEBSITE_TARGET_CHANGED')
  }
  const sources = { config: hashFile(original), secrets: hashFile(join(directory, 'secrets.env')), website: hashFile(join(workspace, 'apps/server/.env.local')) }
  if (previous && (previous.version !== 1 || digest(previous.sources) !== digest(sources) || previous.resourceFingerprint !== state.fingerprint))
    throw new LocalError('RUNTIME_UPGRADE_SOURCE_CHANGED')
  const lock = acquire({ mode: 'local', fingerprint: state.fingerprint, directory: join(workspace, '.local/docs-integration'), externalCheck: prior => verify(state, prior) })
  try {
    await verifyDatabase(state.website)
    const imported = { ...environmentFile(join(workspace, 'apps/server/.env.local')), ...pick(state.website, websiteKeys), ...state.secrets,
      RUNTIME_CONFIG_VERSION: '2', RUNTIME_PROFILE: 'local', PUBLIC_ORIGIN: state.config.publicOrigin,
      HYDRA_PUBLIC_URL: state.config.issuer, OUTLINE_STORAGE_DIRECTORY: state.config.storage,
      ...Object.fromEntries(Object.entries(portKeys).map(([name, key]) => [key, String(state.config.ports[name])])) }
    const targets = otherOutboxTargets('local', workspace, inherited)
    if (targets !== undefined) imported.IDENTITY_OUTBOX_TARGETS_JSON = targets
    const envPath = join(workspace, '.env.local'), existing = environmentFile(envPath)
    const conflicts = Object.keys(imported).filter(key => existing[key] !== undefined && existing[key] !== imported[key])
    if (conflicts.length) throw new LocalError(`RUNTIME_IMPORT_CONFLICT:${conflicts.sort().join(',')}`, 'resolve root .env.local keys explicitly; old files were preserved')
    const output = serializeEnvironment({ ...existing, ...imported })
    const next = readRuntimeConfiguration({ workspace, inherited: { ...existing, ...imported, ...inherited }, profile: 'local' })
    if (next.fingerprint !== state.fingerprint) throw new LocalError('RUNTIME_IMPORT_RESOURCE_CHANGED')
    const receipt = receiptFor(next, previous?.id, 'v1-import'), journal = { version: 1, id: receipt.upgradeReceiptId,
      sources, outputHash: digest(output), receiptHash: digest(receipt), resourceFingerprint: state.fingerprint, state: 'pending' }
    if (previous && (previous.outputHash !== journal.outputHash || previous.receiptHash !== journal.receiptHash)) throw new LocalError('RUNTIME_UPGRADE_OUTPUT_CHANGED')
    atomicJson(journalPath, journal); checkpoint('journal')
    if (!existsSync(backup)) writeFileSync(backup, readFileSync(file), { flag: 'wx', mode: 0o600 })
    const temporary = join(workspace, '.env.local.command-runtime.tmp')
    writeFileSync(temporary, output, { mode: 0o600 }); checkpoint('temporary')
    renameSync(temporary, envPath); checkpoint('environment')
    atomicJson(file, receipt); checkpoint('receipt')
    atomicJson(journalPath, { ...journal, state: 'committed' })
    return next
  } finally { lock.release() }
}
/** Explicit fresh configuration may fill missing document keys; never rotates existing keys. */
export async function configureRuntime({ workspace = root, inherited = process.env, validateTools = toolchain,
  verifyDatabase = verifyWebsiteDatabase, acquire = acquireLock,
  verifyOwnership = (state, prior) => localOwnershipCheck(state, new Foundation(state))(prior) } = {}) {
  const envPath = join(workspace, '.env.local'), directory = join(workspace, '.local/docs-integration/local-dev')
  const initial = readRuntimeConfiguration({ workspace, inherited, profile: 'local', allowMissingSecrets: true })
  const receiptPath = join(directory, 'config.json')
  if (existsSync(receiptPath)) {
    const saved = readJson(receiptPath)
    if (saved.version !== 2) throw new LocalError('RUNTIME_IMPORT_REQUIRED', 'pnpm infra configure --import-existing')
    // An explicit configure may adopt verified non-resource settings. It cannot change historical resource authorization.
    validateReceipt({ ...initial, configurationFingerprint: saved.configurationFingerprint }, saved)
  }
  validateTools({ workspace, inherited: { ...initial.inherited, ...initial.values } }); await verifyDatabase(initial.website)
  const values = environmentFile(envPath)
  for (const key of secretNames) if (initial.values[key] === undefined) values[key] = randomBytes(32).toString('hex')
  const next = readRuntimeConfiguration({ workspace, inherited: { ...values, ...inherited }, profile: 'local' })
  const lock = acquire({ mode: 'local', fingerprint: next.fingerprint, directory: join(workspace, '.local/docs-integration'),
    externalCheck: prior => verifyOwnership(next, prior) })
  try {
    mkdirSync(directory, { recursive: true })
    if (Object.keys(values).some(key => initial.values[key] === undefined && secretNames.includes(key))) {
      const temporary = join(workspace, '.env.local.command-runtime.tmp')
      writeFileSync(temporary, serializeEnvironment(values), { mode: 0o600 }); renameSync(temporary, envPath)
    }
    atomicJson(receiptPath, receiptFor(next)); mkdirSync(next.config.storage, { recursive: true })
    return next
  } finally { lock.release() }
}
