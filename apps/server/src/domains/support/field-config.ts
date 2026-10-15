import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { components } from '@workspace/api-client/types'

export type FieldDefinition = components['schemas']['FeedbackFieldDefinition']
export const FIELD_IDS = {
  type: '4c3befc0-5146-43a2-8610-86efe4e8124a',
  department: '9b3d2027-2162-42e2-81b9-d907592cdb5b',
  largeFile: '4f7eb8a3-5de7-4f3b-87bb-8be5dc2d573f',
} as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseFieldDefinition(input: unknown, id: string, expectedType: FieldDefinition['type']): FieldDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid support field')
  const f = input as Record<string, unknown>
  if (f.id !== id || f.type !== expectedType || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 255 || (f.required !== undefined && typeof f.required !== 'boolean')) throw new Error('Invalid support field')
  const config = f.type_config
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid support field')
  const raw = (config as Record<string, unknown>).options
  const options: FieldDefinition['type_config']['options'] = []
  if (expectedType === 'drop_down') {
    if (!Array.isArray(raw) || raw.length > 500 || raw.length === 0) throw new Error('Invalid support field')
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid support field')
      const option = item as Record<string, unknown>
      const index = Number(option.orderindex)
      if (typeof option.id !== 'string' || !uuid.test(option.id) || typeof option.name !== 'string' || !option.name.trim() || option.name.length > 255 || !Number.isSafeInteger(index) || index < 0 || index > 500 || (option.color !== undefined && option.color !== null && (typeof option.color !== 'string' || option.color.length > 32))) throw new Error('Invalid support field')
      options.push({ id: option.id, name: option.name, color: typeof option.color === 'string' ? option.color : null, orderindex: index })
    }
    if (new Set(options.map(o => o.id)).size !== options.length || new Set(options.map(o => o.orderindex)).size !== options.length) throw new Error('Invalid support field')
    options.sort((a, b) => a.orderindex - b.orderindex)
  }
  return { id, name: f.name, type: expectedType, required: f.required === true, type_config: { options } }
}

export function loadFieldDefinitions(): FieldDefinition[] {
  const own = fileURLToPath(import.meta.url)
  const directory = dirname(own)
  const built = own.replaceAll('\\', '/').includes('/dist/')
  const base = built ? resolve(directory, '../../clickup-fields') : resolve(directory, '../../../../web/public/clickups/fields')
  return ([['type', 'drop_down'], ['department', 'drop_down'], ['largeFile', 'text']] as const).flatMap(([key, type]) => {
    const id = FIELD_IDS[key]
    try { return [parseFieldDefinition(JSON.parse(readFileSync(resolve(base, `${id}.json`), 'utf8')) as unknown, id, type)] }
    catch { return [] }
  })
}
