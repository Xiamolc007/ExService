import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { JoinService } from '../../apps/mock-server/src/join/service'
import { InvitationService } from '../../apps/mock-server/src/invitations/service'
import { assertAuthSchemaAvailable } from '../../apps/mock-server/src/auth/service'
import { assertJoinSchemaAvailable, assertJoinApplicationMigrationReady } from '../../apps/mock-server/src/join/schema-check'
import { newJoinApplication } from '../helpers/auth'
const directory=new URL('../../apps/mock-server/drizzle/',import.meta.url)
const journal=JSON.parse(readFileSync(new URL('meta/_journal.json',directory),'utf8')) as {entries:Array<{tag:string}>}
const serverRequire=createRequire(new URL('../../apps/mock-server/package.json',import.meta.url))
function apply(db:Database.Database,entries=journal.entries){db.transaction(()=>{for(const {tag} of entries)db.exec(readFileSync(new URL(`${tag}.sql`,directory),'utf8').replaceAll('--> statement-breakpoint',''))})()}
const tables=['auth_users','auth_sessions','auth_sso_requests','community_groups','community_group_memberships']
function snapshot(db:Database.Database){return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))}
it('applies complete fresh journal with no legacy registration tables and checks required structures',()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');expect(()=>assertAuthSchemaAvailable(db)).toThrow('pnpm db:migrate');expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');apply(db);expect(()=>assertAuthSchemaAvailable(db)).not.toThrow();expect(()=>assertJoinSchemaAvailable(db)).not.toThrow();
 expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth_registrations','auth_email_delivery')").all()).toEqual([]);expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);db.exec('DROP INDEX join_invitations_active_application_unique');expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');
 }finally{db.close()}
})
it('retains all account/profile/session/SSO/groups, copies cooldown and removes sensitive legacy registrations',async()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');apply(db,journal.entries.slice(0,6));expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');db.exec(`
 INSERT INTO auth_users (id,email,nickname,password_hash,created_at,qq,fivem_id,avatar_key) VALUES ('10000000-0000-4000-8000-000000000001','old@example.com','Existing','original-password-hash',100,'00123','fivem:42','avatar-ref');
 INSERT INTO auth_sessions VALUES ('session-hash','10000000-0000-4000-8000-000000000001',100,9999999999999,NULL);
 INSERT INTO auth_sso_requests VALUES ('sso-hash',100,9999999999999,'completed','10000000-0000-4000-8000-000000000001',101);
 INSERT INTO community_group_memberships VALUES ('10000000-0000-4000-8000-000000000001','admin');
 INSERT INTO auth_email_delivery VALUES ('new@example.com',1800000060000);
 INSERT INTO auth_registrations (id_hash,email,nickname,password_hash,code_digest,status,failed_attempts,last_sent_at,code_expires_at,retain_until)
 VALUES ('registration-secret','new@example.com','Not approved','sensitive-password','sensitive-code','pending',4,1800000000000,1800000600000,1800000700000);
 `);const before=snapshot(db);apply(db,journal.entries.slice(6));expect(snapshot(db)).toEqual(before);expect(db.prepare('SELECT * FROM join_email_controls').all()).toEqual([{email:'new@example.com',next_send_at:1800000060000,failure_window_started_at:null,failed_attempts:0}]);
 expect(db.prepare('SELECT * FROM join_applications').all()).toEqual([]);expect(db.prepare('SELECT * FROM join_invitations').all()).toEqual([]);expect(()=>db.prepare('SELECT * FROM auth_registrations')).toThrow();expect(()=>db.prepare('SELECT * FROM auth_email_delivery')).toThrow();expect(db.pragma('foreign_key_check')).toEqual([]);expect(()=>assertJoinSchemaAvailable(db)).not.toThrow();
 let now=1800000000000, calls=0;
 const invitations=new InvitationService({sqlite:db,codeHmacKey:Buffer.alloc(32),now:()=>now,deliverInvitation:()=>{calls++}}),join=new JoinService(invitations);
 join.submit(newJoinApplication('new@example.com','New application','00001'));const id=join.list().items[0]!.id;
 const beforeApproval=JSON.stringify(Object.fromEntries(['join_applications','join_invitations','join_email_controls','join_delivery_attempts'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()])));
 await expect(join.approve(id)).rejects.toMatchObject({code:'CODE_RESEND_TOO_SOON',retryAfterSeconds:60});
 expect(JSON.stringify(Object.fromEntries(['join_applications','join_invitations','join_email_controls','join_delivery_attempts'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()])))).toBe(beforeApproval);expect(calls).toBe(0);
 now+=60000;expect((await join.approve(id)).application.status).toBe('approved');expect(calls).toBe(1);expect(snapshot(db)).toEqual(before);
 }finally{db.close()}
})
it('enforces application/invitation/delivery uniqueness, review consistency and foreign keys',()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');apply(db);const insert=db.prepare('INSERT INTO join_applications (id,email,nickname,qq,status,created_at,reviewed_at) VALUES (?,?,?,?,?,?,?)');insert.run('a','same@example.com','Applicant','0001','pending',100,null);
 expect(()=>insert.run('b','same@example.com','Other','1','approved',100,100)).toThrow();expect(()=>insert.run('bad','bad@example.com','Bad','1','approved',100,null)).toThrow();db.prepare("UPDATE join_applications SET status='rejected',reviewed_at=101 WHERE id='a'").run();insert.run('b','same@example.com','New','2','approved',102,102);
 db.exec("INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version) VALUES ('i','b','active',100,1000,1)");expect(()=>db.exec("INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version) VALUES ('second','b','active',100,1000,1)")).toThrow();expect(()=>db.exec("UPDATE join_invitations SET status='completed' WHERE id='i'")).toThrow();expect(()=>db.exec("INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version) VALUES ('orphan','missing','active',100,1000,1)")).toThrow();
 db.exec("INSERT INTO join_delivery_attempts (id,invitation_id,code_version,started_at,status) VALUES ('d','i',1,100,'pending')");expect(()=>db.exec("INSERT INTO join_delivery_attempts (id,invitation_id,code_version,started_at,status) VALUES ('repeat','i',1,100,'pending')")).toThrow();expect(()=>db.exec("UPDATE join_delivery_attempts SET status='sent' WHERE id='d'")).toThrow();expect(()=>db.exec("INSERT INTO join_email_controls (email,next_send_at,failed_attempts) VALUES ('email',100,6)")).toThrow();expect(db.pragma('foreign_key_check')).toEqual([]);
 }finally{db.close()}
})
it('upgrades invitation 0.4 history additively, retaining duplicate rejections, completed links and exact QQ', () => {
 const db=new Database(':memory:');try {
  db.pragma('foreign_keys=ON');apply(db,journal.entries.slice(0,7));
  db.exec(`INSERT INTO auth_users (id,email,nickname,password_hash,created_at) VALUES ('user','same@example.com','Member','hash',1);
   INSERT INTO join_applications (id,email,nickname,qq,status,created_at,reviewed_at) VALUES
   ('a','same@example.com','Original','1','approved',1,2),('b','same@example.com','Rejected','00000000000000000001','rejected',3,4),('c','same@example.com','Latest rejected','0001','rejected',3,4);
   INSERT INTO join_invitations (id,application_id,status,issued_at,expires_at,code_version,completed_user_id,completed_at) VALUES ('complete','a','completed',2,999,1,'user',3);
   INSERT INTO join_delivery_attempts VALUES ('delivery','complete',1,2,3,'sent');`)
  const accounts=snapshot(db),history=db.prepare('SELECT * FROM join_applications ORDER BY id').all() as Array<Record<string,unknown>>,
    invitations=db.prepare('SELECT * FROM join_invitations').all(),deliveries=db.prepare('SELECT * FROM join_delivery_attempts').all()
  expect(()=>assertJoinApplicationMigrationReady(db)).not.toThrow();apply(db,journal.entries.slice(7));
  expect(snapshot(db)).toEqual(accounts);expect(db.prepare('SELECT * FROM join_invitations').all()).toEqual(invitations);expect(db.prepare('SELECT * FROM join_delivery_attempts').all()).toEqual(deliveries)
  expect(db.prepare('SELECT * FROM join_applications ORDER BY id').all()).toEqual(history.map(row=>({...row,form_version:0})))
  expect(db.prepare('SELECT * FROM join_application_email_registry').all()).toEqual([{email:'same@example.com',canonical_application_id:'c'}])
  const join=new JoinService(new InvitationService({sqlite:db,codeHmacKey:Buffer.alloc(32),now:()=>1800000000000}))
  expect(join.query({email:'same@example.com'})).toEqual({status:'registered',nextAction:'login'})
  expect(join.get('c')).toMatchObject({formVersion:0,form:null,attachments:[],application:{applicationType:'legacy',qq:'0001'}})
  expect(()=>join.submit(newJoinApplication('same@example.com'))).toThrow(expect.objectContaining({code:'JOIN_APPLICATION_EXISTS'}))
  expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}])
 } finally { db.close() }
})
it.each(['UPPER@example.com',' email@example.com','email@example.com\t','\u00a0email@example.com','email@example.com\ufeff'])('refuses unnormalized SQL history %s without mutating or losing it', email => {
 const db=new Database(':memory:');try {db.pragma('foreign_keys=ON');apply(db,journal.entries.slice(0,7));
  db.prepare("INSERT INTO join_applications (id,email,nickname,qq,status,created_at) VALUES ('bad-history',?,'Old','1','pending',1)").run(email)
  const before=db.prepare('SELECT * FROM join_applications').all();expect(()=>apply(db,journal.entries.slice(7))).toThrow('join_history_normalization_required')
  expect(db.prepare('SELECT * FROM join_applications').all()).toEqual(before)
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'join_application_*'").all()).toEqual([])
 } finally {db.close()}
})
it('detects Unicode uppercase before migration and reports IDs without disclosing stored email', () => {
 const db=new Database(':memory:');try {apply(db,journal.entries.slice(0,7));
  db.prepare("INSERT INTO join_applications (id,email,nickname,qq,status,created_at) VALUES ('unicode-history',?,'Old','1','pending',1)").run('Äprivate@example.com')
  try {assertJoinApplicationMigrationReady(db);throw new Error('audit should fail')} catch(error) {
   expect((error as Error).message).toContain('ids=unicode-history');expect((error as Error).message).not.toContain('private@example.com')
  }
  expect((db.prepare('PRAGMA table_info(join_applications)').all() as Array<{name:string}>).some(row=>row.name==='form_version')).toBe(false)
 } finally {db.close()}
})
it('applies the real Drizzle migration journal incrementally and idempotently on an isolated connection',()=>{
 const db=new Database(':memory:');try{
  db.pragma('foreign_keys=ON')
  const {drizzle}=serverRequire('drizzle-orm/better-sqlite3'),{migrate}=serverRequire('drizzle-orm/better-sqlite3/migrator')
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(directory)})
  expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:journal.entries.length})
  expect(()=>assertJoinSchemaAvailable(db)).not.toThrow()
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(directory)})
  expect(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({n:journal.entries.length})
  expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}])
 }finally{db.close()}
})
