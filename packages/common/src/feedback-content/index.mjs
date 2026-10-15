import { toMarkdown } from 'mdast-util-to-markdown'

export const FEEDBACK_LIMITS = Object.freeze({ titleCodePoints: 200, userContentBytes: 65536, fileBytes: 20971520, files: 5, totalFileBytes: 104857600 })
const BUG_TEXT_BYTES = 16384
export const FREQUENCIES = Object.freeze({ always: '每次', often: '经常', sometimes: '偶尔', once: '仅一次' })
export const utf8Bytes = value => new TextEncoder().encode(value).length

/** AST text is serialized, never parsed as user-authored Markdown. */
export function escapePlainText(value) {
  const normalized = value.replace(/\r\n?/g, '\n')
  // Explicit hard breaks preserve each newline, including empty lines.
  const children = normalized.split('\n').flatMap((line, index) => [
    ...(index ? [{ type: 'break' }] : []), { type: 'text', value: line },
  ])
  return toMarkdown({ type: 'root', children: [{ type: 'paragraph', children }] }).replace(/\n$/, '')
}

function analyze(raw, markdown, fieldLimit) {
  const reason = !raw.trim() ? 'empty' : utf8Bytes(raw) > fieldLimit || utf8Bytes(markdown) > FEEDBACK_LIMITS.userContentBytes ? 'too_large' : null
  return { valid: reason === null, markdown, reason }
}
export function analyzeRequest(text) { return analyze(text, escapePlainText(text), FEEDBACK_LIMITS.userContentBytes) }
export function composeBug(details) {
  const sections = [
    ['问题描述', details.description], ['复现步骤', details.reproductionSteps], ['预期结果', details.expectedResult],
    ['实际结果', details.actualResult], ['发生频率', details.frequency === null ? null : FREQUENCIES[details.frequency]],
  ]
  const markdown = sections.filter(([, value]) => value?.trim()).map(([label, value]) => `## ${label}\n\n${escapePlainText(value)}`).join('\n\n')
  const oversized = sections.some(([, value]) => value !== null && utf8Bytes(value) > BUG_TEXT_BYTES)
  const result = analyze(details.description, markdown, BUG_TEXT_BYTES)
  return oversized ? { ...result, valid: false, reason: 'too_large' } : result
}
export function normalizeMime(value) {
  return value.length <= 127 && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value) ? value.toLowerCase() : 'application/octet-stream'
}
