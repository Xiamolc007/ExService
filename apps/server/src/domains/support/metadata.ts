import type { ClickUpServices, ClickUpField, ClickUpCreateTask, ClickUpTask } from '../../modules/clickup/service.js'
import { FEEDBACK_LIMITS } from '@workspace/common/feedback-content'
import { equivalentMarkdown } from './markdown.js'
import { FeedbackError } from './errors.js'
import { FIELD_IDS, loadFieldDefinitions, type FieldDefinition } from './field-config.js'
import type { FeedbackForm, FeedbackOptions } from './validation.js'

export const TARGET = Object.freeze({
  workspace: '90181517066', list: '901810170816', space: '90185812083',
  bug: 1001, feature: 0, asset: 1009, request: 1005, content: 1007, campaign: 1008,
  status: '新增', type: FIELD_IDS.type, department: FIELD_IDS.department,
  largeFile: FIELD_IDS.largeFile, user: '346759da-1bc8-4ae7-aa0c-020102bc287b',
})
export const KINDS = ['bug', 'feature', 'asset', 'request', 'content', 'campaign'] as const
export const COMMUNITY_TARGET = Object.freeze({ workspace: TARGET.workspace, list: '1100500000004310', space: '90186006983', status: '待处理', taskType: 1003 })
export const COMMUNITY_KINDS = ['suggestion', 'complaint'] as const
export type FeedbackArea = 'development' | 'community'
export const areaOf = (kind: FeedbackForm['kind']): FeedbackArea => kind === 'suggestion' || kind === 'complaint' ? 'community' : 'development'
const targetOf = (kind: FeedbackForm['kind']) => areaOf(kind) === 'community' ? COMMUNITY_TARGET : TARGET
const taskTypeOf = (kind: FeedbackForm['kind']): number => areaOf(kind) === 'community' ? COMMUNITY_TARGET.taskType : TARGET[kind as keyof typeof TARGET] as number
const ACTION_TAG = { add: '新增', modify: '修改', delete: '删除', other: null } as const
const KNOWN_OPERATION_TAGS = Object.values(ACTION_TAG).filter((tag): tag is NonNullable<typeof tag> => tag !== null)
type Kind = FeedbackForm['kind']
export type FrozenTaskPayload = { listId: string; task: ClickUpCreateTask; fieldTypes: Array<'short_text' | 'drop_down' | 'text'> }
export function frozenTaskInput(form: FeedbackForm, markdown: string, nickname: string, userId: string): FrozenTaskPayload {
  const fieldTypes: FrozenTaskPayload['fieldTypes'] = form.kind === 'complaint' && form.anonymous ? [] : ['short_text']
  if ('typeOptionId' in form && form.typeOptionId !== null) fieldTypes.push('drop_down')
  if (form.kind === 'feature' && form.departmentOptionId !== null) fieldTypes.push('drop_down')
  if (form.largeFileInfo !== null) fieldTypes.push('text')
  return { listId: targetOf(form.kind).list, task: taskInput(form, markdown, nickname, userId), fieldTypes }
}
type MetadataState = { fields: FieldDefinition[]; remote: ClickUpField[]; types: Set<number>; tags: Set<string> }

function applicable(field: ClickUpField, kind: Kind): boolean {
  const scopes = field.applied_objects
  return !scopes || scopes.some(scope => scope.object_type === 19 && Number(scope.object_id) === taskTypeOf(kind))
}
function configured(state: MetadataState, id: string, kind: Kind): boolean {
  const local = state.fields.find(f => f.id === id)
  const remote = state.remote.filter(f => f.id === id)
  if (id === TARGET.user) return remote.length === 1 && remote[0]!.type === 'short_text' && applicable(remote[0]!, kind)
  if (!local || remote.length !== 1 || remote[0]!.type !== local.type || !applicable(remote[0]!, kind)) return false
  if (local.type !== 'drop_down') return true
  const choices = remote[0]!.type_config.options ?? []
  return local.type_config.options.every(option => choices.some(remoteOption => remoteOption.id === option.id))
}
function available(state: MetadataState, kind: Kind): boolean {
  if (kind !== 'feature' && !state.types.has(taskTypeOf(kind))) return false
  if (!configured(state, TARGET.user, kind)) return false
  if (areaOf(kind) === 'development' && kind !== 'content' && kind !== 'campaign' && !configured(state, TARGET.type, kind)) return false
  if (kind === 'feature' && !configured(state, TARGET.department, kind)) return false
  return configured(state, TARGET.largeFile, kind) && (kind !== 'suggestion' && kind !== 'complaint' || state.tags.has(kind === 'suggestion' ? '反馈' : '投诉'))
}
export function createMetadata(clickup: ClickUpServices, now: () => number, definitions: FieldDefinition[] = loadFieldDefinitions()) {
  const cache: Partial<Record<FeedbackArea, { state: MetadataState; expires: number }>> = {}
  const refresh: Partial<Record<FeedbackArea, Promise<MetadataState>>> = {}
  const read = async (area: FeedbackArea): Promise<MetadataState> => {
    if (!clickup.available) throw new FeedbackError('FEEDBACK_UNAVAILABLE')
    if (cache[area] && cache[area]!.expires > now()) return cache[area]!.state
    refresh[area] ??= (async () => {
      try {
        const target = area === 'community' ? COMMUNITY_TARGET : TARGET
        const [list, remote, types, tags] = await Promise.all([
          clickup.getList(target.list), clickup.getFields(target.list), clickup.getTaskTypes(target.workspace).catch(() => []), clickup.getSpaceTags(target.space).catch(() => []),
        ])
        if (list.id !== target.list || list.space.id !== target.space || !list.statuses.some(s => s.status === target.status)) throw new Error('Invalid target list')
        const areaDefinitions = area === 'community' ? definitions.filter(f => f.id === TARGET.largeFile) : definitions
        const ids = new Set(areaDefinitions.map(f => f.id))
        if (ids.size !== areaDefinitions.length || [...ids].some(id => !Object.values(FIELD_IDS).includes(id as typeof FIELD_IDS[keyof typeof FIELD_IDS]))) throw new Error('Invalid field definitions')
        const state = { fields: areaDefinitions, remote, types: new Set(types.map(t => t.id)), tags: new Set(tags) }
        cache[area] = { state, expires: now() + 60000 }
        return state
      } catch { delete cache[area]; throw new FeedbackError('FEEDBACK_UNAVAILABLE') }
      finally { delete refresh[area] }
    })()
    return refresh[area]
  }
  return {
    async options(area: FeedbackArea = 'development'): Promise<FeedbackOptions> {
      const kinds = area === 'community' ? COMMUNITY_KINDS : KINDS
      try {
        const state = await read(area)
        return {
          available: true, reason: null, fields: state.fields,
          kinds: kinds.map(kind => ({ kind, available: available(state, kind), reason: available(state, kind) ? null : 'configuration_invalid' })),
          actions: area === 'community' ? [] : (Object.keys(ACTION_TAG) as Array<keyof typeof ACTION_TAG>).map(action => ({ action, available: ACTION_TAG[action] === null || state.tags.has(ACTION_TAG[action]), reason: ACTION_TAG[action] === null || state.tags.has(ACTION_TAG[action]) ? null : 'tag_missing' })),
          limits: { ...FEEDBACK_LIMITS, largeFileInfoBytes: 16384 },
        }
      } catch {
        const reason = clickup.reason ?? 'upstream_unavailable'
        return { available: false, reason, fields: [], kinds: kinds.map(kind => ({ kind, available: false, reason })), actions: area === 'community' ? [] : (Object.keys(ACTION_TAG) as Array<keyof typeof ACTION_TAG>).map(action => ({ action, available: false, reason: 'tag_missing' })), limits: { ...FEEDBACK_LIMITS, largeFileInfoBytes: 16384 } }
      }
    },
    async preflight(form: FeedbackForm): Promise<void> {
      const state = await read(areaOf(form.kind))
      if (!available(state, form.kind)) throw new FeedbackError('FEEDBACK_UNAVAILABLE')
      const fields: Array<[string, string | null]> = []
      if ('typeOptionId' in form) fields.push([TARGET.type, form.typeOptionId])
      if (form.kind === 'feature') fields.push([TARGET.department, form.departmentOptionId])
      for (const [id, value] of fields) {
        if (value !== null && !state.fields.find(field => field.id === id)!.type_config.options.some(option => option.id === value)) throw new FeedbackError('FEEDBACK_INVALID_INPUT')
      }
      if ('action' in form) { const tag = ACTION_TAG[form.action]; if (tag !== null && !state.tags.has(tag)) throw new FeedbackError('FEEDBACK_UNAVAILABLE') }
    },
  }
}
export function taskInput(form: FeedbackForm, markdown: string, nickname: string, userId: string): ClickUpCreateTask {
  const custom_fields: ClickUpCreateTask['custom_fields'] = form.kind === 'complaint' && form.anonymous ? [] : [{ id: TARGET.user, value: `${nickname} (${userId})` }]
  if ('typeOptionId' in form && form.typeOptionId !== null) custom_fields.push({ id: TARGET.type, value: form.typeOptionId })
  if (form.kind === 'feature' && form.departmentOptionId !== null) custom_fields.push({ id: TARGET.department, value: form.departmentOptionId })
  if (form.largeFileInfo !== null) custom_fields.push({ id: TARGET.largeFile, value: form.largeFileInfo })
  const tag = form.kind === 'suggestion' ? '反馈' : form.kind === 'complaint' ? '投诉' : 'action' in form ? ACTION_TAG[form.action] : null
  return { name: form.title, markdown_content: markdown, custom_item_id: taskTypeOf(form.kind), status: targetOf(form.kind).status, custom_fields, tags: tag ? [tag] : [] }
}
export function matchesTask(task: ClickUpTask, frozen: FrozenTaskPayload, taskId: string): boolean {
  const expected = frozen.task
  if (task.id !== taskId || task.list.id !== frozen.listId || (task.custom_item_id ?? 0) !== expected.custom_item_id || task.name !== expected.name || task.status.status !== expected.status || !equivalentMarkdown(expected.markdown_content, task.markdown_description)) return false
  const controlled = new Set<string>([...KNOWN_OPERATION_TAGS, ...expected.tags, ...(frozen.listId === COMMUNITY_TARGET.list ? ['反馈', '投诉'] : [])])
  const actualTags = task.tags.filter(tag => controlled.has(tag))
  if (actualTags.length !== expected.tags.length || actualTags.some(tag => !expected.tags.includes(tag))) return false
  const anonymousCommunity = frozen.listId === COMMUNITY_TARGET.list && !frozen.fieldTypes.includes('short_text')
  if (anonymousCommunity && task.custom_fields.some(field => field.id === TARGET.user && (field.hasUnsupportedValue === true || field.value !== null && field.value !== undefined && field.value !== ''))) return false
  return expected.custom_fields.every((wanted, index) => {
    const fields = task.custom_fields.filter(f => f.id === wanted.id)
    if (fields.length !== 1) return false
    const field = fields[0]!
    const wantedType = frozen.fieldTypes[index]
    if (field.type !== wantedType) return false
    if (field.type !== 'drop_down') return field.value === wanted.value
    const opts = field.type_config.options ?? []
    const matching = typeof field.value === 'number'
      ? opts.filter(o => (typeof o.orderindex === 'number' || (typeof o.orderindex === 'string' && /^\d+$/.test(o.orderindex))) && Number.isSafeInteger(Number(o.orderindex)) && Number(o.orderindex) === field.value)
      : opts.filter(o => o.id === field.value)
    return matching.length === 1 && matching[0]!.id === wanted.value
  })
}
