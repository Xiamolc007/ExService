# 公共正文初始化与目录回调

公共正文使用原 Editor wrapper。`apps/outline/app/components/Editor.tsx` 合并内部 ref 与调用者 ref；一次重渲染可能重新附着外部 ref。目录同步不能把每次 ref 附着都当作一次新正文初始化。

`apps/outline/app/scenes/WebsitePublic/PublicDocument.tsx` 的 `handleInit` 比较 heading 的 id、level、title、label，内容未改变时保留旧 state。若改为每次附着都 `setHeadings` 一个新数组，会形成父组件更新 → wrapper ref 重附着 → 父组件再次更新的循环。只保证 callback 函数引用稳定不够。

初始化也不能只依赖 `onInit`：Editor 可能先触发它，再把实例交给外部 ref，此时目录读取为空。当前同时在实例 ref 附着和 `onInit` 时调用同一幂等同步函数；需要保留这两个时机。

修改该路径时用实际 wrapper 验证初始 headings，以及同内容的新数组和重复 ref 附着。使用只触发一次 ref 的简化 fixture，无法证明没有这一循环。公共呈现与 DTO 边界见 `.ai/architectures/docs-integration/unified-reading-interface.md`。
