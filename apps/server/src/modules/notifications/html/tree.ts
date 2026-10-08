import { tokenizeHtml } from './tokenizer.js'

export interface TextNode {
  type: 'text'
  value: string
}

export interface ElementNode {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: HtmlNode[]
}

export type HtmlNode = TextNode | ElementNode

export class HtmlTreeError extends Error {}

/** 没有结束标签的元素；`<br>` 与 `<hr>` 都不接受子节点。 */
const VOID_ELEMENTS = new Set(['br', 'hr'])

/**
 * 隐式关闭规则：开始某个元素时，先把栈上这些仍打开的元素关闭。
 * 只覆盖 sanitizer 允许的元素，其余元素最终会被展开，不需要精确处理。
 */
const IMPLICIT_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  h2: ['p', 'h2', 'h3'],
  h3: ['p', 'h2', 'h3'],
  ul: ['p'],
  ol: ['p'],
  blockquote: ['p'],
  pre: ['p'],
  table: ['p'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  thead: ['tr', 'td', 'th'],
  tbody: ['tr', 'td', 'th'],
}

export interface TreeLimits {
  maxNodes: number
  maxDepth: number
}

export const DEFAULT_TREE_LIMITS: TreeLimits = { maxNodes: 1000, maxDepth: 16 }

export function buildHtmlTree(input: string, limits: TreeLimits = DEFAULT_TREE_LIMITS): HtmlNode[] {
  const root: ElementNode = { type: 'element', name: '#root', attributes: {}, children: [] }
  const stack: ElementNode[] = [root]
  let nodes = 0

  for (const token of tokenizeHtml(input)) {
    if (token.kind === 'text') {
      appendText(current(stack), token.value)
      nodes += 1
      if (nodes > limits.maxNodes) throw new HtmlTreeError('HTML 节点数量超出上限。')
      continue
    }
    if (token.kind === 'comment' || token.kind === 'doctype') continue

    if (token.kind === 'end') {
      if (token.selfClosing) continue
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.name === token.name) {
          stack.length = index
          break
        }
      }
      continue
    }

    for (const name of IMPLICIT_CLOSE[token.name] ?? []) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.name === name) {
          stack.length = index
          break
        }
      }
    }

    const attributes: Record<string, string> = {}
    for (const attribute of token.attributes) {
      attributes[attribute.name] = attribute.value
    }
    const element: ElementNode = { type: 'element', name: token.name, attributes, children: [] }
    nodes += 1
    if (nodes > limits.maxNodes) throw new HtmlTreeError('HTML 节点数量超出上限。')
    if (stack.length > limits.maxDepth) throw new HtmlTreeError('HTML 嵌套深度超出上限。')
    current(stack).children.push(element)
    if (!VOID_ELEMENTS.has(element.name) && !token.selfClosing) {
      stack.push(element)
    }
  }

  return root.children
}

function current(stack: ElementNode[]): ElementNode {
  return stack[stack.length - 1]!
}

function appendText(parent: ElementNode, value: string): void {
  if (value.length === 0) return
  const last = parent.children.at(-1)
  if (last !== undefined && last.type === 'text') {
    last.value += value
    return
  }
  parent.children.push({ type: 'text', value })
}
