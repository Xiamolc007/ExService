import {useState,type ReactNode} from 'react'
import {Button} from '@exre/exui'
import styles from './IdentityLinksPanel.module.scss'
export interface IdentityLinkView {externalUserId:string;externalUsername:string;linkedAt:number}
export function IdentityLinksPanel({link,available,busy,impact,authorization,onUnlink}:{link:IdentityLinkView|null;available:boolean;busy:boolean;impact:string[];authorization:ReactNode;onUnlink:()=>Promise<void>}) {
  const [confirm,setConfirm]=useState(false)
  return <section className={styles.panel} aria-label="关联账户">
    <h2>关联账户</h2>
    <section><h3>Cfx</h3>{link?<>
      <p>{link.externalUsername}</p><p>Cfx ID：{link.externalUserId}</p><p>关联时间：{new Date(link.linkedAt).toLocaleString()}</p>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>setConfirm(true)}>解除 Cfx 关联</Button>
      {confirm&&<section aria-label="解除关联确认"><p>解除后保留本站账号、密码、申请历史及成员资格。</p>
        {impact.length>0&&<p>已加入的社区 {impact.join('、')} 要求 Cfx，解除后须重新关联才能满足要求。</p>}
        <Button type="button" disabled={busy} onClick={()=>void onUnlink().then(()=>setConfirm(false)).catch(()=>{})}>确认解除关联</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={()=>setConfirm(false)}>取消</Button>
      </section>}
    </>:available?authorization:<p>Cfx 暂未开放</p>}</section>
    <Button type="button" disabled>Google 暂未开放</Button><Button type="button" disabled>QQ 暂未开放</Button>
  </section>
}
