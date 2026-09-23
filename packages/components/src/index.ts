/**
 * `@workspace/components` 的公开入口。
 *
 * 与 `@workspace/api-client` 一致：本包以**源码形式**导出（`exports` 直接指向 `src/index.ts`），
 * 由消费方的打包器（Vite）编译，因此没有自己的构建步骤。
 *
 * 公开站点组件与可复用的 `ExIcon`；`Logo` / `ThemeToggle` 仍是包内模块。
 *
 * 样式由组件各自的 `.module.scss` 携带，消费方无需额外导入。
 * 但 `@exre/exui/style.css` **不在**本包内导入：ExUI 要求每个应用只导入一次，
 * 该导入点在 `apps/web/src/main.tsx`。
 */
export { SiteHeader } from './SiteHeader'
export { ExIcon } from './ExIcon'
export type { ExIconProps } from './ExIcon'
export type { SiteHeaderProps } from './SiteHeader'
export { AuthArea } from './AuthArea'
export type { AuthAreaProps, AuthDisplayState } from './AuthArea'
export { AuthForm } from './auth/AuthForm'
export type {
  AuthFormErrors,
  AuthFormHandle,
  AuthFormProps,
  AuthMode,
  AuthStep,
  LoginDraft,
  RegistrationDraft,
} from './auth/AuthForm'
export { AuthModal } from './auth/AuthModal'
export type { AuthModalProps } from './auth/AuthModal'
