import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { toMarkdown } from 'mdast-util-to-markdown'

export const CONTENT_RULE_VERSION = 1
export const FEEDBACK_LIMITS = Object.freeze({ titleCodePoints: 200, userContentBytes: 65536, fileBytes: 20971520, files: 5, totalFileBytes: 104857600 })
export const BUG_TEXT_BYTES = 16384
export const FINAL_CONTENT_BYTES = 66560
export const FREQUENCIES = Object.freeze({ always: '每次', often: '经常', sometimes: '偶尔', once: '仅一次' })
export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length

/** AST text is serialized, never parsed as user-authored Markdown. */
export function escapePlainText(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  // Explicit hard breaks preserve each newline, including empty lines.
  const children = normalized.split('\n').flatMap((line, index) => [
    ...(index ? [{ type: 'break' as const }] : []), { type: 'text' as const, value: line },
  ])
  return toMarkdown({ type: 'root', children: [{ type: 'paragraph', children }] }).replace(/\n$/, '')
}

export interface ContentAnalysis { valid: boolean; markdown: string; reason: 'empty' | 'too_large' | null }
function analyze(raw: string, markdown: string, fieldLimit: number): ContentAnalysis {
  const reason = !raw.trim() ? 'empty' : utf8Bytes(raw) > fieldLimit || utf8Bytes(markdown) > FEEDBACK_LIMITS.userContentBytes ? 'too_large' : null
  return { valid: reason === null, markdown, reason }
}
export function analyzeRequest(text: string): ContentAnalysis { return analyze(text, escapePlainText(text), FEEDBACK_LIMITS.userContentBytes) }
export interface BugContent {
  description: string; reproductionSteps: string | null; expectedResult: string | null; actualResult: string | null
  frequency: keyof typeof FREQUENCIES | null
}
export function composeBug(details: BugContent): ContentAnalysis {
  const sections: [string, string | null][] = [
    ['问题描述', details.description], ['复现步骤', details.reproductionSteps], ['预期结果', details.expectedResult],
    ['实际结果', details.actualResult], ['发生频率', details.frequency === null ? null : FREQUENCIES[details.frequency]],
  ]
  const markdown = sections.filter(([, value]) => value?.trim()).map(([label, value]) => `## ${label}\n\n${escapePlainText(value!)}`).join('\n\n')
  const oversized = sections.some(([, value]) => value !== null && utf8Bytes(value) > BUG_TEXT_BYTES)
  const result = analyze(details.description, markdown, BUG_TEXT_BYTES)
  return oversized ? { ...result, valid: false, reason: 'too_large' } : result
}
export function finalMarkdown(userMarkdown: string, submissionId: string): string {
  const result = `${userMarkdown}\n\n---\n\nExWebsite 提交编号：${submissionId}`
  if (utf8Bytes(result) > FINAL_CONTENT_BYTES) throw new Error('Feedback content exceeds final byte limit')
  return result
}
const parser = unified().use(remarkParse)
function isText(value: unknown): value is { type: 'text'; value: string } {
  return value !== null && typeof value === 'object' && 'type' in value && value.type === 'text' && 'value' in value && typeof value.value === 'string'
}
function automaticLinkText(value: object): string | undefined {
  const node = value as Record<string, unknown>
  if (node.type !== 'link' || node.title != null || typeof node.url !== 'string' || !Array.isArray(node.children) || !node.children.every(isText)) return undefined
  const label = node.children.map(child => child.value).join('')
  if (label !== node.url || !/^https?:\/\//i.test(label) || /[\\\s\u0000-\u0020\u007f-\u009f]/.test(label)) return undefined
  try {
    const url = new URL(label)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.hostname) return label
  } catch { /* Invalid URLs retain their link structure and fail the text comparison. */ }
  return undefined
}
function canonical(value: unknown, remoteLinks = false): unknown {
  if (Array.isArray(value)) {
    const nodes: unknown[] = []
    for (const node of value.map(node => canonical(node, remoteLinks))) {
      const previous = nodes[nodes.length - 1]
      if (isText(previous) && isText(node)) previous.value += node.value
      else nodes.push(node)
    }
    return nodes
  }
  if (value !== null && typeof value === 'object') {
    const linkText = remoteLinks ? automaticLinkText(value) : undefined
    if (linkText !== undefined) return { type: 'text', value: linkText }
    // ClickUp returns visible line breaks as soft newlines inside text. Keep
    // every newline while retaining all other inline and block node types.
    if ('type' in value && value.type === 'break') return { type: 'text', value: '\n' }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'position').map(([key, field]) => [key, canonical(field, remoteLinks)]))
  }
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value
}
/** Accept visible newlines and exact remote URL autolinks; preserve other AST structure. */
export function equivalentMarkdown(expected: string, remote: string): boolean {
  if (utf8Bytes(remote) > FINAL_CONTENT_BYTES) return false
  return JSON.stringify(canonical(parser.parse(expected))) === JSON.stringify(canonical(parser.parse(remote), true))
}
export function validHttpsUrl(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname) } catch { return false }
}
export function normalizeMime(value: string): string {
  return value.length <= 127 && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value) ? value.toLowerCase() : 'application/octet-stream'
}
