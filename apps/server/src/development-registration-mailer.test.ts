import {expect,it} from 'vitest'
it('development mail simulation requires explicit opt-in and refuses production use',async()=>{
  const path='./development-registration-mailer.js',module=await import(path).catch(()=>undefined)
  expect(module).toBeDefined()
  expect(module!.developmentRegistrationMailer({NODE_ENV:'development'})).toBeUndefined()
  expect(()=>module!.developmentRegistrationMailer({NODE_ENV:'production',SERVER_REGISTRATION_MAIL_SIMULATOR:'true'})).toThrow('SERVER_REGISTRATION_MAIL_SIMULATOR requires development mode.')
  const output:Array<unknown>=[]
  const mailer=module!.developmentRegistrationMailer({NODE_ENV:'development',SERVER_REGISTRATION_MAIL_SIMULATOR:'true'},async(value:unknown)=>{output.push(value)})!
  await mailer.send({recipient:'member@example.com',code:'001234',codeExpiresAt:123,attemptId:'10000000-0000-4000-8000-000000000001',signal:new AbortController().signal})
  expect(output).toEqual([{channel:'registration-mail:development',recipient:'member@example.com',code:'001234',codeExpiresAt:123,attemptId:'10000000-0000-4000-8000-000000000001'}])
})
