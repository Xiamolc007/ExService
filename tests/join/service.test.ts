import { afterEach, expect, it, vi } from 'vitest'
import { approvedInvitation, createTestAuth, joinSnapshot, registerInvited } from '../helpers/auth'
import { JoinRateLimiter } from '../../apps/mock-server/src/join/rate-limiter'
import { publicWebBaseUrl } from '../../apps/mock-server/src/invitations/mail'
const fixtures:Array<ReturnType<typeof createTestAuth>>=[]
afterEach(()=>{vi.useRealTimers();fixtures.splice(0).forEach(f=>f.close())})
function setup(overrides:Parameters<typeof createTestAuth>[0]={}){const f=createTestAuth(overrides);fixtures.push(f);return f}
const error=(code:string)=>expect.objectContaining({code})
const input=(completionToken:string,nickname='Final',password='valid password')=>({completionToken,nickname,password})
it('deduplicates without overwriting original values, hides account existence and permits rejected reapplication',async()=>{
 const f=setup();f.joinServices.submit({email:'  MEMBER@EXAMPLE.COM  ',nickname:'  Original  ',qq:'000123'});f.joinServices.submit({email:'member@example.com',nickname:'Changed',qq:'999'});
 const list=f.joinServices.list();expect(list.total).toBe(1);expect(list.items[0]).toMatchObject({nickname:'Original',qq:'000123',email:'member@example.com',reviewedByUserId:null});const id=list.items[0]!.id;
 const rejected=f.joinServices.reject(id);expect(rejected.application.status).toBe('rejected');expect(f.joinServices.reject(id)).toEqual(rejected);await expect(f.joinServices.approve(id)).rejects.toMatchObject({code:'JOIN_STATE_CONFLICT'});
 f.joinServices.submit({email:'member@example.com',nickname:'Second',qq:'2'});expect(f.joinServices.list({view:'all'}).total).toBe(2);expect(f.joinServices.list().total).toBe(1);
 await f.seedUser({email:'account@example.com',nickname:'Existing',password:'valid password'});expect(f.joinServices.submit({email:'account@example.com',nickname:'Hidden',qq:'1'})).toEqual({status:'received'});expect(f.joinServices.list({view:'all'}).total).toBe(2);
})
it('keeps cooldown approval rejection entirely read-only even with expired rows and stale pending deliveries',async()=>{
 const f=setup();const old=await approvedInvitation(f,'old@example.com');f.advance(7*86_400_000);
 // Simulate a restart with abandoned delivery and stale active invitation.
 f.sqlite.prepare("UPDATE join_delivery_attempts SET status='pending', finished_at=NULL").run();
 f.joinServices.submit({email:'new@example.com',nickname:'New',qq:'1'});
 f.sqlite.prepare("UPDATE join_invitations SET status='active', code_digest='sensitive', code_expires_at=?, completion_token_hash='old-grant', completion_expires_at=? WHERE application_id=?").run(f.now()-1,f.now()-1,old.id);
 f.sqlite.prepare("UPDATE join_delivery_attempts SET status='pending', finished_at=NULL").run();
 f.sqlite.prepare('INSERT INTO join_email_controls (email,next_send_at,failed_attempts) VALUES (?, ?, 0)').run('new@example.com',f.now()+60_000);
 const id=f.joinServices.list().items[0]!.id;
 // List cleans stale rows: restore them immediately before testing the gate.
 f.sqlite.prepare("UPDATE join_invitations SET status='active', code_digest='sensitive', code_expires_at=?, completion_token_hash='old-grant', completion_expires_at=? WHERE application_id=?").run(f.now()-1,f.now()-1,old.id);f.sqlite.prepare("UPDATE join_delivery_attempts SET status='pending', finished_at=NULL").run();
 const before=joinSnapshot(f);await expect(f.joinServices.approve(id)).rejects.toMatchObject({code:'CODE_RESEND_TOO_SOON',retryAfterSeconds:60});expect(joinSnapshot(f)).toEqual(before);
 f.advance(60_000);const approved=await f.joinServices.approve(id);expect(approved.application.status).toBe('approved');const after=joinSnapshot(f);expect(await f.joinServices.approve(id)).toEqual(approved);expect(joinSnapshot(f)).toEqual(after);expect(f.deliveries.length).toBe(2);
})
it('makes same approval idempotent and allows only one concurrent opposite decision',async()=>{
 const f=setup();f.joinServices.submit({email:'member@example.com',nickname:'Member',qq:'1'});const id=f.joinServices.list().items[0]!.id;
 const approving=f.joinServices.approve(id);expect(()=>f.joinServices.reject(id)).toThrow(error('JOIN_STATE_CONFLICT'));await approving;await f.joinServices.approve(id);expect(f.deliveries.length).toBe(1);
 const reject=setup();reject.joinServices.submit({email:'member@example.com',nickname:'Member',qq:'1'});const rejectId=reject.joinServices.list().items[0]!.id;reject.joinServices.reject(rejectId);await expect(reject.joinServices.approve(rejectId)).rejects.toMatchObject({code:'JOIN_STATE_CONFLICT'});
})
it('checks all eligibility cases without touching any tables or dependencies',async()=>{
 const f=setup({deliverInvitation:()=>{throw new Error('private provider failure')}});
 expect(()=>f.invitationServices.checkEligibility('unknown@example.com')).toThrow(error('INVITATION_APPLICATION_NOT_FOUND'));
 f.joinServices.submit({email:'pending@example.com',nickname:'Pending',qq:'1'});expect(()=>f.invitationServices.checkEligibility('pending@example.com')).toThrow(error('INVITATION_NOT_ELIGIBLE'));const pending=f.joinServices.list().items[0]!.id;f.joinServices.reject(pending);expect(()=>f.invitationServices.checkEligibility('pending@example.com')).toThrow(error('INVITATION_NOT_ELIGIBLE'));
 const approved=await approvedInvitation(f);expect(f.joinServices.get(approved.id).application.deliveryStatus).toBe('failed');
 f.advance(600_000);let before=joinSnapshot(f);expect(f.invitationServices.checkEligibility('member@example.com').status).toBe('eligible');expect(joinSnapshot(f)).toEqual(before);expect(f.deliveries.length).toBe(1);
 await f.invitationServices.requestCode('member@example.com');const grant=f.invitationServices.verifyCode('member@example.com',f.deliveries.at(-1)!.code);before=joinSnapshot(f);expect(f.invitationServices.checkEligibility('member@example.com').status).toBe('eligible');expect(joinSnapshot(f)).toEqual(before);
 await f.invitationServices.complete(input(grant.completionToken));before=joinSnapshot(f);expect(()=>f.invitationServices.checkEligibility('member@example.com')).toThrow(error('INVITATION_NOT_ELIGIBLE'));expect(joinSnapshot(f)).toEqual(before);
 const expired=await approvedInvitation(f,'expired@example.com');f.advance(7*86_400_000);before=joinSnapshot(f);expect(()=>f.invitationServices.checkEligibility(expired.email)).toThrow(error('INVITATION_NOT_ELIGIBLE'));expect(joinSnapshot(f)).toEqual(before);
})
it('does not require usable code or reset locks during read-only eligibility checks',async()=>{
 const f=setup();const {email}=await approvedInvitation(f);for(let n=1;n<=5;n++)expect(()=>f.invitationServices.verifyCode(email,'000000')).toThrow(error(n===5?'INVITATION_CODE_LOCKED':'INVITATION_CODE_INVALID'));
 const before=joinSnapshot(f);expect(f.invitationServices.checkEligibility(email).status).toBe('eligible');expect(joinSnapshot(f)).toEqual(before);expect(()=>f.invitationServices.verifyCode(email,f.deliveries[0]!.code)).toThrow(error('INVITATION_CODE_LOCKED'));
})
it('shares resend cooldown, preserves failure windows across code changes and unlocks at the exact window boundary',async()=>{
 const codes=[42,43,44],f=setup({randomInteger:()=>codes.shift()??45});const {id,email}=await approvedInvitation(f);expect(f.deliveries[0]!.code).toBe('000042');
 expect(()=>f.invitationServices.verifyCode(email,'111111')).toThrow(error('INVITATION_CODE_INVALID'));f.advance(59_000);await expect(f.joinServices.resend(id)).rejects.toMatchObject({code:'CODE_RESEND_TOO_SOON',retryAfterSeconds:1});
 expect(await f.invitationServices.requestCode(email)).toEqual({status:'accepted',serverTime:f.now(),resendAvailableAt:f.now()+60_000});expect(f.deliveries.length).toBe(1);
 f.advance(1_000);await f.joinServices.resend(id);expect(f.deliveries[1]!.code).toBe('000043');expect(()=>f.invitationServices.verifyCode(email,'000042')).toThrow(error('INVITATION_CODE_INVALID'));
 for(let n=0;n<3;n++)expect(()=>f.invitationServices.verifyCode(email,'111111')).toThrow(error(n===2?'INVITATION_CODE_LOCKED':'INVITATION_CODE_INVALID'));
 expect(f.sqlite.prepare('SELECT failed_attempts FROM join_email_controls WHERE email=?').get(email)).toEqual({failed_attempts:5});f.advance(60_000);await f.invitationServices.requestCode(email);expect(()=>f.invitationServices.verifyCode(email,'000044')).toThrow(error('INVITATION_CODE_LOCKED'));
 f.advance(480_000);expect(f.invitationServices.verifyCode(email,'000044').status).toBe('verified');
})
it('commits unknown-email failed attempts and uses the same lock window',()=>{
 const f=setup();for(let n=1;n<=5;n++)expect(()=>f.invitationServices.verifyCode('unknown@example.com','000000')).toThrow(error(n===5?'INVITATION_CODE_LOCKED':'INVITATION_CODE_INVALID'));
 expect(f.sqlite.prepare('SELECT failed_attempts FROM join_email_controls').get()).toEqual({failed_attempts:5});f.advance(599_999);expect(()=>f.invitationServices.verifyCode('unknown@example.com','000000')).toThrow(expect.objectContaining({code:'INVITATION_CODE_LOCKED',retryAfterSeconds:1}));f.advance(1);expect(()=>f.invitationServices.verifyCode('unknown@example.com','000000')).toThrow(error('INVITATION_CODE_INVALID'));expect(f.sqlite.prepare('SELECT failed_attempts FROM join_email_controls').get()).toEqual({failed_attempts:1});
})
it('expires code at ten minutes without increasing guesses and expires invitations at seven days',async()=>{
 const f=setup(),a=await approvedInvitation(f);f.advance(600_000);expect(()=>f.invitationServices.verifyCode(a.email,a.code)).toThrow(error('INVITATION_CODE_INVALID'));expect(f.sqlite.prepare('SELECT failed_attempts FROM join_email_controls').get()).toEqual({failed_attempts:0});
 await f.invitationServices.requestCode(a.email);const grant=f.invitationServices.verifyCode(a.email,f.deliveries.at(-1)!.code);expect(()=>f.invitationServices.verifyCode(a.email,f.deliveries.at(-1)!.code)).toThrow(error('INVITATION_CODE_INVALID'));expect(f.sqlite.prepare('SELECT failed_attempts FROM join_email_controls').get()).toEqual({failed_attempts:0});
 f.advance(7*86_400_000-600_000);expect(()=>f.invitationServices.checkEligibility(a.email)).toThrow(error('INVITATION_NOT_ELIGIBLE'));await expect(f.invitationServices.complete(input(grant.completionToken))).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});
 const refreshed=await f.joinServices.resend(a.id);expect(refreshed.invitation!.expiresAt).toBe(f.now()+7*86_400_000);expect(f.sqlite.prepare('SELECT status FROM join_invitations ORDER BY issued_at').all()).toEqual([{status:'expired'},{status:'active'}]);
})
it('clips code and completion expiry to invitation expiry',async()=>{
 const f=setup(),a=await approvedInvitation(f);f.advance(7*86_400_000-300_000);await f.invitationServices.requestCode(a.email);const mail=f.deliveries.at(-1)!;expect(mail.codeExpiresAt).toBe(mail.invitationExpiresAt);const grant=f.invitationServices.verifyCode(a.email,mail.code);expect(grant.completionExpiresAt).toBe(mail.invitationExpiresAt);f.advance(300_000);await expect(f.invitationServices.complete(input(grant.completionToken))).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});
})
it('replaces completion grants only on new verification and creates an immutable idempotent result',async()=>{
 const f=setup(),a=await approvedInvitation(f),one=f.invitationServices.verifyCode(a.email,a.code);expect(f.sqlite.prepare('SELECT count(*) n FROM auth_users').get()).toEqual({n:0});
 f.advance(60_000);await f.invitationServices.requestCode(a.email);expect(f.sqlite.prepare('SELECT completion_token_hash FROM join_invitations').get()).not.toEqual({completion_token_hash:null});const two=f.invitationServices.verifyCode(a.email,f.deliveries.at(-1)!.code);await expect(f.invitationServices.complete(input(one.completionToken))).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});
 expect(await f.invitationServices.complete(input(two.completionToken,'Chosen'))).toEqual({status:'registered',email:a.email});expect(await f.invitationServices.complete(input(two.completionToken,'Changed','another password'))).toEqual({status:'registered',email:a.email});
 expect(f.sqlite.prepare('SELECT nickname,password_hash,qq,avatar_key,fivem_id FROM auth_users').get()).toEqual({nickname:'Chosen',password_hash:'test-password:valid password',qq:'001234',avatar_key:null,fivem_id:null});expect(f.sqlite.prepare('SELECT count(*) n FROM auth_sessions').get()).toEqual({n:0});expect(f.sqlite.prepare('SELECT count(*) n FROM community_group_memberships').get()).toEqual({n:0});
 f.advance(1_800_000);await expect(f.invitationServices.complete(input(two.completionToken))).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});
})
it('rechecks time after asynchronous hashing before creating any account',async()=>{
 let resolve!:(value:string)=>void;const f=setup({passwordHasher:{hash:()=>new Promise<string>(r=>{resolve=r}),verify:async()=>true}}),a=await approvedInvitation(f),grant=f.invitationServices.verifyCode(a.email,a.code);
 const pending=f.invitationServices.complete(input(grant.completionToken));f.advance(1_800_000);resolve('hashed');await expect(pending).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});expect(f.sqlite.prepare('SELECT count(*) n FROM auth_users').get()).toEqual({n:0});
})
it('allows exactly one concurrent completion and prevents losing hashes from modifying it',async()=>{
 const resolvers:Array<(value:string)=>void>=[],f=setup({passwordHasher:{hash:()=>new Promise<string>(resolve=>resolvers.push(resolve)),verify:async()=>true}}),a=await approvedInvitation(f),grant=f.invitationServices.verifyCode(a.email,a.code);
 const first=f.invitationServices.complete(input(grant.completionToken,'First')),second=f.invitationServices.complete(input(grant.completionToken,'Second'));resolvers[1]!('second-hash');await second;resolvers[0]!('first-hash');expect(await first).toEqual({status:'registered',email:a.email});expect(f.sqlite.prepare('SELECT nickname,password_hash FROM auth_users').all()).toEqual([{nickname:'Second',password_hash:'second-hash'}]);
})
it('rechecks grant replacement and account competition after asynchronous hash',async()=>{
 let release!:(v:string)=>void;const f=setup({passwordHasher:{hash:()=>new Promise<string>(r=>{release=r}),verify:async()=>true}}),a=await approvedInvitation(f),one=f.invitationServices.verifyCode(a.email,a.code);const pending=f.invitationServices.complete(input(one.completionToken));f.advance(60_000);await f.invitationServices.requestCode(a.email);f.invitationServices.verifyCode(a.email,f.deliveries.at(-1)!.code);release('hash');await expect(pending).rejects.toMatchObject({code:'COMPLETION_GRANT_INVALID'});
 const two=f.sqlite.prepare('SELECT completion_token_hash FROM join_invitations').get();expect(two).not.toBeNull();
 const other=setup({passwordHasher:{hash:()=>new Promise<string>(r=>{release=r}),verify:async()=>true}}),b=await approvedInvitation(other),grant=other.invitationServices.verifyCode(b.email,b.code);const competing=other.invitationServices.complete(input(grant.completionToken));other.sqlite.prepare('INSERT INTO auth_users (id,email,nickname,password_hash,created_at) VALUES (?,?,?,?,?)').run('30000000-0000-4000-8000-000000000001',b.email,'External','original',other.now());release('hash');await expect(competing).rejects.toMatchObject({code:'EMAIL_IN_USE'});expect(other.sqlite.prepare('SELECT nickname,password_hash FROM auth_users').get()).toEqual({nickname:'External',password_hash:'original'});
})
it('keeps approval after delivery failure and never stores codes, URLs, tokens or provider errors in database',async()=>{
 const f=setup({deliverInvitation:()=>{throw new Error('provider sensitive exception')}}),a=await approvedInvitation(f);expect(f.joinServices.get(a.id).application.deliveryStatus).toBe('failed');expect(f.invitationServices.checkEligibility(a.email).status).toBe('eligible');await expect(f.joinServices.resend(a.id)).rejects.toMatchObject({code:'CODE_RESEND_TOO_SOON'});
 const before=JSON.stringify(joinSnapshot(f)),code=f.deliveries[0]!.code;expect(before).not.toContain(code);expect(before).not.toContain('provider sensitive');expect(before).not.toContain('/register?');
 const grant=f.invitationServices.verifyCode(a.email,code);expect(JSON.stringify(joinSnapshot(f))).not.toContain(grant.completionToken);await f.invitationServices.complete(input(grant.completionToken));
})
it('marks timeout failed, ignores late adapter success and preserves newer attempt result',async()=>{
 vi.useFakeTimers();let release!:()=>void;const f=setup({deliverInvitation:()=>new Promise<void>(r=>{release=r})});f.joinServices.submit({email:'member@example.com',nickname:'Member',qq:'1'});const id=f.joinServices.list().items[0]!.id,pending=f.joinServices.approve(id);await vi.advanceTimersByTimeAsync(10_000);expect((await pending).application.deliveryStatus).toBe('failed');release();await Promise.resolve();expect(f.joinServices.get(id).application.deliveryStatus).toBe('failed');
 f.advance(60_000);const resend=f.joinServices.resend(id);await Promise.resolve();release();expect((await resend).application.deliveryStatus).toBe('sent');expect(f.sqlite.prepare('SELECT status FROM join_delivery_attempts ORDER BY code_version').all()).toEqual([{status:'failed'},{status:'sent'}]);
})
it('recovers abandoned pending deliveries only on later mutating-flow requests, not check or startup',async()=>{
 const f=setup(),a=await approvedInvitation(f);f.sqlite.prepare("UPDATE join_delivery_attempts SET status='pending',finished_at=NULL").run();f.advance(10_000);const before=joinSnapshot(f);expect(f.invitationServices.checkEligibility(a.email).status).toBe('eligible');expect(joinSnapshot(f)).toEqual(before);f.joinServices.submit({email:'other@example.com',nickname:'Other',qq:'2'});expect(f.sqlite.prepare('SELECT status FROM join_delivery_attempts').get()).toEqual({status:'failed'});
})
it('uses safe base URLs and a bounded expiring IP limiter',()=>{
 for(const url of ['https://user:secret@example.com','https://example.com/path','https://example.com?x=1','https://example.com/#x','javascript:alert(1)','invalid'])expect(()=>publicWebBaseUrl(url)).toThrow();expect(publicWebBaseUrl('https://example.com/')).toBe('https://example.com');
 let now=0;const limiter=new JoinRateLimiter(()=>now);for(let i=0;i<60;i++)expect(limiter.check('ip')).toBeUndefined();expect(limiter.check('ip')).toBe(60);for(let i=0;i<1024;i++)limiter.check(`other-${i}`);expect(limiter.check('ip')).toBeUndefined();now=60_000;expect(limiter.check('ip')).toBeUndefined();
})
it('returns the same anonymous code acceptance for unknown, pending, cooldown and failed deliveries',async()=>{
 const f=setup({deliverInvitation:()=>Promise.reject(new Error('delivery failed'))});const at=f.now(),expected={status:'accepted',serverTime:at,resendAvailableAt:at+60_000};
 expect(await f.invitationServices.requestCode('unknown@example.com')).toEqual(expected);expect(f.sqlite.prepare('SELECT * FROM join_email_controls').all()).toEqual([]);
 f.joinServices.submit({email:'pending@example.com',nickname:'Pending',qq:'1'});expect(await f.invitationServices.requestCode('pending@example.com')).toEqual(expected);const a=await approvedInvitation(f);expect(await f.invitationServices.requestCode(a.email)).toEqual(expected);expect(f.deliveries.length).toBe(1);f.advance(60_000);expect(await f.invitationServices.requestCode(a.email)).toEqual({status:'accepted',serverTime:f.now(),resendAvailableAt:f.now()+60_000});expect(f.joinServices.get(a.id).application.deliveryStatus).toBe('failed');
})
it('fails verification after previously successful eligibility becomes invalid',async()=>{
 const f=setup(),a=await approvedInvitation(f);expect(f.invitationServices.checkEligibility(a.email).status).toBe('eligible');f.advance(7*86_400_000);expect(()=>f.invitationServices.verifyCode(a.email,a.code)).toThrow(error('INVITATION_CODE_INVALID'));expect(f.sqlite.prepare('SELECT count(*) n FROM auth_users').get()).toEqual({n:0});
})
it('limits lazy cleanup to 25 expired records in each category',async()=>{
 const f=setup();for(let i=0;i<30;i++)await approvedInvitation(f,`member-${i}@example.com`);f.advance(7*86_400_000);f.joinServices.submit({email:'trigger@example.com',nickname:'Trigger',qq:'1'});expect(f.sqlite.prepare("SELECT count(*) n FROM join_invitations WHERE status='expired'").get()).toEqual({n:25});
 const last=f.sqlite.prepare("SELECT a.email FROM join_applications a JOIN join_invitations i ON a.id=i.application_id WHERE i.status='active' LIMIT 1").get() as {email:string};const before=joinSnapshot(f);expect(()=>f.invitationServices.checkEligibility(last.email)).toThrow(error('INVITATION_NOT_ELIGIBLE'));expect(joinSnapshot(f)).toEqual(before);
})
