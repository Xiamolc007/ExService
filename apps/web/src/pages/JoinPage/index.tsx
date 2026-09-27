import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, Card } from '@exre/exui'
import { CompleteJoinApplicationModal, ExMessage, type CompleteJoinApplicationModalHandle, type JoinApplicationDraft, type JoinApplicationType } from '@workspace/components'
import { JoinApplicationTextLimitError, submitApplication } from '../../join/client'
import { communityLinks } from '../../join/community'
import styles from './JoinPage.module.scss'

export function JoinPage() {
  const [applicationType, setApplicationType] = useState<JoinApplicationType | null>(null)
  const [step, setStep] = useState(0), [received, setReceived] = useState(false), [busy, setBusy] = useState(false)
  const [serverAction, setServerAction] = useState<'query' | 'login' | null>(null)
  const pending = useRef(false), live = useRef(false), form = useRef<CompleteJoinApplicationModalHandle>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  function open(type: JoinApplicationType, button: HTMLButtonElement) {
    if (pending.current) return
    trigger.current = button; setReceived(false); setServerAction(null); setStep(0); setApplicationType(type)
  }
  function close() { if (!pending.current) { setApplicationType(null); setReceived(false); setServerAction(null) } }
  async function submit(draft: JoinApplicationDraft) {
    if (pending.current) return
    pending.current = true; setBusy(true); setServerAction(null)
    try {
      const result = await submitApplication(draft)
      if (!live.current) return
      if (result.data?.status === 'received') { setReceived(true); ExMessage.info('申请已收到，请等待社区审核安排'); return }
      const code = result.error?.error.code
      if (result.response.status === 409 && code === 'JOIN_APPLICATION_EXISTS') {
        form.current?.setError('该邮箱已有申请，不能重复提交', 'email'); setServerAction('query')
      } else if (result.response.status === 409 && code === 'EMAIL_IN_USE') {
        form.current?.setError('该邮箱已有正式账号，请前往登录', 'email'); setServerAction('login')
      } else {
        const message = result.response.status === 429 ? '提交过于频繁，请稍后重试' : result.response.status === 413 ? '申请文字资料或证明文件超出大小限制，请缩短回答或检查附件数量与大小后重试' : result.response.status === 415 ? '证明文件格式不受支持，请检查后重试' : result.response.status === 503 ? '当前上传繁忙，请稍后重试' : '提交失败，请检查资料并重试'
        form.current?.setError(message)
      }
    } catch (error) { if (live.current) form.current?.setError(error instanceof JoinApplicationTextLimitError ? error.message : '提交失败，请检查网络并重试') }
    finally { pending.current = false; if (live.current) setBusy(false) }
  }
  return <main className={styles.page}>
    <header className={styles.intro}><p className={styles.eyebrow}>JOIN EXRE</p><h1>加入我们</h1><p>在紧急职业模拟中一起创造故事。先了解社区，再选择适合你的申请类别。</p></header>
    <aside className={styles.actions} aria-label="申请入口">
      <Card className={styles.card}><h2>全新玩家</h2><p>尚未接触 FiveM、RP 或紧急服务扮演？从这里开始了解玩法，申请后由社区安排后续指导。</p><Button disabled={busy} onClick={event => open('new', event.currentTarget)}>全新玩家申请</Button></Card>
      <Card className={styles.card}><h2>经验玩家</h2><p>已有其他服务器、RP 或紧急服务扮演经验，且有 100 小时以上相关游玩经历？填写调转资料与笔试。</p><Button disabled={busy} onClick={event => open('experienced', event.currentTarget)}>经验玩家申请</Button></Card>
      <Card className={styles.card}><h2>已经提交过申请？</h2><p>两类申请共用一次邮箱名额，可主动查询当前结果。</p><Button asChild variant="outline"><Link to="/join/result">查询申请结果</Link></Button></Card>
    </aside>
    <div className={styles.information}>
      <section><h2>申请须知</h2><p>申请前请阅读社区置顶指引，确认理解社区规则。资料须真实完整，申请阶段不设置密码，也不会创建正式账号。</p><ul><li>年满 17 周岁且完成高中课程，具备成熟的理解能力。</li><li>具备基本英语能力与清晰表达能力。</li><li>不担任直接干涉其他服务器行政事务的主要职务。</li><li>遵守社区道德、行为规范与服务器政策。</li></ul><p>这些条件由社区人工审核，填写出生日期和申请人类型不会自动决定审核结果。</p></section>
      <section><h2>加入流程</h2><ol className={styles.stages}><li>阅读指引与条件，选择申请类别并提交完整资料。</li><li>等待人工审核与社区安排；线上面试及学院由社区组织。</li><li>获批后查收邮箱邀请，验证邮箱并完善账号。</li><li>登录后跟进学院或社区的后续通知。</li></ol><p>审核同意不代表邮件已送达，未收到邀请可进入完善注册流程按提示重发。</p></section>
      <section><h2>常见问题</h2><dl className={styles.faq}>
        <dt>没有经验也可以申请吗？</dt><dd>可以选择全新玩家申请，按实际情况回答；已有相关经验的玩家选择经验申请。</dd>
        <dt>何时安排面试、何时能有结果？</dt><dd>以社区实际通知为准，不承诺固定时限。无法按时参加面试，请提前联系社区。等待期间可以阅读置顶指引、了解玩法和规则。</dd>
        <dt>还未满足条件怎么办？</dt><dd>请先了解条件并联系社区确认后续安排，资料与情况需要如实填写。</dd>
        <dt>可以更换类别或再次申请吗？</dt><dd>同一邮箱只能提交一次，拒绝、邀请到期和完成注册都不释放名额。请通过结果查询了解状态。</dd>
        <dt>未收到邀请或邀请到期怎么办？</dt><dd>已通过时前往完善注册，按既有流程检查资格或重发验证码；邀请到期请联系社区重新签发，无需重填申请。</dd>
      </dl></section>
      <section><h2>保持联系</h2><p>请留意社区置顶指引与通知，通过社区工作人员了解面试或邀请安排。</p>{communityLinks.length > 0 && <div className={styles.links}>{communityLinks.map(link => <Button key={link.label} asChild variant="outline"><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></Button>)}</div>}</section>
    </div>
    {applicationType !== null && <CompleteJoinApplicationModal key={applicationType} ref={form} open applicationType={applicationType} busy={busy} step={step} onStepChange={setStep} onOpenChange={value => { if (!value) close() }} onSubmit={submit} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }} serverAction={serverAction === 'query' ? <Link to="/join/result">查询已有申请结果</Link> : serverAction === 'login' ? <Link to="/login">前往登录</Link> : undefined}>
      {received ? <section aria-live="polite"><h2>申请已收到</h2><p>资料已提交，请等待社区审核与后续安排。申请提交不会创建账号。</p><p>请保持联系并留意邀请邮箱；你可以主动查询申请结果。</p><Button asChild><Link to="/join/result">查询申请结果</Link></Button><Button variant="outline" onClick={close}>关闭</Button></section> : undefined}
    </CompleteJoinApplicationModal>}
  </main>
}
