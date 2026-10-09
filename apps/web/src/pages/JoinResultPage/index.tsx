import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Alert, AlertDescription, Button, Card, Field, FieldContent, FieldError, FieldLabel, Input } from '@exre/exui'
import type { components } from '@workspace/api-client'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import { communityLinks } from '@web/src/join/community'
import styles from '@web/src/pages/JoinResultPage/JoinResultPage.module.scss'

type Result = components['schemas']['JoinApplicationResult']
const querySchema = z.object({ email: z.string().trim().toLowerCase().refine(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && Array.from(value).length <= 254, '请输入有效的邮箱地址') })
type QueryDraft = z.infer<typeof querySchema>
const results = {
  not_found: { action: 'apply', title: '未查到申请', description: '请确认邮箱是否与提交时一致；未申请可以返回加入页。', href: '/join/rifling-911', link: '返回加入页' },
  pending: { action: 'wait', title: '待审核', description: '已收到申请，请保持联系并等待社区审核与安排。你可以再次主动查询。' },
  approved: { action: 'register', title: '已通过', description: '请前往完善注册。验证码从邀请邮件获取，未收到可按注册流程重发；已通过不代表邮件已送达。', href: '/register', link: '完善注册' },
  rejected: { action: 'contact_community', title: '已拒绝', description: '本次申请未通过，不能再次提交。需要了解后续安排时请联系社区。' },
  invitation_expired: { action: 'contact_community', title: '邀请到期', description: '申请已获批，但邀请已到期。请联系社区重新发送邀请，无需重填申请。' },
  registered: { action: 'login', title: '已完成注册', description: '账号已完成注册，可以前往登录。', href: '/login', link: '前往登录' },
} satisfies Record<Result['status'], { action: Result['nextAction']; title: string; description: string; href?: string; link?: string }>

function QueryForm({ busy, onQuery, onEdit }: { busy: boolean; onQuery: (value: QueryDraft) => void; onEdit: () => void }) {
  const id = useId()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<QueryDraft>({ resolver: zodResolver(querySchema), defaultValues: { email: '' } })
  const email = register('email', { onChange: onEdit })
  return <form className={styles.form} noValidate aria-busy={busy} onSubmit={handleSubmit(value => { if (!busy) onQuery(value) })}>
    <Field data-invalid={Boolean(errors.email)}><FieldContent><FieldLabel htmlFor={`${id}-email`}>申请邮箱</FieldLabel><Input id={`${id}-email`} type="email" autoComplete="email" {...email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? `${id}-error` : undefined} />{errors.email && <FieldError id={`${id}-error`}>{errors.email.message}</FieldError>}</FieldContent></Field>
    <Button type="submit" disabled={busy || isSubmitting}>{busy ? '正在查询' : '查询结果'}</Button>
  </form>
}

export function JoinResultPage() {
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const generation = useRef(0), mounted = useRef(false), pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  function edit() { generation.current++; pending.current = false; setResult(null); setError(null); setBusy(false) }
  function query(value: QueryDraft) {
    if (pending.current) return
    const current = ++generation.current
    pending.current = true; setBusy(true); setResult(null); setError(null)
    const active = () => mounted.current && generation.current === current
    const body: components['schemas']['JoinApplicationQueryRequest'] = value
    void api.POST('/join/applications/query', { body, alert: false }).then(data => {
      if (!active()) return
      if (data && Object.hasOwn(results, data.status) && results[data.status].action === data.nextAction) setResult(data)
      else setError('查询失败，请检查网络后重新查询')
    }).catch(error => { if (active()) setError(error instanceof ExAxiosError && error.status === 429 ? '查询过于频繁，请稍后再试' : '查询失败，请检查网络后重新查询') }).finally(() => { if (active()) { pending.current = false; setBusy(false) } })
  }
  const display = result === null ? null : results[result.status]
  return <main className={styles.page}><Button asChild variant="link"><Link to="/join/rifling-911">返回加入页</Link></Button><header><h1>申请结果查询</h1><p>使用提交申请时的邮箱主动查询。查询不会发送验证码，也不会修改申请或邀请。</p></header><Card className={styles.card}><QueryForm busy={busy} onQuery={query} onEdit={edit} />{busy && <p role="status">正在查询申请结果</p>}{error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription><p>请使用上方查询按钮重试。</p></Alert>}{display && <section className={styles.result} aria-live="polite"><h2>{display.title}</h2><p>{display.description}</p>{'href' in display && <Button asChild><Link to={display.href}>{display.link}</Link></Button>}{result?.nextAction === 'contact_community' && <><p>请查看社区置顶通知，联系社区工作人员。</p>{communityLinks.map(link => <Button key={link.label} asChild variant="outline"><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></Button>)}</>}</section>}</Card></main>
}
