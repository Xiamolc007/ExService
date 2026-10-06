import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Foundation } from '../docs-integration/foundation.mjs'
import { atomicJson, readJson, LocalError } from '../docs-integration/local-config.mjs'
import { acquireLock } from '../docs-integration/ownership.mjs'
import { localOwnershipCheck, localRecovery, preparedState, foundationReady, verifyFoundationSchemas } from '../docs-integration/local-dev.mjs'
import { validateReceipt } from './configuration.mjs'

const services = ['postgres', 'redis', 'hydra']
function dependencyLock(state, foundation, acquire, recover = false) {
  try {
    return acquire({ mode: 'local', fingerprint: state.fingerprint, directory: join(state.workspace, '.local/docs-integration'),
      externalCheck: localOwnershipCheck(state, foundation),
      ...(recover ? { recoverCleanup: prior => ({ recovery: localRecovery(state, prior) }) } : {}) })
  } catch (error) {
    if (['MODE_ACTIVE', 'MODE_CHILDREN_STILL_ACTIVE'].includes(error.code)) throw new LocalError('APPLICATIONS_ACTIVE', 'Ctrl+C in the dev terminal')
    throw error
  }
}
function save(state, lock, foundation, status, extra = {}) {
  const value = { version: 1, mode: 'local', fingerprint: state.fingerprint, runId: lock.record.runId,
    identity: lock.record.identity, state: status, volumes: foundation.verifyVolumes(), resources: foundation.snapshot(), ...extra }
  atomicJson(join(state.directory, 'dependencies.json'), value); lock.update({ state: status, resources: value.resources, ...extra })
}
/** Starts only prepared dependencies; a failed start preserves previously running IDs. */
export async function startDependencies(state, { foundation = new Foundation(state), acquire = acquireLock,
  ready = async (state, foundation) => { await foundationReady(state, foundation); await verifyFoundationSchemas(state) },
  prepared = preparedState, validate = validateReceipt } = {}) {
  validate(state)
  const volumes = prepared(state).volumes, file = join(state.directory, 'dependencies.json')
  if (existsSync(file) && !['dependencies-ready', 'stopped'].includes(readJson(file).state))
    throw new LocalError('DEPENDENCY_CLEANUP_REQUIRED', 'pnpm service:stop')
  const lock = dependencyLock(state, foundation, acquire)
  try {
    foundation.preflight(true, volumes)
    save(state, lock, foundation, 'starting', { cleanupRequired: true })
    await foundation.start(services, { onChange: () => save(state, lock, foundation, 'starting', { cleanupRequired: true }) })
    await ready(state, foundation)
    save(state, lock, foundation, 'dependencies-ready', { cleanupRequired: false }); lock.release()
  } catch (error) {
    try { await foundation.stopStarted(); save(state, lock, foundation, 'start-failed', { cleanupRequired: true }) }
    catch { try { lock.update({ state: 'cleanup-failed', cleanupRequired: true }) } catch {} }
    throw error
  }
}
/** Stops the complete proven dependency set; volumes and container files remain. */
export async function stopDependencies(state, { foundation = new Foundation(state), acquire = acquireLock,
  prepared = preparedState, recovery = localRecovery, validate = validateReceipt } = {}) {
  validate(state)
  const volumes = prepared(state).volumes, lock = dependencyLock(state, foundation, acquire, true)
  try {
    const history = recovery(state, lock.record.recovery)
    foundation.restore(history.resources, volumes)
    // Both preparation and start-owned dependencies are owned by the root stop action.
    for (const [id, item] of foundation.preRunning) foundation.started.set(id, item)
    foundation.preRunning.clear()
    save(state, lock, foundation, 'stopping', { cleanupRequired: true })
    await foundation.stopStarted()
    foundation.verifyStopped()
    save(state, lock, foundation, 'stopped', { cleanupRequired: false }); lock.release()
  } catch (error) {
    try { save(state, lock, foundation, 'cleanup-failed', { cleanupRequired: true }) } catch {}
    throw error
  }
}
