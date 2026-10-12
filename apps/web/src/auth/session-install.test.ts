// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {readToken,writeToken} from './storage'
const post=vi.hoisted(()=>vi.fn())
vi.mock('@web/src/api/client',()=>({api:{POST:post}}))
afterEach(()=>{window.localStorage.clear();post.mockReset()})
async function installer(){const path='@web/src/auth/session-install';const module=await import(/* @vite-ignore */path).catch(()=>undefined);expect(module).toBeDefined();return module!.installBrowserSession}
it('a storage replacement during old-session logout survives a late sign-in response',async()=>{
  const install=await installer();writeToken(window.localStorage,'old')
  let done!:()=>void;post.mockReturnValue(new Promise<void>(resolve=>{done=resolve}))
  const installing=install('new',()=>true)
  writeToken(window.localStorage,'other-tab');done()
  expect(await installing).toMatchObject({status:'failed'})
  expect(readToken(window.localStorage)).toBe('other-tab')
})
it('sign-in cancellation cannot install a token after the previous session logout settles',async()=>{
  const install=await installer();writeToken(window.localStorage,'old')
  let done!:()=>void,current=true;post.mockReturnValue(new Promise<void>(resolve=>{done=resolve}))
  const installing=install('new',()=>current);current=false;done()
  expect(await installing).toEqual({status:'stale'})
  expect(readToken(window.localStorage)).toBe('old')
})
