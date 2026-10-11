import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { readContract } from '@tests/helpers/contract'
import { afterEach, expect, it } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { createApp, serviceHandlers } from '@workspace/server'
import { approvedInvitation, createTestAuth, joinSnapshot, newJoinApplication, type TestAuth } from '@tests/helpers/auth'
import { joinMultipart } from '@tests/helpers/multipart'
const contract=readContract(new URL('../../api/generated/openapi.json', import.meta.url))
const definitions=JSON.parse(JSON.stringify(contract.components.schemas).replaceAll('#/components/schemas/','#/definitions/'))
function validate(name:string,value:unknown) { const check=new Ajv({strict:false,allErrors:true}).compile({...definitions[name],definitions});expect(check(value),JSON.stringify(check.errors)).toBe(true) }
const fixtures:TestAuth[]=[],apps:Array<ReturnType<typeof createApp>>=[]
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));await Promise.all(fixtures.splice(0).map(f=>f.close()))})
async function setup(){const f=await createTestAuth();fixtures.push(f);const app=createApp({...f});apps.push(app);return{f,app}}
const schemas:Record<string,string>={submitJoinApplication:'JoinApplicationReceived',listJoinApplications:'JoinApplicationList',getJoinApplication:'JoinApplicationDetail',approveJoinApplication:'JoinApplicationDetail',rejectJoinApplication:'JoinApplicationDetail',resendJoinInvitation:'JoinApplicationDetail',checkInvitationEligibility:'InvitationEligibility',requestInvitationCode:'InvitationCodeAccepted',verifyInvitationCode:'InvitationVerified',completeInvitationRegistration:'InvitationRegistrationCompleted'}
it.each(['http','raw'])('validates all ten operations %s, public review, no-store and no sessions',async(mode)=>{
 const {f,app}=await setup();
 async function invoke(op:keyof typeof serviceHandlers,body?:unknown,applicationId?:string,query?:Record<string,string>){
  if(mode==='raw'){
   const req={body:op==='submitJoinApplication'?{application:body,proofs:[]}:body,params:{applicationId},query,ip:'127.0.0.1',server:f} as unknown as FastifyRequest;const headers:Record<string,string>={};const r={code:()=>r,header:(key:string,value:string)=>{headers[key.toLowerCase()]=value;return r}};
   const value=await (serviceHandlers[op] as (req:FastifyRequest,r:FastifyReply)=>unknown)(req,r as unknown as FastifyReply);validate(schemas[op]!,value);expect(headers['cache-control']).toBe('no-store');return value as any;
  }
  const entry=Object.entries(contract.paths).flatMap(([path,item]:[string,any])=>Object.entries(item).map(([method,operation]:[string,any])=>({path,method,operation}))).find(e=>e.operation.operationId===op)!;
  const response=await app.inject({method:entry.method.toUpperCase() as 'GET'|'POST',url:`/api${entry.path.replace('{applicationId}',applicationId??'')}${query?'?'+new URLSearchParams(query):''}`,...(op==='submitJoinApplication'?joinMultipart(body):{payload:body})});expect(response.statusCode).toBe(['submitJoinApplication','requestInvitationCode'].includes(op)?202:200);expect(response.headers['cache-control']).toBe('no-store');validate(schemas[op]!,response.json());return response.json();
 }
 await invoke('submitJoinApplication',newJoinApplication('member@example.com','Applicant','00123'));
 const list=await invoke('listJoinApplications');const id=list.items[0].id;expect(list.total).toBe(1);
 expect((await invoke('getJoinApplication',undefined,id)).invitation).toBeNull();
 const approved=await invoke('approveJoinApplication',{},id);expect(approved.application.reviewedByUserId).toBeNull();expect(approved.application.deliveryStatus).toBe('sent');
 await invoke('checkInvitationEligibility',{email:'member@example.com'});
 f.advance(60_000);await invoke('resendJoinInvitation',{},id);f.advance(60_000);await invoke('requestInvitationCode',{email:'member@example.com'});
 const verified=await invoke('verifyInvitationCode',{email:'member@example.com',code:f.deliveries.at(-1)!.code});
 expect((await f.db.query<{n:number}>('SELECT count(*) n FROM auth_users')).rows[0]).toEqual({n:0});
 await invoke('completeInvitationRegistration',{completionToken:verified.completionToken,nickname:'Final',password:'valid password'});
 expect((await f.db.query('SELECT nickname, qq, avatar_key, fivem_id FROM auth_users')).rows[0]).toEqual({nickname:'Final',qq:'00123',avatar_key:null,fivem_id:null});expect((await f.db.query<{n:number}>('SELECT count(*) n FROM auth_sessions')).rows[0]).toEqual({n:0});
 await invoke('submitJoinApplication',newJoinApplication('rejected@example.com','Rejected','00009'));const second=(await invoke('listJoinApplications')).items[0];await invoke('rejectJoinApplication',{},second.id);
})
it('removes all old routes and rejects extra request fields and invalid query without coercion',async()=>{
 const {app}=await setup();for(const path of ['','/resend','/cancel','/verify'])expect((await app.inject({method:'POST',url:`/api/auth/registrations${path}`,payload:{}})).statusCode).toBe(404);
 const bodies=[['/join/applications',{email:'a@example.com',nickname:'Name',qq:'123',password:'invalid field'}],['/auth/invitations/check',{email:'a@example.com',code:'123456'}],['/auth/invitations/code',{email:'a@example.com',secret:'x'}],['/auth/invitations/verify',{email:'a@example.com',code:'123456',qq:'1'}],['/auth/invitations/complete',{completionToken:'a'.repeat(43),nickname:'Name',password:'valid password',email:'a@example.com'}]] as const;
 for(const [path,payload] of bodies){const res=await app.inject({method:'POST',url:`/api${path}`,payload});expect(res.statusCode).toBe(path==='/join/applications'?415:400);expect(res.headers['cache-control']).toBe('no-store');validate('ErrorEnvelope',res.json())}
 for(const query of ['limit=0','limit=51','offset=01','offset=1000000000','view=approved'])expect((await app.inject({method:'GET',url:`/api/admin/join/applications?${query}`})).statusCode).toBe(400);
 expect((await app.inject({method:'GET',url:'/api/admin/join/applications?limit=50&offset=0&view=all'})).json()).toMatchObject({limit:50,offset:0});
})
it('exposes fixed check errors, treats checks as read-only, shares IP budget, and ignores forwarded IP',async()=>{
 const {f,app}=await setup();
 const missing=await app.inject({method:'POST',url:'/api/auth/invitations/check',payload:{email:'missing@example.com'}});expect(missing.statusCode).toBe(404);expect(missing.json().error.message).toBe('未找到该邮箱的申请，请先申请加入');
 await f.joinServices.submit(newJoinApplication('pending@example.com','Private','00001'));const pending=await app.inject({method:'POST',url:'/api/auth/invitations/check',payload:{email:'pending@example.com'}});expect(pending.statusCode).toBe(409);expect(pending.body).not.toContain('Private');
 await approvedInvitation(f);const before=await joinSnapshot(f),calls=f.deliveries.length;
 for(let n=0;n<58;n++){const check=await app.inject({method:'POST',url:'/api/auth/invitations/check',headers:{'x-forwarded-for':`10.1.1.${n}`},payload:{email:'member@example.com'}});expect(check.statusCode).toBe(200);expect(Object.keys(check.json())).toEqual(['status','email','serverTime','resendAvailableAt'])}
 expect(await joinSnapshot(f)).toEqual(before);expect(f.deliveries.length).toBe(calls);
 const limited=await app.inject({method:'POST',url:'/api/join/applications',payload:{email:'new@example.com',nickname:'New',qq:'1'}});expect(limited.statusCode).toBe(429);expect(limited.headers['retry-after']).toBe('60');expect(limited.json().error.code).toBe('JOIN_RATE_LIMITED');
})
it('rejects review extras and produces retryable/safe errors through actual glue handlers',async()=>{
 const {f,app}=await setup(),a=await approvedInvitation(f);
 for(const action of ['approve','reject','invitations'])expect((await app.inject({method:'POST',url:`/api/admin/join/applications/${a.id}/${action}`,payload:{reviewedByUserId:'10000000-0000-4000-8000-000000000001'}})).statusCode).toBe(400);
 const cooldown=await app.inject({method:'POST',url:`/api/admin/join/applications/${a.id}/invitations`,payload:{}});expect(cooldown.statusCode).toBe(429);expect(cooldown.json().error.code).toBe('CODE_RESEND_TOO_SOON');expect(cooldown.headers['retry-after']).toBe('60');
 for(let i=0;i<5;i++){const bad=await app.inject({method:'POST',url:'/api/auth/invitations/verify',payload:{email:a.email,code:'000000'}});expect(bad.statusCode).toBe(i===4?429:400);validate('ErrorEnvelope',bad.json());if(i===4)expect(bad.headers['retry-after']).toBe('600')}
 const invalid=await app.inject({method:'POST',url:'/api/auth/invitations/complete',payload:{completionToken:'a'.repeat(43),nickname:'Name',password:'valid password'}});expect(invalid.statusCode).toBe(401);expect(invalid.json().error.code).toBe('COMPLETION_GRANT_INVALID');
 await f.db.query('DROP TABLE join_delivery_attempts');await f.db.query('DROP TABLE join_invitations');const failure=await app.inject({method:'POST',url:'/api/auth/invitations/check',payload:{email:a.email}});expect(failure.statusCode).toBe(500);expect(failure.json().error.message).toBe('An unexpected error occurred.');expect(failure.body).not.toContain('join_invitations');expect(failure.headers['cache-control']).toBe('no-store');
})
it('maps password resource saturation to 503 without creating account/session rows',async()=>{
 const { AuthError }=await import('@server/src/modules/auth/errors');const f=await createTestAuth({passwordHasher:{hash:async()=>{throw new AuthError('AUTH_BUSY',{retryAfterSeconds:1})},verify:async()=>false}});fixtures.push(f);const app=createApp({...f});apps.push(app);const a=await approvedInvitation(f),grant=await f.invitationServices.verifyCode(a.email,a.code);
 const response=await app.inject({method:'POST',url:'/api/auth/invitations/complete',payload:{completionToken:grant.completionToken,nickname:'Name',password:'valid password'}});expect(response.statusCode).toBe(503);expect(response.headers['retry-after']).toBe('1');expect(response.json().error.code).toBe('AUTH_BUSY');expect((await f.db.query<{n:number}>('SELECT count(*) n FROM auth_users')).rows[0]).toEqual({n:0});expect((await f.db.query<{n:number}>('SELECT count(*) n FROM auth_sessions')).rows[0]).toEqual({n:0});
})
