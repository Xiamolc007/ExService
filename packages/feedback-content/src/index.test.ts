import { describe, expect, it } from 'vitest'
import { analyzeRequest, composeBug, finalMarkdown, equivalentMarkdown, normalizeMime, validHttpsUrl } from './index.js'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

describe('feedback plain text', () => {
  it('keeps HTML, fences and Markdown as text and preserves line breaks', () => {
    for (const text of ['中文\r\n下一行', '# 标题\n\n- 列表', '[文字](https://example.com)', '<script>alert(1)</script>', '```js\ncode\n```', '\\\\ * ** _', '**', '末尾\n']) {
      const result = analyzeRequest(text)
      expect(result.valid).toBe(true)
      const ast = unified().use(remarkParse).parse(result.markdown)
      const forbidden = JSON.stringify(ast).match(/"type":"(html|heading|link|list|code|emphasis|strong)"/)
      expect(forbidden).toBeNull()
      expect(equivalentMarkdown(result.markdown, result.markdown)).toBe(true)
    }
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
  it('checks structure and exact submission marker in remote content', () => {
    const markdown = finalMarkdown(analyzeRequest('# text').markdown, '11111111-1111-4111-8111-111111111111')
    expect(markdown).toContain('ExWebsite 提交编号：11111111-1111-4111-8111-111111111111')
    expect(equivalentMarkdown(markdown, markdown.replace('\\# text', '# text'))).toBe(false)
    expect(equivalentMarkdown(markdown, markdown.replace('4111', '4112'))).toBe(false)
  })
  it('accepts ClickUp soft newlines for plain Chinese hard breaks and coalesces adjacent text', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    const expected = finalMarkdown(analyzeRequest('普通中文第一行\n第二行：保留精确文字\n最后一行').markdown, marker)
    const remote = '普通中文第一行\n第二行：保留精确文字\n最后一行\n\n---\n\nExWebsite 提交编号：11111111-1111-4111-8111-111111111111'
    expect(equivalentMarkdown(expected, remote)).toBe(true)
    expect(equivalentMarkdown(remote, expected)).toBe(true)
    expect(equivalentMarkdown(expected, remote.replaceAll('\n', '\r\n'))).toBe(true)
  })
  it('preserves exact text, blank lines, blocks and the marker while normalizing line breaks', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    const expected = finalMarkdown(analyzeRequest('第一行\n第二行').markdown, marker)
    const remote = '第一行\n第二行\n\n---\n\nExWebsite 提交编号：11111111-1111-4111-8111-111111111111'
    for (const changed of [
      remote.replace('第二行', '第二'),
      remote.replace('第一行\n第二行', '第一行第二行'),
      remote.replace('第一行\n第二行', '第一行\n\n第二行'),
      remote.replace('第一行', '第一 行'),
      remote.replace('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111112'),
      remote.replace('\n\n---\n\n', '\n\n'),
    ]) expect(equivalentMarkdown(expected, changed), changed).toBe(false)
    const blankLine = finalMarkdown(analyzeRequest('第一行\n\n第三行').markdown, marker)
    expect(equivalentMarkdown(blankLine, blankLine.replace('\\\n\\\n', '\\\n'))).toBe(false)
  })
  it('accepts remote automatic HTTP(S) links only when their plain label exactly equals the target URL', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    for (const url of ['https://example.com', 'http://example.com/path', 'https://example.com/path?q=1&other=2#part']) {
      const expected = finalMarkdown(analyzeRequest(`地址：${url}\n下一行`).markdown, marker)
      for (const link of [`<${url}>`, `[${url}](${url})`]) {
        const remote = finalMarkdown(`地址：${link}\n下一行`, marker)
        expect(equivalentMarkdown(expected, remote), link).toBe(true)
        expect(equivalentMarkdown(remote, expected), 'normalization applies only to remote links').toBe(false)
      }
    }
  })
  it('accepts ClickUp automatic URLs inside escaped literal Markdown without accepting adjacent raw HTML', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    const plain = '# 标题 *星号* [链接](https://example.com)\n下一行'
    const remote = '\\# 标题 \\*星号\\* \\[链接\\]([https://example.com](https://example.com))\n下一行'
    expect(equivalentMarkdown(finalMarkdown(analyzeRequest(plain).markdown, marker), finalMarkdown(remote, marker))).toBe(true)
    expect(equivalentMarkdown(
      finalMarkdown(analyzeRequest(`${plain}\n<span>文字</span>`).markdown, marker),
      finalMarkdown(`${remote}\n<span>文字</span>`, marker),
    )).toBe(false)
  })
  it('rejects links with changed targets, labels, titles, unsafe URLs or formatted labels', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    for (const [plain, linked] of [
      ['https://example.com', '[https://example.com](https://other.example.com)'],
      ['https://example.com', '[https://example.com](https://example.com/)'],
      ['文字', '[文字](https://example.com)'],
      ['https://example.com', '[https://example.com](https://example.com "title")'],
      ['https://example.com', '[**https://example.com**](https://example.com)'],
      ['javascript:alert(1)', '[javascript:alert(1)](<javascript:alert(1)>)'],
      ['data:text/plain,value', '[data:text/plain,value](data:text/plain,value)'],
      ['mailto:user@example.com', '<mailto:user@example.com>'],
      ['https://user:password@example.com', '<https://user:password@example.com>'],
      ['https://example.com/a\u0001b', '[https://example.com/a\u0001b](<https://example.com/a\u0001b>)'],
    ]) expect(equivalentMarkdown(finalMarkdown(analyzeRequest(plain!).markdown, marker), finalMarkdown(linked!, marker)), linked).toBe(false)
    const plainWithHtml = finalMarkdown(analyzeRequest('https://example.com\n<span>文字</span>').markdown, marker)
    const linkedWithHtml = finalMarkdown('<https://example.com>\n<span>文字</span>', marker)
    expect(equivalentMarkdown(plainWithHtml, linkedWithHtml)).toBe(false)
  })
  it.each([
    ['https://example.com/a\\b', '[https://example.com/a\\\\b](<https://example.com/a\\\\b>)'],
    ['https://example.com/a\u00a0b', '[https://example.com/a\u00a0b](<https://example.com/a\u00a0b>)'],
    ['https://example.com/a\u2003b', '[https://example.com/a\u2003b](<https://example.com/a\u2003b>)'],
    ['relative/path', '[relative/path](relative/path)'],
    ['//example.com/path', '[//example.com/path](//example.com/path)'],
  ])('rejects automatic URL target %j', (plain, linked) => {
    const marker = '11111111-1111-4111-8111-111111111111'
    expect(equivalentMarkdown(finalMarkdown(analyzeRequest(plain).markdown, marker), finalMarkdown(linked, marker))).toBe(false)
  })
  it('rejects other links, HTML, headings and formatting applied to plain text', () => {
    const marker = '11111111-1111-4111-8111-111111111111'
    for (const [plain, formatted] of [
      ['[文字](https://example.com)', '[文字](https://example.com)'],
      ['<span>文字</span>', '<span>文字</span>'],
      ['# 标题', '# 标题'],
      ['**粗体**', '**粗体**'],
      ['*斜体*', '*斜体*'],
    ]) {
      const expected = finalMarkdown(analyzeRequest(plain!).markdown, marker)
      const remote = finalMarkdown(formatted!, marker)
      expect(equivalentMarkdown(expected, remote), formatted).toBe(false)
    }
  })
  it('allows credential-free HTTPS and normalizes unsafe MIME', () => {
    expect(validHttpsUrl('https://example.com/file')).toBe(true)
    expect(validHttpsUrl('https://user:pw@example.com/file')).toBe(false)
    expect(validHttpsUrl('http://example.com')).toBe(false)
    expect(normalizeMime('text/plain')).toBe('text/plain')
    expect(normalizeMime('bad\r\nheader')).toBe('application/octet-stream')
  })
})
