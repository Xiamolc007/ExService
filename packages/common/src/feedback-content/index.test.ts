import { describe, expect, it } from 'vitest'
import { analyzeRequest, composeBug, normalizeMime } from '@workspace/common/feedback-content'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

describe('shared feedback plain text', () => {
  it('keeps HTML, fences and Markdown as text and preserves line breaks', () => {
    for (const text of ['中文\r\n下一行', '# 标题\n\n- 列表', '[文字](https://example.com)', '<script>alert(1)</script>', '```js\ncode\n```', '\\\\ * ** _', '**', '末尾\n']) {
      const result = analyzeRequest(text)
      expect(result.valid).toBe(true)
      const ast = unified().use(remarkParse).parse(result.markdown)
      expect(JSON.stringify(ast).match(/"type":"(html|heading|link|list|code|emphasis|strong)"/)).toBeNull()
    }
    expect(analyzeRequest('第一行\r\n\r\n第三行').markdown).toBe('第一行\\\n\\\n第三行')
  })
  it('checks raw and escaped byte bounds and whitespace', () => {
    expect(analyzeRequest(' \n\t').valid).toBe(false)
    expect(analyzeRequest('字'.repeat(21846)).valid).toBe(false)
    expect(analyzeRequest('*'.repeat(65536)).valid).toBe(false)
    expect(analyzeRequest('a'.repeat(65536)).valid).toBe(true)
  })
  it('composes only populated Bug sections in fixed order', () => {
    const result = composeBug({ description: '<html>', reproductionSteps: '1. step', expectedResult: null, actualResult: 'bad', frequency: 'often' })
    expect(result.valid).toBe(true)
    expect(result.markdown.indexOf('问题描述')).toBeLessThan(result.markdown.indexOf('复现步骤'))
    expect(result.markdown).not.toContain('预期结果')
    expect(result.markdown).toContain('经常')
    expect(composeBug({ description: 'a'.repeat(16385), reproductionSteps: null, expectedResult: null, actualResult: null, frequency: null }).valid).toBe(false)
  })
  it('normalizes MIME casing and replaces invalid header values', () => {
    expect(normalizeMime('TEXT/PLAIN')).toBe('text/plain')
    expect(normalizeMime('bad\r\nheader')).toBe('application/octet-stream')
  })
})
