import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, Card } from '@exre/exui'
import { ExMessage, JoinApplicationForm, type JoinApplicationValues, type JoinFormHandle, type JoinFormStep } from '@workspace/components'
import { api } from '../../api/client'
import styles from './JoinPage.module.scss'

export function JoinPage() {
  const [step, setStep] = useState<JoinFormStep>('contact')
  const [received, setReceived] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false), live = useRef(false), form = useRef<JoinFormHandle>(null)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  async function submit(values: JoinApplicationValues) {
    if (pending.current) return
    pending.current = true; setBusy(true)
    try {
      const result = await api.POST('/join/applications', { body: values })
      if (!live.current) return
      if (result.data !== undefined) { setReceived(true); ExMessage.info('申请已收到，请等待审核') }
      else { const message = result.response.status === 429 ? '提交过于频繁，请稍后重试' : '提交失败，请重试'; form.current?.setError(message) }
    } catch { if (live.current) form.current?.setError('提交失败，请重试') }
    finally { pending.current = false; if (live.current) setBusy(false) }
  }
  return <main className={styles.page}>
    <section className={styles.description}><p className={styles.eyebrow}>JOIN EXRE</p><h1>加入我们</h1><p>填写加入申请，与我们一起创造、分享和探索。</p>
      <ol className={styles.stages}><li><h2>提交申请</h2><p>留下邮箱、用户名和 QQ，让我们了解你。</p></li><li><h2>等待审核</h2><p>申请会由审核者查看，请耐心等待。</p></li><li><h2>查收邀请</h2><p>获批后，邮箱将收到注册链接和六位验证码。</p></li><li><h2>完善注册</h2><p>验证邮箱后设置用户名与密码，再前往登录。</p></li></ol>
    </section>
    <Card className={styles.panel}>{received ? <section aria-live="polite"><h2>申请已收到</h2><p>请等待审核，并留意邮箱中的邀请。申请提交不会创建账号。</p><Button asChild variant="outline"><Link to="/">返回首页</Link></Button></section> : <JoinApplicationForm ref={form} step={step} busy={busy} onStepChange={setStep} onSubmit={submit} />}</Card>
  </main>
}
