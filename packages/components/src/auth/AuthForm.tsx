import { forwardRef, type ReactNode } from 'react'
import { LoginForm } from '@components/src/auth/LoginForm'
import { CaptchaForm } from '@components/src/auth/CaptchaForm'

export type AuthMode = 'login' | 'register'
export type AuthStep = 'credentials' | 'captcha'
export interface LoginDraft { email: string; password: string }
export interface AuthFormErrors { email?: string; nickname?: string; password?: string; code?: string; captcha?: string; form?: string }
export interface AuthFormHandle { setServerErrors: (errors: AuthFormErrors) => void; clearServerErrors: () => void }
export interface AuthFormProps {
  step: AuthStep
  busy: boolean
  initialEmail?: string
  description?: ReactNode
  onContinueLogin: (draft: LoginDraft) => void
  onCaptchaSubmit: (answer: string) => void | Promise<void>
  onJoin: () => void
  /** 图片验证码（base64 PNG, 无 data: 前缀）; 提供时 captcha 步骤展示真实图片 */
  captchaImage?: string
  /** 挑战加载中（刷新状态） */
  captchaLoading?: boolean
  /** 点击图片换一张 */
  onRefreshCaptcha?: () => void
}

export const AuthForm = forwardRef<AuthFormHandle, AuthFormProps>(function AuthForm(props, ref) {
  return props.step === 'captcha' ? <CaptchaForm {...props} ref={ref} /> : <LoginForm {...props} ref={ref} />
})
