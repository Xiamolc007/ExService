import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const definitions = [
  ['4c3befc0-5146-43a2-8610-86efe4e8124a', 'drop_down'],
  ['9b3d2027-2162-42e2-81b9-d907592cdb5b', 'drop_down'],
  ['4f7eb8a3-5de7-4f3b-87bb-8be5dc2d573f', 'text'],
]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(id) { throw new Error(`Invalid support field ${id}`) }

/** Matches the runtime field parser's accepted ID, type and option constraints. */
export function validateSupportField(value, id, type) {
  if (!object(value) || value.id !== id || value.type !== type || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 255 || (value.required !== undefined && typeof value.required !== 'boolean') || !object(value.type_config)) invalid(id)
  if (type !== 'drop_down') return
  const options = value.type_config.options
  if (!Array.isArray(options) || options.length === 0 || options.length > 500) invalid(id)
  const ids = new Set(), indexes = new Set()
  for (const option of options) {
    if (!object(option)) invalid(id)
    const index = Number(option.orderindex)
    if (typeof option.id !== 'string' || !uuid.test(option.id) || typeof option.name !== 'string' || !option.name.trim() || option.name.length > 255 || !Number.isSafeInteger(index) || index < 0 || index > 500 || (option.color !== undefined && option.color !== null && (typeof option.color !== 'string' || option.color.length > 32)) || ids.has(option.id) || indexes.has(index)) invalid(id)
    ids.add(option.id); indexes.add(index)
  }
}

export function copySupportFields(source, target) {
  // Validation completes for all three fields before creating the target directory.
  for (const [id, type] of definitions) validateSupportField(JSON.parse(readFileSync(resolve(source, `${id}.json`), 'utf8')), id, type)
  mkdirSync(target, { recursive: true })
  for (const [id] of definitions) copyFileSync(resolve(source, `${id}.json`), resolve(target, `${id}.json`))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copySupportFields(resolve(root, 'apps/web/public/clickups/fields'), resolve(root, 'apps/server/dist/clickup-fields'))
}
