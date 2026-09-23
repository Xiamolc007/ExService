import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Alert, AlertDescription, Button, Field, FieldContent, FieldError, FieldGroup,
  FieldLabel, Input, InputOTP, InputOTPGroup, InputOTPSlot, Spinner,
} from '@exre/exui'
import { CheckCircle2Icon, EyeIcon, EyeOffIcon } from 'lucide-react'
import styles from './AuthForm.module.scss'
import { ExIcon } from '../ExIcon'
import { LoginForm } from './LoginForm'
import { CaptchaForm } from './CaptchaForm'

export type AuthMode = 'login' | 'register'
export type AuthStep = 'credentials' | 'captcha' | 'verify' | 'registered'
export interface LoginDraft { email: string; password: string }
export interface RegistrationDraft extends LoginDraft { nickname: string }
export interface AuthFormErrors {
  email?: string
  nickname?: string
  password?: string
  code?: string
  captcha?: string
  form?: string
}
export interface AuthFormHandle {
  setServerErrors: (errors: AuthFormErrors) => void
  clearServerErrors: () => void
}
export interface AuthFormProps {
  mode: AuthMode
  step: AuthStep
  busy: boolean
  initialEmail?: string
  targetEmail?: string
  resendRemainingSeconds?: number
  canRetryVerification?: boolean
  onContinueLogin: (draft: LoginDraft) => void
  onContinueRegistration: (draft: RegistrationDraft) => void
  onCaptchaSubmit: (answer: string) => void | Promise<void>
  onVerify: (code: string) => void | Promise<void>
  onResend: () => boolean | Promise<boolean>
  onSwitchMode: (mode: AuthMode, email: string) => void
  onContinueToLogin: () => void
}

const registrationSchema = z.object({
  nickname: z.string().refine((value) => {
    const length = Array.from(value.trim()).length
    return length >= 1 && length <= 32 && !/[\u0000-\u001F\u007F-\u009F]/u.test(value)
  }, '用户名必须为 1 至 32 个字符，且不能包含控制字符'),
  email: z.string().refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    && Array.from(value.trim()).length <= 254, '请输入有效的邮箱地址'),
  password: z.string().refine((value) => Array.from(value).length >= 8
    && Array.from(value).length <= 64, '密码必须为 8 至 64 个字符'),
})
const verificationSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/, '请输入 6 位验证码') })

export const AuthForm = forwardRef<AuthFormHandle, AuthFormProps>(function AuthForm(props, ref) {
  if (props.step === 'captcha') return <CaptchaForm {...props} ref={ref} />
  return props.mode === 'login' && props.step === 'credentials'
    ? <LoginForm {...props} ref={ref} /> : <RegistrationForm {...props} ref={ref} />
})

const RegistrationForm = forwardRef<AuthFormHandle, AuthFormProps>(function RegistrationForm({
  step, busy, initialEmail = '', targetEmail,
  resendRemainingSeconds = 0, canRetryVerification = false,
  onContinueRegistration, onVerify, onResend, onSwitchMode, onContinueToLogin,
}: AuthFormProps, ref) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const lastAutoSubmitted = useRef<string | null>(null)
  const previousStep = useRef(step)
  const { register, handleSubmit, getValues, setValue, setError, clearErrors, getFieldState,
    formState: { errors, isSubmitting } } = useForm<RegistrationDraft>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { nickname: '', email: initialEmail, password: '' },
  })
  const verification = useForm<{ code: string }>({ resolver: zodResolver(verificationSchema), defaultValues: { code: '' } })
  const { setError: setCodeError, clearErrors: clearCodeErrors, reset: resetCode } = verification
  useImperativeHandle(ref, () => ({
    setServerErrors(nextErrors) {
      for (const field of ['email', 'nickname', 'password'] as const) {
        if (nextErrors[field]) setError(field, { type: 'server', message: nextErrors[field] })
      }
      if (nextErrors.code) setCodeError('code', { type: 'server', message: nextErrors.code })
      if (nextErrors.form) setError('root.server', { type: 'server', message: nextErrors.form })
    },
    clearServerErrors() {
      for (const field of ['email', 'nickname', 'password'] as const) {
        if (getFieldState(field).error?.type === 'server') clearErrors(field)
      }
      if (verification.getFieldState('code').error?.type === 'server') clearCodeErrors('code')
      clearErrors('root.server')
    },
  }), [setError, setCodeError, clearErrors, clearCodeErrors, getFieldState, verification])
  const disabled = busy || isSubmitting || verification.formState.isSubmitting
  const code = verification.watch('code')

  useEffect(() => { setValue('email', initialEmail) }, [initialEmail, setValue])
  useEffect(() => {
    if (previousStep.current !== step) {
      setValue('password', '')
      resetCode({ code: '' })
      clearErrors()
      lastAutoSubmitted.current = null
    }
    previousStep.current = step
  }, [step, setValue, resetCode, clearErrors])

  const submitCode = verification.handleSubmit(async ({ code: submittedCode }) => {
    if (!busy) await onVerify(submittedCode)
  })
  function updateCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    verification.setValue('code', digits)
    clearCodeErrors('code')
    if (digits.length === 6 && digits !== lastAutoSubmitted.current && !disabled) {
      lastAutoSubmitted.current = digits
      void submitCode()
    }
  }
  async function resendCode() {
    if (await onResend()) {
      resetCode({ code: '' })
      lastAutoSubmitted.current = null
    }
  }
  if (step === 'registered') return (
    <section className={styles.success} aria-live="polite">
      <CheckCircle2Icon aria-hidden="true" /><h2>注册成功</h2>
      <p>账号已创建，即将前往登录。</p><Button onClick={onContinueToLogin}>前往登录</Button>
    </section>
  )
  const alert = errors.root?.server && <Alert variant="destructive" role="alert"><AlertDescription>{errors.root.server.message}</AlertDescription></Alert>
  if (step === 'verify') return (
    <form className={styles.form} aria-busy={disabled} noValidate onSubmit={submitCode}>
      <div className={styles.intro}><h2 tabIndex={-1}>验证邮箱</h2><p>验证码已发送至 <strong>{targetEmail}</strong></p></div>
      {alert}
      <Field data-invalid={verification.formState.errors.code ? true : undefined}>
        <FieldContent>
          <FieldLabel htmlFor={`${id}-code`}>6 位验证码</FieldLabel>
          <Controller control={verification.control} name="code" render={({ field }) => (
            <InputOTP id={`${id}-code`} ref={field.ref} name={field.name} onBlur={field.onBlur} autoFocus maxLength={6}
              value={field.value} onChange={updateCode} disabled={disabled}
              aria-invalid={verification.formState.errors.code ? true : undefined}
              aria-describedby={verification.formState.errors.code ? `${id}-code-error` : undefined}>
              <InputOTPGroup>{Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} />)}</InputOTPGroup>
            </InputOTP>
          )} />
          {verification.formState.errors.code && <FieldError id={`${id}-code-error`}>{verification.formState.errors.code.message}</FieldError>}
        </FieldContent>
      </Field>
      <div className={styles.actions}>
        {canRetryVerification && code.length === 6 && <Button type="submit" disabled={disabled}>重试验证</Button>}
        <Button type="button" variant="outline" disabled={disabled || resendRemainingSeconds > 0} onClick={() => void resendCode()}>
          {resendRemainingSeconds > 0 ? `${resendRemainingSeconds} 秒后重发` : '重新发送验证码'}
        </Button>
      </div>
      {disabled && <p className={styles.busy} role="status"><Spinner aria-hidden="true" />正在验证</p>}
    </form>
  )
  return (
    <form className={`${styles.form} ${styles.loginForm}`} noValidate aria-busy={disabled}
      onSubmit={handleSubmit((draft) => { if (!busy) onContinueRegistration(draft) })}>
      <div className={`${styles.intro} ${styles.loginIntro}`}>
        <ExIcon size="6rem" className={styles.authIcon} />
        <h2 tabIndex={-1}>创建 Exre 账号</h2>
        <p>已经有账号？ <Button type="button" variant="link" disabled={disabled}
          onClick={() => onSwitchMode('login', getValues('email'))}>登录</Button></p>
      </div>
      {alert}
      <FieldGroup>
        {(['email', 'nickname', 'password'] as const).map((name) => (
          <Field key={name} data-invalid={errors[name] ? true : undefined}>
            <FieldContent>
              <FieldLabel htmlFor={`${id}-${name}`}>{name === 'nickname' ? '用户名' : name === 'email' ? '邮箱' : '密码'}</FieldLabel>
              <div className={name === 'password' ? styles.loginPassword : undefined}>
                <Input {...register(name)} id={`${id}-${name}`} disabled={disabled} autoFocus={name === 'email'}
                  type={name === 'password' ? (visible ? 'text' : 'password') : name === 'email' ? 'email' : 'text'}
                  autoComplete={name === 'password' ? 'new-password' : name === 'nickname' ? 'nickname' : 'email'}
                  aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `${id}-${name}-error` : undefined} />
                {name === 'password' && <Button type="button" variant="ghost" size="icon-sm" className={styles.passwordToggle}
                  disabled={disabled} aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>
                  {visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                </Button>}
              </div>
              {errors[name] && <FieldError id={`${id}-${name}-error`}>{errors[name].message}</FieldError>}
            </FieldContent>
          </Field>
        ))}
      </FieldGroup>
      <Button type="submit" disabled={disabled} className={styles.submit}>{disabled ? <><Spinner aria-hidden="true" />处理中</> : '继续'}</Button>
    </form>
  )
})
