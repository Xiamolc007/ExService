# 内容组件来源与维护

CodeBlock、ContentImage、Callout、ContentProse 是本仓库基于 ExUI 与 CSS Modules 的独立实现。没有复制 Fumadocs UI 源码，也不安装其布局、主题提供器或 Radix 实现。

编译侧使用锁定的 `fumadocs-mdx@15.4.7` 与 `fumadocs-core@16.17.1`（上游许可证均为 MIT）。[Fumadocs Code Block](https://www.fumadocs.dev/docs/ui/components/codeblock) 与 [Rehype Code](https://www.fumadocs.dev/docs/headless/mdx/rehype-code) 用于核对 pre、title、data-language 和双主题高亮的接口职责。本地 transformer 增加 rawCode，组件用它复制当前代码块的原始文本。

升级时核对高亮输出属性、light/dark CSS 变量及原始文本 transformer；运行 CodeBlock 单测和真实 Fumadocs 编译集成测试，再验证浏览器复制、主题和键盘行为。组件由本仓库维护，不获得完整 Fumadocs UI 包的自动升级行为。
