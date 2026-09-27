import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type ReactNode } from 'react'
import { Controller, useForm, type FieldErrors, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, AlertDescription, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldContent, FieldError } from '@exre/exui'
import { ConfiguredField } from '../forms/ConfiguredField'
import { experiencedJoinApplicationSchema, newJoinApplicationSchema, type ExperiencedJoinApplicationDraft, type ExperiencedJoinApplicationInput, type JoinApplicationDraft, type JoinApplicationType, type NewJoinApplicationDraft, type NewJoinApplicationInput } from './applicationSchemas'
import { joinApplicationCommitments, joinApplicationFields, joinApplicationSteps } from './applicationFields'
import { ProofFileInput } from './ProofFileInput'
import styles from './CompleteJoinApplication.module.scss'

export interface CompleteJoinApplicationModalHandle {
  setError: (message: string, field?: 'email' | 'nickname' | 'qq') => void
}
interface InternalHandle extends CompleteJoinApplicationModalHandle { isSubmitting: () => boolean }
export interface CompleteJoinApplicationModalProps {
  open: boolean
  applicationType: JoinApplicationType
  step: number
  busy: boolean
  onStepChange: (step: number) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: JoinApplicationDraft) => Promise<void>
  onCloseAutoFocus?: (event: Event) => void
  serverAction?: ReactNode
  children?: ReactNode
}
type FormProps = Omit<CompleteJoinApplicationModalProps, 'open' | 'onCloseAutoFocus' | 'children'> & { handleRef: React.Ref<InternalHandle> }

function atPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}
function FormSummary<T extends FieldValues, O extends JoinApplicationDraft>({ form, type }: { form: UseFormReturn<T, unknown, O>; type: JoinApplicationType }) {
  const values = form.getValues()
  const fields = joinApplicationFields(type)
  const steps = joinApplicationSteps(type)
  const proofs = atPath(values, 'proofs') as File[]
  return <div className={styles.summary}><p>请核对全部资料和证明文件。提交后资料不可修改，同一邮箱只能申请一次。</p>
    {steps.slice(0, -1).map((step, index) => <section key={step} aria-label={`${step}摘要`}><h3>{step}</h3><dl>
      {fields.filter(field => field.step === index).map(field => {
        const raw = atPath(values, field.name)
        const selected = Array.isArray(raw) ? raw.map(value => field.options?.find(option => option.value === value)?.label ?? String(value)).join('、') : field.options?.find(option => option.value === raw)?.label ?? (typeof raw === 'string' ? raw.trim() : '')
        return <div key={field.name}><dt>{field.label}</dt><dd>{field.name === 'email' ? selected.toLowerCase() : selected || '未填写'}</dd></div>
      })}
      {type === 'experienced' && index === 3 && <div><dt>证明文件</dt><dd>{proofs.length === 0 ? '无' : <ul>{proofs.map((file, position) => <li key={position}>{file.name}（{(file.size / (1024 * 1024)).toFixed(2)} MiB）</li>)}</ul>}</dd></div>}
    </dl></section>)}
  </div>
}

function Wizard<T extends FieldValues, O extends JoinApplicationDraft>({ form, props }: { form: UseFormReturn<T, unknown, O>; props: FormProps }) {
  const { applicationType, step, busy, onStepChange, onSubmit, onOpenChange, serverAction, handleRef } = props
  const fields = joinApplicationFields(applicationType)
  const commitments = joinApplicationCommitments(applicationType)
  const steps = joinApplicationSteps(applicationType)
  const last = steps.length - 1
  const disabled = busy || form.formState.isSubmitting
  const pendingFocus = useRef<Path<T> | null>(null)
  const bodyRef = useRef<HTMLElement>(null)
  const synchronousSubmitting = useRef(false)
  const id = useId()
  useImperativeHandle(handleRef, () => ({
    setError: (message, field) => {
      form.setError(field ? field as Path<T> : 'root.server', { message })
      if (field) { pendingFocus.current = field as Path<T>; onStepChange(0) }
    },
    isSubmitting: () => busy || form.formState.isSubmitting || synchronousSubmitting.current,
  }))
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    const target = pendingFocus.current
    if (target) { form.setFocus(target); pendingFocus.current = null }
  }, [step, form])
  async function next() {
    if (disabled) return
    const names = fields.filter(field => field.step === step).map(field => field.name as Path<T>)
    if (applicationType === 'experienced' && step === 3) names.push('proofs' as Path<T>)
    if (await form.trigger(names, { shouldFocus: true })) onStepChange(Math.min(step + 1, last))
  }
  function invalid(errors: FieldErrors<T>) {
    const groups = steps.map((_, index) => index === last ? commitments.map(field => field.name) : [...fields.filter(field => field.step === index).map(field => field.name), ...(applicationType === 'experienced' && index === 3 ? ['proofs'] : [])])
    for (let index = 0; index < groups.length; index++) {
      const first = groups[index]?.find(name => atPath(errors, name))
      if (first) { pendingFocus.current = first as Path<T>; onStepChange(index); return }
    }
  }
  const submit = form.handleSubmit(async draft => {
    if (busy || synchronousSubmitting.current) return
    synchronousSubmitting.current = true
    form.clearErrors('root.server')
    try { await onSubmit(draft) } catch { form.setError('root.server', { message: '提交失败，请稍后重试。已填写的资料与文件会保留。' }) }
    finally { synchronousSubmitting.current = false }
  }, invalid)
  return <form className={styles.form} noValidate aria-busy={disabled} onSubmit={event => {
    if (disabled) { event.preventDefault(); return }
    if (step !== last) { event.preventDefault(); void next() } else void submit(event)
  }}>
    <DialogHeader className={styles.header}><DialogTitle>{applicationType === 'new' ? '全新玩家申请' : '经验玩家申请'}</DialogTitle><DialogDescription>请填写完整资料，提交后等待人工审核与社区安排。</DialogDescription>
      <p className={styles.progress} aria-live="polite">第 {step + 1} / {steps.length} 步 · {steps[step]}</p>
      <ol className={styles.steps} aria-label="申请表步骤">{steps.map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined}>{index + 1}. {title}</li>)}</ol>
    </DialogHeader>
    <section ref={bodyRef} className={styles.body} aria-label={`${steps[step]}内容`}>
      <h2>{steps[step]}</h2>
      {form.formState.errors.root?.server && <Alert variant="destructive" role="alert"><AlertDescription>{form.formState.errors.root.server.message}</AlertDescription></Alert>}
      {serverAction && <div className={styles.serverAction}>{serverAction}</div>}
      <fieldset disabled={disabled} className={styles.fields}>
        {step !== last ? fields.filter(field => field.step === step).map(field => <ConfiguredField key={field.name} definition={field} form={form} />) : <FormSummary form={form} type={applicationType} />}
        {applicationType === 'experienced' && step === 3 && <ProofFileInput form={form} disabled={disabled} />}
        {step === last && <section className={styles.commitments} aria-label="申请承诺"><h3>请阅读并确认承诺</h3>{commitments.map((commitment, index) => {
          const name = commitment.name as Path<T>
          const error = form.getFieldState(name, form.formState).error
          const checkboxId = `${id}-commitment-${index}`
          return <Field key={name} data-invalid={!!error}><FieldContent><Controller name={name} control={form.control} render={({ field }) => <label className={styles.commitment} htmlFor={checkboxId}><Checkbox id={checkboxId} ref={field.ref} checked={field.value === true} disabled={disabled} onBlur={field.onBlur} onCheckedChange={value => field.onChange(value === true)} aria-invalid={!!error} aria-describedby={error ? `${checkboxId}-error` : undefined} /><span>{commitment.label}</span></label>} />{error && <FieldError id={`${checkboxId}-error`}>{error.message}</FieldError>}</FieldContent></Field>
        })}</section>}
      </fieldset>
    </section>
    <div className={styles.footer}>
      <Button type="button" variant="ghost" disabled={disabled} onClick={() => onOpenChange(false)}>关闭申请</Button>
      <div className={styles.navigation}>{step > 0 && <Button type="button" variant="outline" disabled={disabled} onClick={() => onStepChange(step - 1)}>{step === last ? '返回修改' : '上一步'}</Button>}<Button type="submit" disabled={disabled}>{disabled ? '提交中' : step === last ? '提交申请' : '下一步'}</Button></div>
    </div>
  </form>
}

function NewApplicationForm(props: FormProps) {
  const form = useForm<NewJoinApplicationInput, unknown, NewJoinApplicationDraft>({ resolver: zodResolver(newJoinApplicationSchema), shouldUnregister: false,
    defaultValues: { email: '', nickname: '', qq: '', proofs: [], form: { applicationType: 'new', birthDate: '', freeTime: '', discoveryChannels: [], answers: { fiveMExperience: '', emergencyRoleplayKnowledge: '', emergencyProceduresKnowledge: '', rpUnderstanding: '', frpUnderstanding: '' }, commitments: { informationAccurate: false, obeyCommunityRules: false, acceptAcademyAttendanceConsequences: false } } },
  })
  return <Wizard form={form} props={props} />
}
function ExperiencedApplicationForm(props: FormProps) {
  const form = useForm<ExperiencedJoinApplicationInput, unknown, ExperiencedJoinApplicationDraft>({ resolver: zodResolver(experiencedJoinApplicationSchema), shouldUnregister: false,
    defaultValues: { email: '', nickname: '', qq: '', proofs: [], form: { applicationType: 'experienced', birthDate: '', freeTime: '', discoveryChannels: [], answers: { previousServer: '', leaveReason: '', previousDepartment: '', lawEnforcementExperience: '', highestRank: '', punishmentHistory: '', deescalationEssay: '', discretionEssay: '', transferReason: '' }, commitments: { informationAccurate: false } } },
  })
  return <Wizard form={form} props={props} />
}

export const CompleteJoinApplicationModal = forwardRef<CompleteJoinApplicationModalHandle, CompleteJoinApplicationModalProps>(function CompleteJoinApplicationModal(props, ref) {
  const formRef = useRef<InternalHandle>(null)
  useImperativeHandle(ref, () => ({ setError: (message, field) => formRef.current?.setError(message, field) }))
  function locked() { return props.busy || formRef.current?.isSubmitting() === true }
  function change(open: boolean) { if (!locked()) props.onOpenChange(open) }
  return <Dialog open={props.open} onOpenChange={change}>
    <DialogContent className={styles.modal} showCloseButton={false} onCloseAutoFocus={props.onCloseAutoFocus}
      onEscapeKeyDown={event => { if (locked()) event.preventDefault() }} onPointerDownOutside={event => { if (locked()) event.preventDefault() }} onInteractOutside={event => { if (locked()) event.preventDefault() }}>
      {props.children ? <><DialogHeader className={styles.header}><DialogTitle>{props.applicationType === 'new' ? '全新玩家申请' : '经验玩家申请'}</DialogTitle><DialogDescription>申请结果与下一步</DialogDescription></DialogHeader><div className={styles.body}>{props.children}</div></> : props.open && (props.applicationType === 'new' ? <NewApplicationForm key="new" {...props} onOpenChange={change} handleRef={formRef} /> : <ExperiencedApplicationForm key="experienced" {...props} onOpenChange={change} handleRef={formRef} />)}
    </DialogContent>
  </Dialog>
})
