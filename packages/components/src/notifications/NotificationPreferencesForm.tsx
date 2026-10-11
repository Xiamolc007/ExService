import { useEffect, useId, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Field, FieldContent, FieldDescription, FieldLabel, Skeleton, Switch } from '@exre/exui'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import styles from '@components/src/notifications/NotificationPreferencesForm.module.scss'

export interface NotificationPreferencesDraft { announcement: boolean; personal_update: boolean }
export interface NotificationPreferencesFormProps {
  active: boolean
  identityEpoch: number
  saved: NotificationPreferencesDraft | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  onRetry: () => void
  saving: boolean
  message: string | null
  conflict?: boolean
  onSave: (draft: NotificationPreferencesDraft) => Promise<NotificationPreferencesDraft>
}
const preferencesSchema = z.object({ announcement: z.boolean(), personal_update: z.boolean() })
const defaults = { announcement: true, personal_update: true }
const fields = [
  { name: 'announcement' as const, label: '社区动态', description: '全站公告与社区更新。' },
  { name: 'personal_update' as const, label: '个人提醒', description: '与你有关的可选个人通知。' },
]
type FieldIntent = { field: keyof NotificationPreferencesDraft; value: boolean }

/** 仅用户切换开关会提交完整已验证偏好；失败恢复确认值并保存单字段重试意图。 */
export function NotificationPreferencesForm(props: NotificationPreferencesFormProps) {
  // RHF's handleSubmit finally belongs to its form instance. A new identity needs
  // a fresh owner so an old promise cannot reset its isSubmitting state.
  return <IdentityPreferencesForm key={props.identityEpoch} {...props} />
}

function IdentityPreferencesForm(props: NotificationPreferencesFormProps) {
  const form = useForm<NotificationPreferencesDraft>({ resolver: zodResolver(preferencesSchema), defaultValues: props.saved ?? defaults })
  const fieldId = useId()
  const latest = useRef(props)
  latest.current = props
  const confirmed = useRef(props.saved ?? defaults)
  const failed = useRef<FieldIntent | null>(null)
  const lock = useRef<{ epoch: number } | null>(null)
  const mounted = useRef(true)
  const seenEpoch = useRef(props.identityEpoch)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; lock.current = null }
  }, [])
  useEffect(() => {
    const changedIdentity = seenEpoch.current !== props.identityEpoch
    seenEpoch.current = props.identityEpoch
    if (changedIdentity || props.saved === null) {
      lock.current = null; failed.current = null; form.clearErrors()
    }
    confirmed.current = props.saved ?? defaults
    form.reset(confirmed.current, { keepErrors: !changedIdentity && props.saved !== null })
  }, [props.identityEpoch, props.saved?.announcement, props.saved?.personal_update, props.saved === null, form])
  useEffect(() => {
    if (props.conflict) { failed.current = null; form.clearErrors() }
  }, [props.conflict, form])

  const saveField = async (intent: FieldIntent) => {
    const current = latest.current
    if (!current.active || current.status !== 'ready' || current.saved === null || current.saving || lock.current !== null) return
    const run = { epoch: current.identityEpoch }
    lock.current = run
    const accepted = () => mounted.current && latest.current.identityEpoch === run.epoch && lock.current === run
    failed.current = null; form.clearErrors()
    form.reset({ ...confirmed.current, [intent.field]: intent.value })
    try {
      await form.handleSubmit(async values => {
        if (!accepted()) return
        const canonical = await current.onSave(values)
        if (!accepted()) return
        confirmed.current = preferencesSchema.parse(canonical)
        form.reset(confirmed.current)
      }, () => {
        if (accepted()) form.reset(confirmed.current)
      })()
    } catch {
      if (!accepted()) return
      form.reset(confirmed.current)
      if (!latest.current.conflict) {
        failed.current = intent
        form.setError('root.server', { message: '保存失败，已恢复上次设置。请重试。' })
      }
    } finally { if (accepted()) lock.current = null }
  }

  if (!props.active) return null
  if (props.status === 'error') return <>
    <header className={styles.header}><h2>通知</h2></header>
    <div className={styles.notice} role="alert"><p>通知设置暂时无法读取。其他设置仍可使用。</p>
      <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>重试通知设置</Button></div>
  </>
  if (props.status !== 'ready' || props.saved === null) return <>
    <header className={styles.header}><h2>通知</h2></header>
    <div role="status" aria-label="正在加载通知设置" className={styles.skeletons}>
      <Skeleton className={styles.skeleton} /><Skeleton className={styles.skeleton} />
    </div>
  </>
  const pending = props.saving || form.formState.isSubmitting
  const error = form.formState.errors.root?.server?.message
  return <>
    <header className={styles.header}><h2>通知</h2></header>
    <p className={styles.intro}>管理站内通知。关闭可选分类只影响未来接收，已有通知保留。</p>
    <form noValidate className={styles.form} onSubmit={event => event.preventDefault()}>
      {fields.map(field => <Field key={field.name} orientation="horizontal" className={styles.row}>
        <FieldContent><FieldLabel htmlFor={`${fieldId}-${field.name}`}>{field.label}</FieldLabel>
          <FieldDescription>{field.description}</FieldDescription></FieldContent>
        <Switch id={`${fieldId}-${field.name}`} disabled={pending} checked={form.watch(field.name)}
          onCheckedChange={value => void saveField({ field: field.name, value })} />
      </Field>)}
      <div className={styles.feedback}>
        {pending && <p className={styles.message} role="status">保存中…</p>}
        {props.conflict && <p className={styles.error} role="alert">设置已由其他设备更新，请重新调整。</p>}
        {!props.conflict && error && <div className={styles.error} role="alert"><p>{error}</p>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => {
            if (failed.current) void saveField(failed.current)
          }}>重试保存</Button></div>}
      </div>
    </form>
  </>
}
