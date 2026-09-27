import { forwardRef, useId, useImperativeHandle } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Alert, AlertDescription, Button, Field, FieldContent, FieldError, FieldLabel, Input } from '@exre/exui'
import { invitationEmailSchema } from '../auth/InvitationForms'
import { nicknameSchema } from '../profileValidation'
import styles from './Join.module.scss'

const schema = z.object({ email: invitationEmailSchema, nickname: nicknameSchema, qq: z.string().regex(/^[0-9]{1,20}$/, 'QQ 须为 1 至 20 位数字') })
export type JoinApplicationValues = z.infer<typeof schema>
export type JoinFormStep = 'contact' | 'identity' | 'confirmation'
export interface JoinFormHandle { setError: (message: string) => void }
interface Props { step: JoinFormStep; busy: boolean; onStepChange: (step: JoinFormStep) => void; onSubmit: (values: JoinApplicationValues) => Promise<void> }

function FormField({ form, name, id }: { form: UseFormReturn<JoinApplicationValues>; name: keyof JoinApplicationValues; id: string }) {
  const error = form.formState.errors[name]
  return <Field data-invalid={!!error}><FieldContent><FieldLabel htmlFor={`${id}-${name}`}>{name === 'email' ? '邮箱' : name === 'nickname' ? '用户名' : 'QQ 号'}</FieldLabel>
    <Input {...form.register(name)} id={`${id}-${name}`} type={name === 'email' ? 'email' : 'text'} inputMode={name === 'qq' ? 'numeric' : undefined} autoComplete={name === 'email' ? 'email' : name === 'nickname' ? 'nickname' : 'off'} autoFocus={name === 'email' || name === 'nickname'} aria-invalid={!!error} aria-describedby={error ? `${id}-${name}-error` : undefined} />
    {error && <FieldError id={`${id}-${name}-error`}>{error.message}</FieldError>}
  </FieldContent></Field>
}
function ContactStep({ form, id }: { form: UseFormReturn<JoinApplicationValues>; id: string }) { return <><h2>联系方式</h2><FormField form={form} name="email" id={id} /><p>审核结果和注册邀请将发送至此邮箱。</p></> }
function IdentityStep({ form, id }: { form: UseFormReturn<JoinApplicationValues>; id: string }) { return <><h2>基本信息</h2><FormField form={form} name="nickname" id={id} /><FormField form={form} name="qq" id={id} /></> }
function ConfirmationStep({ values }: { values: JoinApplicationValues }) { return <><h2>确认提交</h2><dl className={styles.details}><dt>邮箱</dt><dd>{values.email.trim().toLowerCase()}</dd><dt>用户名</dt><dd>{values.nickname.trim()}</dd><dt>QQ 号</dt><dd>{values.qq}</dd></dl><p>请核对联系方式，提交后等待审核。</p></> }

export const JoinApplicationForm = forwardRef<JoinFormHandle, Props>(function JoinApplicationForm({ step, busy, onStepChange, onSubmit }, ref) {
  const id = useId()
  const form = useForm<JoinApplicationValues>({ resolver: zodResolver(schema), defaultValues: { email: '', nickname: '', qq: '' } })
  useImperativeHandle(ref, () => ({ setError: message => form.setError('root.server', { message }) }))
  async function next() { if (await form.trigger(step === 'contact' ? ['email'] : ['nickname', 'qq'], { shouldFocus: true })) onStepChange(step === 'contact' ? 'identity' : 'confirmation') }
  const disabled = busy || form.formState.isSubmitting
  return <form className={styles.form} noValidate aria-busy={disabled} onSubmit={event => {
    if (step !== 'confirmation') { event.preventDefault(); void next() }
    else void form.handleSubmit(onSubmit, errors => { if (errors.email) onStepChange('contact'); else if (errors.nickname || errors.qq) onStepChange('identity') })(event)
  }}>
    <ol className={styles.steps} aria-label="申请表步骤">{(['contact', 'identity', 'confirmation'] as const).map((value, index) => <li key={value} aria-current={step === value ? 'step' : undefined}>{index + 1}. {value === 'contact' ? '联系方式' : value === 'identity' ? '基本信息' : '确认提交'}</li>)}</ol>
    {form.formState.errors.root?.server && <Alert variant="destructive" role="alert"><AlertDescription>{form.formState.errors.root.server.message}</AlertDescription></Alert>}
    <fieldset disabled={disabled} className={styles.fields}>
      {step === 'contact' && <ContactStep form={form} id={id} />}{step === 'identity' && <IdentityStep form={form} id={id} />}{step === 'confirmation' && <ConfirmationStep values={form.getValues()} />}
    </fieldset>
    <div className={styles.actions}>{step !== 'contact' && <Button type="button" variant="outline" disabled={disabled} onClick={() => onStepChange(step === 'confirmation' ? 'identity' : 'contact')}>{step === 'confirmation' ? '返回修改' : '上一步'}</Button>}<Button type="submit" disabled={disabled}>{disabled ? '提交中' : step === 'confirmation' ? '提交申请' : '下一步'}</Button></div>
  </form>
})
