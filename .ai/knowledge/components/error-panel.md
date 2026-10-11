# 错误面板的高度与可访问性边界

_最后更新：2026-10-10_

`packages/components/src/ErrorPanel.tsx` 只展示调用方提供的本次错误列表，不积累历史、不按文案去重、不映射 HTTP 错误或决定导航。条目的 ID 由调用方保证唯一稳定；文案作为文本渲染。空列表不产生 DOM。

## 高度与滚动

`maxHeight` 限制整个面板的 border-box，默认 240 px；只有有限且至少 160 的数值生效。标题和可选 Action 固定，仅语义列表滚动。无标题不渲染 header；Action 为 null 或未提供时，整个 footer 连同分隔线和内边距都不存在。紧凑内容自然收缩。

CSS Module 覆盖 ExUI Alert 的默认布局与 padding，保持纵向 flex、列表 `min-height: 0`、长连续字符串换行及滚动链隔离。调用方应保持标题和 Action 紧凑，不能以外部样式覆盖高度和滚动契约。

列表实际溢出时才增加 Tab 停靠。组件通过 ResizeObserver 观察面板与列表尺寸，并在内容变化后测量；卸载清理观察器。仅条目 ID、正文或说明变化才回到列表起点，内容相同的新数组、普通重渲染和 Action 切换均保留滚动位置。

## 播报与焦点

ExUI Alert 默认带 alert 角色，ErrorPanel 显式改为命名 region 和单一 polite live 区域，避免隐含的 assertive 播报。标题存在时使用标题关联，无标题时可访问名称为“错误信息”。装饰图标与视觉编号不重复播报，组件不会自动抢走焦点。

`id` 可以供输入的 `aria-describedby` 引用；调用方负责在错误消失时同时移除引用，且保留原有字段错误关联。字段专属错误仍由所属表单的 FieldError 展示。

## 验证入口

`packages/components/src/ErrorPanel.test.tsx` 覆盖内容、可选区域、高度参数、播报、滚动重置与观察器清理。`tests/browser/error-panel.mjs` 配合 `tests/browser/error-panel-fixture.tsx` 在真实 Chromium 中验证高度、固定区域、键盘滚动、焦点、主题与窄屏；jsdom 的尺寸模拟不能证明真实布局。独立 fixture 不调用业务 API，也不替代真实注册页验收。
