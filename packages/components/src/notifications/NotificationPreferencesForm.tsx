import { useEffect, useId, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Field, FieldContent, FieldDescription, FieldLabel, Skeleton, Switch } from '@exre/exui'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  notificationCategoryLabel,
  type NotificationCategory,
} from '@components/src/notifications/notificationsView'
import styles from '@components/src/notifications/NotificationPreferencesForm.module.scss'

export interface NotificationPreferencesDraft {
  announcement: boolean
  personal_update: boolean
}

export interface NotificationPreferencesFormProps {
  /**
   * 是否为当前展示的分类。
   *
   * 表单**始终挂载**，调用方必须把它渲染在分类门控之外并把分类传进来：切到别的分类只是
   * 不渲染内容（`null`），React Hook Form 的草稿因此不会被卸载丢弃。若调用方只在
   * `category === 'notifications'` 的分支里渲染它，通知 → 个人资料 → 通知 会卸载重挂，
   * 草稿随之丢失。这符合「所有 hooks 稳定调用 + 稳定表单所有者保存草稿」的隔离要求。
   */
  active: boolean
  /**
   * 身份代次：**草稿的归属**由它决定。
   *
   * 换号/退出时调用方递增它（见 `bindNotificationsToken`），表单据此无条件丢弃草稿并
   * 清空对账基线。少了这个输入，草稿就只属于「组件实例」而不属于身份 ——
   * 上一个账号未保存的开关会被带到新账号，用户一点「保存更改」就把他从没选过的
   * 偏好写进新身份（设计 8.3：退出/换号清空草稿）。
   *
   * 传代次而不是 token 本身，是为了不把凭据交给纯展示组件。
   */
  identityEpoch: number
  saved: NotificationPreferencesDraft | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  onRetry: () => void
  saving: boolean
  message: string | null
  conflict: boolean
  necessaryCategories: NotificationCategory[]
  onSave: (draft: NotificationPreferencesDraft) => Promise<void>
  /** 重新读取服务器版本；只更新快照与 revision，草稿保留。 */
  onRefresh: () => void
}

const preferencesSchema = z.object({
  announcement: z.boolean(),
  personal_update: z.boolean(),
})

const OPTIONAL_FIELDS = [
  { name: 'announcement' as const, label: '社区动态', description: '全站公告与社区更新。' },
  { name: 'personal_update' as const, label: '个人提醒', description: '与你有关的可选个人通知。' },
]

/**
 * 通知偏好表单。
 *
 * 只管可选类别；必要类别由服务端 catalog 固定，这里只做说明，不可写入也不可关闭。
 * 保存失败与 409 都保留草稿：409 时只更新服务器快照供对照，不盲 PUT 覆盖。
 *
 * 草稿的归属是**身份**，不是组件实例：
 * 同一身份内保留草稿（409 重读不覆盖），跨身份（`identityEpoch` 变化）无条件清空。
 */
export function NotificationPreferencesForm(props: NotificationPreferencesFormProps) {
  const form = useForm<NotificationPreferencesDraft>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: props.saved ?? { announcement: true, personal_update: true },
  })
  const fieldId = useId()
  const [serverError, setServerError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const saved = props.saved
  const savedRevision = `${saved?.announcement}:${saved?.personal_update}`
  /**
   * 上一次与表单对账过的服务器快照。
   *
   * 「核对最新版本（保留草稿）」会用新的服务器值换掉 `saved`。若此时无条件
   * `form.reset(saved)`，草稿就被服务器值覆盖了 —— 按钮写着「保留草稿」，行为却是丢弃草稿。
   * 因此只有「表单当前值仍等于上一次对账的快照」（即用户没有未保存更改）时才跟随服务器
   * 重设基线；有草稿时只更新对照快照，一个字段都不动。
   *
   * 这个「保留草稿」只在**同一身份内**成立；跨身份由下面的 `identityEpoch` 无条件清空。
   */
  const reconciled = useRef<NotificationPreferencesDraft | null>(null)
  const seenEpoch = useRef(props.identityEpoch)
  const snapshotCleared = saved === null

  const discardDraft = (baseline: NotificationPreferencesDraft) => {
    reconciled.current = null
    setServerError(null)
    setCancelled(false)
    form.reset(baseline)
  }

  // 身份变化（显式信号）：无条件丢弃上一个身份的草稿、错误提示与对账基线。
  // 必须排在对账 effect 之前，这样同一提交里到达的新快照会被当成「首读」重新对齐。
  useEffect(() => {
    if (seenEpoch.current === props.identityEpoch) return
    seenEpoch.current = props.identityEpoch
    discardDraft(saved ?? { announcement: true, personal_update: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.identityEpoch])

  /*
   * 快照被清空（隐式信号）：控制器里只有 `bindNotificationsToken` 会把 `preferences.snapshot`
   * 置为 null（读取失败只改 status，不动快照），所以「有快照 → 无快照」就是换号/退出/
   * 会话失效。这条不依赖调用方是否把 `identityEpoch` 接出来，是显式信号的兜底：
   * 少了它，任何漏接代次的调用点都会把上一个身份的草稿带过去。
   */
  useEffect(() => {
    if (!snapshotCleared) return
    discardDraft({ announcement: true, personal_update: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotCleared])

  useEffect(() => {
    if (saved === null) return
    const previous = reconciled.current
    if (previous !== null
      && previous.announcement === saved.announcement
      && previous.personal_update === saved.personal_update) return
    reconciled.current = saved
    if (previous === null) {
      // 首次读到服务器值：此时还没有草稿，直接对齐。
      form.reset(saved)
      return
    }
    const draft = form.getValues()
    const hasDraft = draft.announcement !== previous.announcement
      || draft.personal_update !== previous.personal_update
    if (!hasDraft) form.reset(saved)
  }, [savedRevision]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!props.conflict) setServerError(null)
  }, [props.conflict])

  if (!props.active) return null

  const submit = form.handleSubmit(async values => {
    setServerError(null)
    setCancelled(false)
    try {
      await props.onSave(values)
      // 保存成功：把对账基线移到刚写入的值，「有尚未保存的更改」随之清除。
      reconciled.current = values
      form.reset(values)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : '保存失败，草稿已保留。请重试。')
    }
  })

  if (props.status === 'error') {
    return <>
      <header className={styles.header}><h2>通知</h2></header>
      <div className={styles.notice} role="alert">
        <p>通知设置暂时无法读取。其他设置仍可使用。</p>
        <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>重试通知设置</Button>
      </div>
    </>
  }

  if (props.status !== 'ready' || saved === null) {
    return <>
      <header className={styles.header}><h2>通知</h2></header>
      <div role="status" aria-label="正在加载通知设置" className={styles.skeletons}>
        <Skeleton className={styles.skeleton} />
        <Skeleton className={styles.skeleton} />
      </div>
    </>
  }

  const dirty = form.formState.isDirty
  const pending = props.saving

  return <>
    <header className={styles.header}><h2>通知</h2></header>
    <p className={styles.intro}>管理站内通知。关闭可选分类只影响未来接收，已有通知保留。</p>

    <form onSubmit={submit} noValidate className={styles.form}>
      {OPTIONAL_FIELDS.map(field => <Field key={field.name} orientation="horizontal"
        className={styles.row}>
        <FieldContent>
          <FieldLabel htmlFor={`${fieldId}-${field.name}`}>{field.label}</FieldLabel>
          <FieldDescription>{field.description}</FieldDescription>
        </FieldContent>
        <Switch id={`${fieldId}-${field.name}`} disabled={pending}
          checked={form.watch(field.name)}
          onCheckedChange={checked => form.setValue(field.name, checked, { shouldDirty: true })} />
      </Field>)}

      <section className={styles.necessary} aria-label="必要通知">
        <h3 className={styles.necessaryTitle}>必要通知</h3>
        {props.necessaryCategories.length === 0
          ? <p className={styles.necessaryBody}>当前没有固定为必要的通知类别。</p>
          : props.necessaryCategories.map(category => <div key={category} className={styles.row}>
            <FieldContent>
              <FieldLabel>{notificationCategoryLabel(category)}</FieldLabel>
              <FieldDescription>
                由系统固定的必要通知，不能关闭；关闭上方可选分类不会影响它。
              </FieldDescription>
            </FieldContent>
            <Switch checked disabled aria-label={`${notificationCategoryLabel(category)}（必要，不可关闭）`} />
          </div>)}
      </section>

      <div className={styles.saveRow}>
        <p className={styles.draftState} role="status">
          {dirty ? '有尚未保存的更改' : '当前设置已保存'}
        </p>
        <div className={styles.saveActions}>
          <Button type="submit" size="sm" disabled={!dirty || pending}>
            {pending ? '保存中…' : '保存更改'}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!dirty || pending}
            onClick={() => {
              setServerError(null)
              form.reset(saved)
              setCancelled(true)
            }}>取消更改</Button>
          {props.conflict && <Button type="button" variant="ghost" size="sm"
            disabled={pending} onClick={() => {
              setServerError(null)
              setCancelled(false)
              props.onRefresh()
            }}>核对最新版本（保留草稿）</Button>}
        </div>
        {serverError && <p className={styles.error} role="alert">{serverError}</p>}
        {props.message && !serverError &&
          <p className={styles.message} role="status">{props.message}</p>}
        {cancelled && !serverError && !props.message &&
          <p className={styles.message} role="status">更改已取消。</p>}
      </div>
    </form>
  </>
}
