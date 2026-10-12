// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor,act} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const api=vi.hoisted(()=>({POST:vi.fn(),GET:vi.fn(),DELETE:vi.fn().mockResolvedValue({state:'cancelled'})}))
vi.mock('@web/src/api/client',()=>({api}))
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks()})
async function component() {
  const source='@web/src/registration/CfxAuthorization'
  const module=await import(/* @vite-ignore */ source).catch(()=>undefined)
  expect(module,'real Cfx browser orchestration must exist').toBeDefined()
  return module!.CfxAuthorization
}
const attempt={attemptId:'a'.repeat(43),mode:'manual',authorizationUrl:'https://forum.cfx.re/user-api-key/new?nonce=x',expiresAt:Date.now()+600_000}
it('manual flow only exchanges a ready ticket and never sends the displayed identity as authentication',async()=>{
  const CfxAuthorization=await component(),user=userEvent.setup(),received:Array<string>=[]
  api.POST.mockResolvedValueOnce(attempt).mockResolvedValueOnce({attemptId:attempt.attemptId,state:'ready'})
  api.GET.mockResolvedValue({attemptId:attempt.attemptId,state:'ready',identityTicket:'t'.repeat(43),ticketExpiresAt:Date.now()+30_000,identity:{email:'untrusted@example.com'}})
  render(<CfxAuthorization onTicket={async(ticket:string,id:string)=>{received.push(`${id}:${ticket}`)}} />)
  await user.click(screen.getByRole('button',{name:'使用 Cfx'}))
  await user.type(await screen.findByLabelText('加密授权结果'),'encrypted')
  await user.click(screen.getByRole('button',{name:'完成 Cfx 授权'}))
  await waitFor(()=>expect(received).toEqual([`${attempt.attemptId}:${'t'.repeat(43)}`]))
  expect(api.POST.mock.calls.map(([path])=>path)).toEqual(['/auth/cfx/attempts','/auth/cfx/attempts/{id}/complete'])
  expect(api.POST.mock.calls[1]![1].body).toEqual({payload:'encrypted'})
})
it('cancel invalidates an in-flight creation and cancels the late attempt without exchanging it',async()=>{
  const CfxAuthorization=await component(),user=userEvent.setup(),received=vi.fn()
  let resolve!:(value:typeof attempt)=>void
  api.POST.mockReturnValueOnce(new Promise(done=>{resolve=done}))
  render(<CfxAuthorization onTicket={received}/>)
  await user.click(screen.getByRole('button',{name:'使用 Cfx'}))
  await user.click(screen.getByRole('button',{name:'取消 Cfx 授权'}))
  await act(async()=>resolve(attempt))
  await waitFor(()=>expect(api.DELETE).toHaveBeenCalled())
  expect(received).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('加密授权结果')).toBeNull()
})
it('a completed manual authorization waits while hidden and exchanges after the page becomes visible',async()=>{
  const CfxAuthorization=await component(),user=userEvent.setup(),received=vi.fn()
  api.POST.mockResolvedValueOnce(attempt).mockResolvedValueOnce({attemptId:attempt.attemptId,state:'ready'})
  api.GET.mockResolvedValue({attemptId:attempt.attemptId,state:'ready',identityTicket:'t'.repeat(43),ticketExpiresAt:Date.now()+30_000})
  render(<CfxAuthorization onTicket={received}/>)
  await user.click(screen.getByRole('button',{name:'使用 Cfx'}))
  const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
  await user.type(await screen.findByLabelText('加密授权结果'),'encrypted')
  await user.click(screen.getByRole('button',{name:'完成 Cfx 授权'}))
  expect(api.GET).not.toHaveBeenCalled()
  visibility.mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')))
  await waitFor(()=>expect(received).toHaveBeenCalled())
})
