/**
 * `@workspace/components` 的公开入口。
 *
 * 与 `@workspace/api-client` 一致：本包以**源码形式**导出（`exports` 直接指向 `src/index.ts`），
 * 由消费方的打包器（Vite）编译，因此没有自己的构建步骤。
 *
 * 只导出 `SiteHeader`：`Logo` / `ThemeToggle` / `AuthArea` 目前只有它一个使用点，
 * 是包的内部模块。等某个页面需要单独复用它们时再补导出——不要预先扩大公开面。
 *
 * 样式由组件各自的 `.module.scss` 携带，消费方无需额外导入。
 * 但 `@exre/exui/style.css` **不在**本包内导入：ExUI 要求每个应用只导入一次，
 * 该导入点在 `apps/web/src/main.tsx`。
 */
export { SiteHeader } from './SiteHeader'
