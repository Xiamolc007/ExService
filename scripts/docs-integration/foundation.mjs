import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { digest, LocalError, localEnvironments } from './local-config.mjs'

/** All Docker calls use argv and captured output; secrets/SQL never enter error text. */
export function docker(args, { environment = process.env, cwd, runner = spawnSync, allowFailure = false } = {}) {
  const result = runner('docker', args, { cwd, env: environment, encoding: 'utf8', shell: false, windowsHide: true })
  if (!allowFailure && result.status !== 0) throw new LocalError('LOCAL_DOCKER_FAILED', 'check Docker; then retry the explicit preparation command')
  return result
}
export class Foundation {
  constructor(state, { runner = spawnSync, project = 'exwebsite-local-dev', file = 'compose.local-dev.yaml', environment,
    overlays, envFile, fingerprint = state.fingerprint } = {}) {
    this.state = state; this.runner = runner; this.project = project; this.fingerprint = fingerprint
    this.environment = environment ?? localEnvironments(state).compose
    this.arguments = ['compose', '--project-name', project, ...(envFile ? ['--env-file', envFile] : []),
      ...[file, ...(overlays ?? [])].flatMap(path => ['-f', path])]
    this.started = new Map(); this.preRunning = new Map(); this.createdStopped = new Map(); this.proofs = new Map(); this.expected = undefined
  }
  call(args, allowFailure = false) {
    return docker(args, { cwd: this.state.workspace, environment: this.environment, runner: this.runner, allowFailure })
  }
  compose(args, allowFailure = false) { return this.call([...this.arguments, ...args], allowFailure) }
  inspect(id) {
    const result = this.call(['inspect', id], true)
    if (result.status !== 0) {
      // An inspection error is not evidence of absence. Labels may have changed,
      // so only a successful global inventory can prove absence. Names are
      // needed for managed oneoff pre-creation checks and pure-hex ambiguity.
      if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new LocalError('DOCKER_INVENTORY_INVALID')
      const inventory = this.call(['ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'])
      if (typeof inventory.stdout !== 'string') throw new LocalError('DOCKER_INVENTORY_INVALID')
      const rows = inventory.stdout.trim() ? inventory.stdout.trim().split(/\r?\n/).map(value => value.split(' ')) : []
      if (rows.some(value => value.length !== 2 || !/^[a-f0-9]{64}$/.test(value[0]) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value[1])) ||
          new Set(rows.map(value => value[0])).size !== rows.length || new Set(rows.map(value => value[1])).size !== rows.length)
        throw new LocalError('DOCKER_INVENTORY_INVALID')
      if (rows.some(([actualId, name]) => name === id || (/^[a-f0-9]{12,64}$/i.test(id) && actualId.startsWith(id.toLowerCase()))))
        throw new LocalError('DOCKER_INSPECTION_FAILED')
      return null
    }
    try {
      const actual = JSON.parse(result.stdout)[0]
      if (!actual?.Id) throw new Error()
      return actual
    } catch { throw new LocalError('DOCKER_INSPECTION_INVALID') }
  }
  configuration({ preparation = false } = {}) {
    const property = preparation ? 'preparationExpected' : 'expected'
    if (!this[property]) {
      try { this[property] = JSON.parse(this.compose([...(preparation ? ['--profile', 'preparation'] : []), 'config', '--format', 'json']).stdout) }
      catch { throw new LocalError('COMPOSE_CONFIGURATION_INVALID') }
    }
    return this[property]
  }
  ids() {
    return this.call(['ps', '-a', '--filter', `label=com.docker.compose.project=${this.project}`, '--format', '{{.ID}}']).stdout.trim().split(/\r?\n/).filter(Boolean)
  }
  containers() { return this.ids().map(id => this.inspect(id)).filter(Boolean) }
  hash(service) {
    const value = this.compose(['config', '--hash', service]).stdout.trim().split(/\s+/).at(-1)
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new LocalError('COMPOSE_HASH_UNAVAILABLE')
    return value
  }
  verifyContainer(container, service) {
    const original = this.proofs.get(container.Id)
    if (original) this.verifyRecordedContainer(container, original)
    const expected = this.configuration().services[service], labels = container.Config.Labels ?? {}
    if (!expected || labels['com.docker.compose.project'] !== this.project || labels['com.docker.compose.service'] !== service ||
        labels['com.docker.compose.oneoff']?.toLowerCase() !== 'false' || labels['com.docker.compose.config-hash'] !== this.hash(service))
      throw new LocalError('CONTAINER_OWNERSHIP_CONFLICT', 'inspect the named Compose project manually; no foreign resources were stopped')
    if (this.project === 'exwebsite-local-dev' || this.project.startsWith('exwebsite-local-test-')) {
      const images = JSON.parse(readFileSync(resolve(this.state.workspace, 'infra/docs-integration/images.lock.json'), 'utf8'))
      if (expected.image !== images[service] || container.Config.Image !== images[service] || labels['dev.exwebsite.config'] !== this.fingerprint)
        throw new LocalError('CONTAINER_IMAGE_CONFIG_CONFLICT')
      const image = this.call(['image', 'inspect', images[service]])
      if (container.Image !== JSON.parse(image.stdout)[0].Id) throw new LocalError('CONTAINER_IMAGE_CONFIG_CONFLICT')
      const variables = Object.fromEntries(container.Config.Env.map(item => { const i = item.indexOf('='); return [item.slice(0, i), item.slice(i + 1)] }))
      for (const [key, value] of Object.entries(expected.environment ?? {})) if (variables[key] !== String(value))
        throw new LocalError('CONTAINER_ENVIRONMENT_CONFLICT')
      const actualPorts = container.HostConfig.PortBindings ?? {}, wantedPorts = {}
      for (const binding of expected.ports ?? []) {
        const key = `${binding.target}/${binding.protocol || 'tcp'}`
        wantedPorts[key] ??= []; wantedPorts[key].push({ HostIp: binding.host_ip, HostPort: String(binding.published) })
      }
      if (digest(actualPorts) !== digest(wantedPorts)) throw new LocalError('CONTAINER_PORT_CONFLICT')
      for (const volume of expected.volumes ?? []) {
        const actual = container.Mounts.find(item => item.Destination === volume.target)
        if (!actual || actual.Type !== volume.type ||
            (volume.type === 'volume' && actual.Name !== this.configuration().volumes[volume.source].name) ||
            (volume.type === 'bind' && normalizeMount(actual.Source) !== normalizeMount(volume.source)))
          throw new LocalError('CONTAINER_VOLUME_CONFLICT')
      }
    }
    if (!original) this.proofs.set(container.Id, this.containerProof(container))
    return container
  }
  containerProof(container) {
    return { id: container.Id, service: container.Config.Labels['com.docker.compose.service'],
      digest: digest({ image: container.Image, config: container.Config, hostConfig: container.HostConfig,
        mounts: [...container.Mounts].sort((left, right) => left.Destination.localeCompare(right.Destination)) }) }
  }
  verifyRecordedContainer(container, proof) {
    const labels = container.Config.Labels ?? {}
    if (!proof || labels['com.docker.compose.project'] !== this.project || labels['com.docker.compose.oneoff']?.toLowerCase() !== 'false' ||
        digest(this.containerProof(container)) !== digest(proof)) throw new LocalError('STOPPED_CONTAINER_OWNERSHIP_CONFLICT')
  }
  verifyVolumes(required = true) {
    const identities = []
    const volumes = this.configuration().volumes ?? {}
    for (const [name, volume] of Object.entries(volumes)) {
      const result = this.call(['volume', 'inspect', volume.name], true)
      if (result.status !== 0) {
        if (required) throw new LocalError('LOCAL_VOLUME_MISSING', 'pnpm integration:init -- --mode local')
        const inventory = this.call(['volume', 'ls', '--format', '{{.Name}}'])
        if (typeof inventory.stdout !== 'string') throw new LocalError('DOCKER_VOLUME_INVENTORY_INVALID')
        const names = inventory.stdout.trim() ? inventory.stdout.trim().split(/\r?\n/) : []
        if (names.some(name => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) || new Set(names).size !== names.length)
          throw new LocalError('DOCKER_VOLUME_INVENTORY_INVALID')
        if (names.includes(volume.name)) throw new LocalError('DOCKER_VOLUME_INSPECTION_FAILED')
        continue
      }
      const actual = JSON.parse(result.stdout)[0], labels = actual.Labels ?? {}
      if (labels['com.docker.compose.project'] !== this.project || labels['com.docker.compose.volume'] !== name ||
          ((this.project === 'exwebsite-local-dev' || this.project.startsWith('exwebsite-local-test-')) && labels['dev.exwebsite.config'] !== this.fingerprint))
        throw new LocalError('LOCAL_VOLUME_OWNERSHIP_CONFLICT', 'explicitly prepare a separate target; existing volumes were preserved')
      identities.push({ name: actual.Name, createdAt: actual.CreatedAt, labels })
    }
    if (this.restoredVolumes) {
      for (const original of this.restoredVolumes.volumes) if (!identities.some(actual => actual.name === original.name && digest(actual) === digest(original)))
        throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
      if (!this.restoredVolumes.partial && digest(identities) !== digest(this.restoredVolumes.volumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
    }
    return identities
  }
  verifyVolumeInventory() {
    const result = this.call(['volume', 'ls', '--filter', `label=com.docker.compose.project=${this.project}`, '--format', '{{.Name}}'])
    if (typeof result.stdout !== 'string') throw new LocalError('DOCKER_VOLUME_INVENTORY_INVALID')
    const names = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/) : []
    if (names.some(name => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) || new Set(names).size !== names.length)
      throw new LocalError('DOCKER_VOLUME_INVENTORY_INVALID')
    const expected = new Set(Object.values(this.configuration().volumes ?? {}).map(volume => volume.name))
    if (names.some(name => !expected.has(name))) throw new LocalError('LOCAL_VOLUME_OWNER_UNKNOWN')
  }
  preflight(requiredVolumes = true, preparedVolumes) {
    const identities = this.verifyVolumes(requiredVolumes)
    if (preparedVolumes && digest(identities) !== digest(preparedVolumes))
      throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED', 'explicitly inspect and prepare the replacement target; no containers were started')
    for (const container of this.containers()) {
      const service = container.Config.Labels?.['com.docker.compose.service']
      if (container.Config.Labels?.['com.docker.compose.oneoff']?.toLowerCase() === 'true') {
        if (container.State.Running) throw new LocalError('PREPARATION_CONTAINER_ACTIVE')
        continue
      }
      this.verifyContainer(container, service)
      if (container.State.Running) this.preRunning.set(container.Id, { service, id: container.Id })
    }
  }
  async start(services, { onChange = () => {} } = {}) {
    for (const service of services) {
      const previous = this.containers().find(container => container.Config.Labels['com.docker.compose.service'] === service &&
        container.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'false')
      if (previous) this.verifyContainer(previous, service)
      const before = new Set(this.containers().map(container => container.Id))
      let result
      try { result = this.compose(['up', '-d', '--no-deps', '--no-recreate', service], true) }
      finally {
        // Capture exact new IDs even when Docker created but never started them,
        // or they ran and exited before the first running sample.
        const actual = this.containers().filter(container => container.Config.Labels['com.docker.compose.service'] === service &&
          container.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() === 'false')
        if (actual.filter(container => !before.has(container.Id)).length > 1) throw new LocalError('FOUNDATION_CREATED_IDENTITY_AMBIGUOUS')
        for (const container of actual) {
          this.verifyContainer(container, service)
          if (this.preRunning.has(container.Id)) continue
          if (container.State.Running || Date.parse(container.State.StartedAt) > 0) {
            this.started.set(container.Id, { service, id: container.Id }); this.createdStopped.delete(container.Id)
          } else if (!before.has(container.Id)) this.createdStopped.set(container.Id, { service, id: container.Id })
        }
        onChange(this.snapshot())
      }
      if (!result || result.status !== 0) throw new LocalError('FOUNDATION_START_FAILED')
      if (service === 'postgres') await this.waitPostgres()
    }
  }
  snapshot() { return { preRunning: [...this.preRunning.values()], started: [...this.started.values()], createdStopped: [...this.createdStopped.values()],
    containerProofs: [...new Set([...this.started.keys(), ...this.preRunning.keys(), ...this.createdStopped.keys()])].map(id => this.proofs.get(id)).filter(Boolean) } }
  restore(resources, preparedVolumes, { partial = false } = {}) {
    if (!resources || !Array.isArray(resources.started) || !Array.isArray(resources.preRunning) || !Array.isArray(resources.containerProofs))
      throw new LocalError('FOUNDATION_JOURNAL_INVALID')
    const started = new Map(resources.started.map(item => [item.id, item])), preRunning = new Map(resources.preRunning.map(item => [item.id, item]))
    if (resources.createdStopped && !Array.isArray(resources.createdStopped)) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
    const createdStopped = new Map((resources.createdStopped ?? []).map(item => [item.id, item]))
    const proofs = new Map(resources.containerProofs.map(item => [item.id, item]))
    if (partial) this.verifyVolumeInventory()
    if (digest(this.verifyVolumes(!partial)) !== digest(preparedVolumes)) throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
    for (const item of [...started.values(), ...preRunning.values(), ...createdStopped.values()]) {
      if (!item.id || !item.service || !proofs.has(item.id) || proofs.get(item.id).service !== item.service)
        throw new LocalError('FOUNDATION_JOURNAL_INVALID')
      const actual = this.inspect(item.id)
      if (actual) {
        this.verifyRecordedContainer(actual, proofs.get(item.id))
        if (createdStopped.has(item.id) && (actual.State.Running || Date.parse(actual.State.StartedAt) > 0)) throw new LocalError('FOUNDATION_CREATED_STATE_CHANGED')
      }
    }
    for (const actual of this.containers()) {
      if (!started.has(actual.Id) && !preRunning.has(actual.Id) && !createdStopped.has(actual.Id)) throw new LocalError('FOUNDATION_OWNER_UNKNOWN')
      this.verifyRecordedContainer(actual, proofs.get(actual.Id))
      this.verifyContainer(actual, actual.Config.Labels['com.docker.compose.service'])
    }
    this.started = started; this.preRunning = preRunning; this.createdStopped = createdStopped; this.proofs = proofs
    this.restoredVolumes = { volumes: preparedVolumes, partial }
  }
  retireCreatedStopped(resources, volumes, options) {
    this.restore(resources, volumes, options)
    for (const { id } of this.createdStopped.values()) {
      const actual = this.inspect(id)
      if (!actual) continue
      this.verifyRecordedContainer(actual, this.proofs.get(id))
      if (actual.State.Running || Date.parse(actual.State.StartedAt) > 0) throw new LocalError('FOUNDATION_CREATED_STATE_CHANGED')
      this.call(['rm', id]) // exact proven never-started ID, non-force, no volumes
    }
    this.createdStopped.clear()
  }
  async waitPostgres() {
    for (let count = 0; count < 60; count++) {
      // The entrypoint's initialization server accepts Unix sockets before init scripts finish.
      if (this.compose(['exec', '-T', 'postgres', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], true).status === 0) return
      await delay(500)
    }
    throw new LocalError('LOCAL_POSTGRES_NOT_READY')
  }
  async stopStarted() {
    // Validate the complete set before the first mutation; preflight must never
    // replace historical proof with a new sample and authorize a changed ID.
    if (this.restoredVolumes && digest(this.verifyVolumes(!this.restoredVolumes.partial)) !== digest(this.restoredVolumes.volumes))
      throw new LocalError('LOCAL_VOLUME_IDENTITY_CHANGED')
    const known = new Map([...this.started, ...this.preRunning, ...this.createdStopped])
    for (const container of this.containers()) if (!known.has(container.Id)) throw new LocalError('FOUNDATION_OWNER_UNKNOWN')
    for (const { id } of known.values()) {
      const actual = this.inspect(id)
      if (!this.proofs.has(id)) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
      if (actual) this.verifyRecordedContainer(actual, this.proofs.get(id))
      if (actual && this.createdStopped.has(id) && (actual.State.Running || Date.parse(actual.State.StartedAt) > 0)) throw new LocalError('FOUNDATION_CREATED_STATE_CHANGED')
    }
    for (const { id, service } of [...this.started.values()].reverse()) {
      const actual = this.inspect(id)
      if (!actual || !actual.State.Running) continue
      const recorded = this.proofs.get(id)
      if (recorded) this.verifyRecordedContainer(actual, recorded)
      const before = this.containerProof(actual)
      this.verifyContainer(actual, service)
      this.call(['stop', '--time', '10', id])
      const stopped = this.inspect(id)
      if (stopped) {
        this.verifyRecordedContainer(stopped, before); this.verifyContainer(stopped, service)
        if (stopped.State?.Running !== false) throw new LocalError('FOUNDATION_STOP_INCOMPLETE')
      }
    }
    this.verifyStopped()
  }
  verifyStopped() {
    // A successful stop response is not a stopped-state receipt. Recheck the
    // complete owned set: an earlier item can restart while a later one stops.
    for (const { id } of [...this.started.values(), ...this.createdStopped.values()]) {
      const proof = this.proofs.get(id)
      if (!proof) throw new LocalError('FOUNDATION_JOURNAL_INVALID')
      const actual = this.inspect(id)
      if (!actual) continue // inspect proves absence with the full inventory
      this.verifyRecordedContainer(actual, proof)
      if (actual.State?.Running !== false) throw new LocalError('FOUNDATION_STOP_INCOMPLETE')
      if (this.createdStopped.has(id) && Date.parse(actual.State.StartedAt) > 0) throw new LocalError('FOUNDATION_CREATED_STATE_CHANGED')
    }
  }
}
function normalizeMount(path) {
  // Docker Desktop reports Windows bind mounts using its /run/desktop/mnt/host mapping.
  return String(path).replace(/^\/run\/desktop\/mnt\/host\//, '').replace(/^\/host_mnt\//, '')
    .replace(/^([A-Za-z]):[\\/]/, '$1/').replaceAll('\\', '/').toLowerCase()
}
