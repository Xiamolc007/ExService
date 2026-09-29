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
export { SiteHeader } from '@components/src/SiteHeader'
export { ExIcon } from '@components/src/ExIcon'
export type { ExIconProps } from '@components/src/ExIcon'
export type { SiteHeaderProps } from '@components/src/SiteHeader'
export { AuthArea } from '@components/src/AuthArea'
export type { AuthAreaProps, AuthDisplayState } from '@components/src/AuthArea'
export { ProfileEditor } from '@components/src/ProfileEditor'
export type { ProfileEditorProps, ProfileTextValues } from '@components/src/ProfileEditor'
export { ContentAreaState, SettingsContentSkeleton } from '@components/src/ContentAreaState'
export type { ContentAreaStateProps } from '@components/src/ContentAreaState'
export { SettingsPanel } from '@components/src/SettingsPanel'
export type { SettingsPanelProps, SettingsCategory, SettingsTheme, SettingsField } from '@components/src/SettingsPanel'
export { AuthForm } from '@components/src/auth/AuthForm'
export type {
  AuthFormErrors,
  AuthFormHandle,
  AuthFormProps,
  AuthMode,
  AuthStep,
  LoginDraft,
} from '@components/src/auth/AuthForm'
export { AuthModal } from '@components/src/auth/AuthModal'
export type { AuthModalProps } from '@components/src/auth/AuthModal'
export { InvitationEmailForm, InvitationCodeForm, InvitationProfileForm, invitationEmailSchema } from '@components/src/auth/InvitationForms'
export type { InvitationProfileValues } from '@components/src/auth/InvitationForms'
export { JoinReviewDialog } from '@components/src/join/JoinReviewDialog'
export { CompleteJoinApplicationModal } from '@components/src/join/CompleteJoinApplicationModal'
export type { CompleteJoinApplicationModalHandle, CompleteJoinApplicationModalProps } from '@components/src/join/CompleteJoinApplicationModal'
export type { JoinApplicationDraft, JoinApplicationType, NewJoinApplicationDraft, ExperiencedJoinApplicationDraft } from '@components/src/join/applicationSchemas'
export { newJoinApplicationSchema, experiencedJoinApplicationSchema } from '@components/src/join/applicationSchemas'
export { joinApplicationFields, joinApplicationCommitments, joinApplicationSteps, applicantCategoryOptions, departmentOptions, discoveryChannelOptions } from '@components/src/join/applicationFields'
