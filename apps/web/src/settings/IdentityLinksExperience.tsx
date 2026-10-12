import {useEffect,useRef,useState} from 'react'
import {Button,ExMessage} from '@exre/exui'
import {IdentityLinksPanel} from '@workspace/components'
import type {components} from '@workspace/api-client'
import {api} from '@web/src/api/client'
import {CfxAuthorization} from '@web/src/registration/CfxAuthorization'
type Links=components['schemas']['IdentityLinksResponse']
export function IdentityLinksExperience({token}:{token:string|null}) {
  return <OwnedIdentityLinks key={token??'anonymous'} token={token}/>
}
function OwnedIdentityLinks({token}:{token:string|null}) {
  const [links,setLinks]=useState<Links|null>(null),[impact,setImpact]=useState<string[]>([]),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
  const [impactError,setImpactError]=useState<string|null>(null)
  const [impactPending,setImpactPending]=useState(true)
  const owner=useRef(0),controller=useRef<AbortController|null>(null),writing=useRef(false)
  const headers=token?{Authorization:`Bearer ${token}`}:undefined
  useEffect(()=>{
    const version=++owner.current,abort=new AbortController();controller.current=abort;writing.current=false
    setLinks(null);setImpact([]);setImpactError(null);setImpactPending(true);setError(null);setBusy(false)
    if(token)void (async()=>{
      try {
        const result=await api.GET('/auth/me/identity-links',{headers,signal:abort.signal,alert:false})
        if(version===owner.current&&!abort.signal.aborted)setLinks(result)
        try {
        const affected:string[]=[];let offset=0
        while(!abort.signal.aborted){
          const page=await api.GET('/auth/me/communities',{params:{query:{limit:50,offset}},headers,signal:abort.signal,alert:false})
          affected.push(...page.items.filter(item=>item.membership&&item.requiredProviders.includes('cfx')).map(item=>item.communityId))
          offset+=page.items.length;if(offset>=page.total||page.items.length===0)break
        }
        if(version===owner.current&&!abort.signal.aborted)setImpact(affected)
        }catch {if(version===owner.current&&!abort.signal.aborted)setImpactError('暂时无法读取社区影响；若已加入社区要求 Cfx，解除后须重新关联。')}
        finally {if(version===owner.current&&!abort.signal.aborted)setImpactPending(false)}
      }catch {if(version===owner.current&&!abort.signal.aborted)setError('无法读取关联账户，请重试')}
    })()
    return()=>{owner.current++;abort.abort()}
  },[token,reload])
  async function unlink(){
    if(!token||writing.current)return
    const version=owner.current;writing.current=true;setBusy(true);setError(null)
    try {
      await api.DELETE('/auth/me/identity-links/cfx',{headers,signal:controller.current?.signal,alert:false})
      if(version!==owner.current)return
      ExMessage.info('已解除 Cfx 关联');setReload(value=>value+1)
    }catch(issue){if(version===owner.current)setError('解除关联未完成，请重试');throw issue}
    finally{if(version===owner.current){writing.current=false;setBusy(false)}}
  }
  async function link(ticket:string,attemptId:string,signal:AbortSignal){
    if(!token||writing.current)return
    const version=owner.current;writing.current=true;setBusy(true);setError(null)
    try {
      await api.POST('/auth/me/identity-links/cfx',{body:{identityTicket:ticket,attemptId},headers,signal,alert:false})
      if(version!==owner.current||signal.aborted)return
      ExMessage.info('已关联 Cfx');setReload(value=>value+1)
    }catch(issue) {
      // The response may be lost after commit, including an explicit cancellation.
      if(version===owner.current){
        try {
          const current=await api.GET('/auth/me/identity-links',{headers,signal:controller.current?.signal,alert:false})
          if(version===owner.current)setLinks(current)
        }catch {if(version===owner.current)setError('关联结果暂时无法确认，请重新读取关联账户')}
      }
      throw issue
    }finally {if(version===owner.current){writing.current=false;setBusy(false)}}
  }
  if(!token)return <p>登录后可以管理关联账户。</p>
  if(!links)return <section>{error?<><p role="alert">{error}</p><Button onClick={()=>setReload(value=>value+1)}>重试关联账户</Button></>:<p role="status">正在读取关联账户…</p>}</section>
  const cfx=links.providers.find(item=>item.provider==='cfx')!
  return <><IdentityLinksPanel key={`${token}:${reload}`} link={cfx.link} available={cfx.available} busy={busy} impact={impact} onUnlink={unlink}
    authorization={<CfxAuthorization token={token} disabled={busy} onTicket={link}/>} />
    {impactPending&&<p role="status">正在读取社区影响；若已加入社区要求 Cfx，解除后须重新关联。</p>}
    {impactError&&<><p role="status">{impactError}</p><Button onClick={()=>setReload(value=>value+1)}>重试社区影响</Button></>}
    {error&&<><p role="alert">{error}</p><Button onClick={()=>setReload(value=>value+1)}>重新读取关联账户</Button></>}</>
}
