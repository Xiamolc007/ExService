import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, Button, Card, ExMessage, Tabs, TabsList, TabsTrigger } from '@exre/exui'
import { JoinReviewDialog, joinApplicationFields, joinApplicationCommitments, joinApplicationSteps } from '@workspace/components'
import type { components } from '@workspace/api-client'
import { api } from '@web/src/api/client'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import styles from '@web/src/pages/JoinReviewPage/JoinReviewPage.module.scss'

type Detail = components['schemas']['JoinApplicationDetail']
type List = components['schemas']['JoinApplicationList']
const statusLabels = { pending: '待审核', approved: '已同意', rejected: '已拒绝' }
const invitationLabels = { active: '有效', expired: '已过期', completed: '已完成' }
const deliveryLabels = { pending: '投递中', sent: '已发送', failed: '投递失败' }
const typeLabels = { new: '全新玩家', experienced: '经验玩家', legacy: '历史简版申请' }
function time(value: number | null | undefined) { return value == null ? '未记录' : new Date(value).toLocaleString() }
function valueAt(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((item, part) => item !== null && typeof item === 'object' ? Reflect.get(item, part) : undefined, value)
}
function ApplicationDetails({ detail, downloading, error, onDownload }: { detail: Detail; downloading: string | null; error: string | null; onDownload: (attachment: components['schemas']['JoinApplicationAttachment']) => void }) {
  const form = detail.form
  return <><dl className={styles.details}><dt>玩家类别</dt><dd>{typeLabels[detail.application.applicationType]}</dd><dt>邮箱</dt><dd>{detail.application.email}</dd><dt>用户名</dt><dd>{detail.application.nickname}</dd><dt>QQ 号</dt><dd>{detail.application.qq}</dd><dt>提交时间</dt><dd>{time(detail.application.createdAt)}</dd></dl>
    {form == null ? <p>历史简版申请：仅保留当时提交的联系资料，没有完整回答、附件或承诺记录。</p> : <>
      {joinApplicationSteps(form.applicationType).map((group, index) => {
        const fields = joinApplicationFields(form.applicationType).filter(field => field.step === index && field.name.startsWith('form.'))
        return fields.length === 0 ? null : <section key={group} className={styles.formGroup}><h3>{group}</h3><dl className={styles.answers}>{fields.map(field => {
          const raw = valueAt(detail, field.name)
          const label = (value: unknown) => field.options?.find(option => option.value === value)?.label ?? String(value ?? '未记录')
          return <div key={field.name}><dt>{field.label}</dt><dd>{Array.isArray(raw) ? raw.map(label).join('、') : label(raw)}</dd></div>
        })}</dl></section>
      })}
      <section className={styles.formGroup}><h3>确认承诺</h3><ul className={styles.commitments}>{joinApplicationCommitments(form.applicationType).map(commitment => <li key={commitment.name}>{commitment.label} <strong>{valueAt(detail, commitment.name) === true ? '已确认' : '未确认'}</strong></li>)}</ul></section>
    </>}
    <section className={styles.formGroup}><h3>证明附件</h3>{error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}{detail.attachments?.length ? <ul className={styles.attachments}>{detail.attachments.map(attachment => <li key={attachment.id}><div><strong>{attachment.originalName}</strong><p>{attachment.extension.toUpperCase()} · {attachment.byteLength.toLocaleString()} 字节</p><p className={styles.digest}>SHA-256：{attachment.sha256}</p></div><Button variant="outline" disabled={downloading !== null} onClick={() => onDownload(attachment)} aria-label={`下载 ${attachment.originalName}`}>{downloading === attachment.id ? '正在下载' : '下载'}</Button></li>)}</ul> : <p>无证明附件</p>}{downloading && <p role="status">正在获取附件，请稍候</p>}</section>
  </>
}

export function JoinReviewPage() {
  const [view, setView] = useState<'pending' | 'all'>('pending'), [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0), [detailReload, setDetailReload] = useState(0)
  const [list, setList] = useState<List | null>(null), [listBusy, setListBusy] = useState(true), [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ id: string; serial: number } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null), [detailBusy, setDetailBusy] = useState(false), [detailError, setDetailError] = useState<string | null>(null)
  const [tab, setTab] = useState<'application' | 'review'>('application')
  const [mutationBusy, setMutationBusy] = useState(false), [blockedUntil, setBlockedUntil] = useState(0), [resendUntil, setResendUntil] = useState(0), [clock, setClock] = useState(Date.now())
  const [downloading, setDownloading] = useState<string | null>(null), [downloadError, setDownloadError] = useState<string | null>(null)
  const downloadPending = useRef(false), objectUrls = useRef(new Map<string, number>())
  const listGeneration = useRef(0), detailGeneration = useRef(0), serial = useRef(0), selection = useRef(selected), mounted = useRef(false)
  const trigger = useRef<HTMLButtonElement | null>(null), mutation = useRef(false)
  const refreshButton = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { mounted.current = true; const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => { mounted.current = false; window.clearInterval(timer); for (const [url, releaseTimer] of objectUrls.current) { window.clearTimeout(releaseTimer); URL.revokeObjectURL(url) }; objectUrls.current.clear() } }, [])
  useEffect(() => {
    const current = ++listGeneration.current
    setListBusy(true); setListError(null)
    void api.GET('/admin/join/applications', { params: { query: { view, limit: '20', offset: String(offset) } }, alert: false }).then(result => {
      if (current !== listGeneration.current || !mounted.current) return
      setList(result)
    }).catch(() => { if (current === listGeneration.current && mounted.current) setListError('无法加载申请列表，请重试') }).finally(() => { if (current === listGeneration.current && mounted.current) setListBusy(false) })
    return () => { listGeneration.current++ }
  }, [view, offset, reload])
  function adopt(data: Detail) { const now = Date.now(), delay = Math.max(0, (data.invitation?.resendAvailableAt ?? data.serverTime) - data.serverTime); setClock(now); setDetail(data); setResendUntil(delay === 0 ? 0 : now + delay) }
  useEffect(() => {
    const current = ++detailGeneration.current
    if (selected === null) { setDetail(null); setDetailBusy(false); return }
    setDetail(null); setDetailBusy(true); setDetailError(null); setBlockedUntil(0)
    void api.GET('/admin/join/applications/{applicationId}', { params: { path: { applicationId: selected.id } }, alert: false }).then(result => {
      if (current !== detailGeneration.current || !mounted.current) return
      adopt(result.formVersion === 0 ? { ...result, form: null } : result)
    }).catch(() => { if (current === detailGeneration.current && mounted.current) setDetailError('无法加载申请详情，请重试') }).finally(() => { if (current === detailGeneration.current && mounted.current) setDetailBusy(false) })
    return () => { detailGeneration.current++ }
  }, [selected, detailReload])
  function open(id: string, button: HTMLButtonElement) {
    const next = { id, serial: ++serial.current }; selection.current = next; trigger.current = button
    setTab('application'); setSelected(next); setDownloadError(null)
  }
  function close() { selection.current = null; detailGeneration.current++; setSelected(null); setDetail(null); setDetailError(null) }
  async function download(attachment: components['schemas']['JoinApplicationAttachment']) {
    if (downloadPending.current || selected === null) return
    const target = selected
    downloadPending.current = true; setDownloading(attachment.id); setDownloadError(null)
    const same = () => mounted.current && selection.current?.serial === target.serial
    try {
      const result = await api.GET('/admin/join/applications/{applicationId}/attachments/{attachmentId}', { params: { path: { applicationId: target.id, attachmentId: attachment.id } }, responseType: 'blob', alert: false })
      if (!same()) return
      const url = URL.createObjectURL(result)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = attachment.originalName; document.body.append(anchor)
      try { anchor.click() } finally {
        anchor.remove()
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url) }, 0)
        objectUrls.current.set(url, timer)
      }
    } catch (error) { if (same()) setDownloadError(error instanceof ExAxiosError && error.status === 503 ? '当前下载繁忙，请稍后重试' : '附件下载失败，请检查网络并重试') }
    finally { downloadPending.current = false; if (mounted.current) setDownloading(null) }
  }
  async function act(action: 'approve' | 'reject' | 'invitations') {
    if (mutation.current || selected === null || detail === null) return
    const target = selected
    mutation.current = true; setMutationBusy(true); setDetailError(null)
    const same = () => mounted.current && selection.current?.serial === target.serial
    try {
      const path = action === 'approve' ? '/admin/join/applications/{applicationId}/approve' : action === 'reject' ? '/admin/join/applications/{applicationId}/reject' : '/admin/join/applications/{applicationId}/invitations'
      const result = await api.POST(path, { params: { path: { applicationId: target.id } }, body: {}, alert: false })
      if (mounted.current) setReload(value => value + 1)
      if (!same()) return
      adopt(result.formVersion === 0 ? { ...result, form: null } : result); ExMessage.info(action === 'reject' ? '申请已拒绝' : '审核与邀请状态已更新')
    } catch (error) {
      if (!same()) return
      if (error instanceof ExAxiosError && error.status === 409) { setDetailReload(value => value + 1); return }
      const seconds = error instanceof ExAxiosError ? error.retryAfterSeconds : undefined
      if (error instanceof ExAxiosError && error.status === 429 && seconds !== undefined && seconds > 0) setBlockedUntil(Date.now() + seconds * 1000)
      setDetailError(error instanceof ExAxiosError && error.status === 429 ? '发送仍在冷却中，请稍后重试' : '操作失败，请刷新详情后重试')
    }
    finally { mutation.current = false; if (mounted.current) setMutationBusy(false) }
  }
  const cooldown = Math.max(0, Math.ceil((Math.max(resendUntil, blockedUntil) - clock) / 1000))
  const approvalWait = Math.max(0, Math.ceil((blockedUntil - clock) / 1000))
  const disabled = mutationBusy || detailBusy
  return <main className={styles.page}><header className={styles.header}><div><h1 ref={heading} tabIndex={-1}>加入申请审核</h1><p>查看加入申请和邀请状态。</p></div><Button ref={refreshButton} variant="outline" disabled={listBusy} onClick={() => setReload(value => value + 1)}>刷新列表</Button></header>
    <Tabs value={view} onValueChange={value => { if (value === 'all' || value === 'pending') { setView(value); setOffset(0) } }}><TabsList><TabsTrigger value="pending">待审核</TabsTrigger><TabsTrigger value="all">全部申请</TabsTrigger></TabsList></Tabs>
    {listError && <Alert variant="destructive" role="alert"><AlertDescription>{listError}</AlertDescription><Button onClick={() => setReload(value => value + 1)}>重试加载</Button></Alert>}
    {listBusy && <p role="status">正在加载申请列表</p>}
    <Card className={styles.list} aria-busy={listBusy}><div className={styles.tableScroll}><table><thead><tr><th scope="col">申请人</th><th scope="col">玩家类别</th><th scope="col">邮箱</th><th scope="col">审核</th><th scope="col">提交时间</th><th scope="col">操作</th></tr></thead><tbody>{list?.items.map(item => <tr key={item.id}><td>{item.nickname}</td><td>{typeLabels[item.applicationType]}</td><td>{item.email}</td><td>{statusLabels[item.status]}</td><td>{time(item.createdAt)}</td><td><Button variant="outline" onClick={event => open(item.id, event.currentTarget)} aria-label={`查看 ${item.nickname}`}>查看</Button></td></tr>)}</tbody></table></div>{!listBusy && list?.items.length === 0 && <p className={styles.empty}>暂无申请</p>}</Card>
    <nav className={styles.pagination} aria-label="申请列表分页"><Button variant="outline" disabled={listBusy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>上一页</Button><span>第 {Math.floor(offset / 20) + 1} 页，共 {list?.total ?? 0} 条</span><Button variant="outline" disabled={listBusy || list === null || offset + 20 >= list.total} onClick={() => setOffset(value => value + 20)}>下一页</Button></nav>
    <JoinReviewDialog open={selected !== null} tab={tab} onTabChange={setTab} onClose={close} onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); else if (refreshButton.current && !refreshButton.current.disabled) refreshButton.current.focus(); else heading.current?.focus() }} loading={detailBusy} error={detailError} onRetry={() => setDetailReload(value => value + 1)}
      application={detail && <ApplicationDetails detail={detail} downloading={downloading} error={downloadError} onDownload={attachment => void download(attachment)} />}
      review={detail && <><dl className={styles.details}><dt>审核状态</dt><dd>{statusLabels[detail.application.status]}</dd><dt>审核人</dt><dd>未记录</dd><dt>审核时间</dt><dd>{time(detail.application.reviewedAt)}</dd><dt>邀请状态</dt><dd>{detail.invitation ? invitationLabels[detail.invitation.status] : '尚未签发'}</dd><dt>邀请有效期至</dt><dd>{time(detail.invitation?.expiresAt)}</dd><dt>完成时间</dt><dd>{time(detail.invitation?.completedAt)}</dd><dt>最近投递</dt><dd>{detail.invitation?.latestDelivery ? deliveryLabels[detail.invitation.latestDelivery.status] : '暂无投递'}</dd></dl>{detail.invitation?.latestDelivery?.status === 'failed' && <p role="status">邀请投递失败，审批已保留。冷却结束后可重新发送。</p>}</>}
      actions={detail && <>{detail.application.status === 'pending' && <><Button disabled={disabled || approvalWait > 0} onClick={() => void act('approve')}>{approvalWait > 0 ? `${approvalWait} 秒后同意` : '同意并发送邀请'}</Button><Button variant="outline" disabled={disabled} onClick={() => void act('reject')}>拒绝申请</Button></>}{detail.application.status === 'approved' && detail.invitation?.status !== 'completed' && <Button disabled={disabled || cooldown > 0} onClick={() => void act('invitations')}>{cooldown > 0 ? `${cooldown} 秒后重发` : '重新发送邀请'}</Button>}{mutationBusy && <span role="status">正在提交</span>}</>} />
  </main>
}
