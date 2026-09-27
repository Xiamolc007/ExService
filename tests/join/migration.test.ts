import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { JoinService } from '../../apps/mock-server/src/join/service'
import { InvitationService } from '../../apps/mock-server/src/invitations/service'
import { assertAuthSchemaAvailable } from '../../apps/mock-server/src/auth/service'
import { assertJoinSchemaAvailable } from '../../apps/mock-server/src/join/schema-check'
const directory=new URL('../../apps/mock-server/drizzle/',import.meta.url)
const journal=JSON.parse(readFileSync(new URL('meta/_journal.json',directory),'utf8')) as {entries:Array<{tag:string}>}
function apply(db:Database.Database,entries=journal.entries){db.transaction(()=>{for(const {tag} of entries)db.exec(readFileSync(new URL(`${tag}.sql`,directory),'utf8').replaceAll('--> statement-breakpoint',''))})()}
const tables=['auth_users','auth_sessions','auth_sso_requests','community_groups','community_group_memberships']
function snapshot(db:Database.Database){return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))}
it('applies complete fresh journal with no legacy registration tables and checks required structures',()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');expect(()=>assertAuthSchemaAvailable(db)).toThrow('pnpm db:migrate');expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');apply(db);expect(()=>assertAuthSchemaAvailable(db)).not.toThrow();expect(()=>assertJoinSchemaAvailable(db)).not.toThrow();
 expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('auth_registrations','auth_email_delivery')").all()).toEqual([]);expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);db.exec('DROP INDEX join_invitations_active_application_unique');expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');
 }finally{db.close()}
})
it('retains all account/profile/session/SSO/groups, copies cooldown and removes sensitive legacy registrations',async()=>{
 const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');apply(db,journal.entries.slice(0,-1));expect(()=>assertJoinSchemaAvailable(db)).toThrow('pnpm db:migrate');db.exec(`
 INSERT INTO auth_users (id,email,nickname,password_hash,created_at,qq,fivem_id,avatar_key) VALUES ('10000000-0000-4000-8000-000000000001','old@example.com','Existing','original-password-hash',100,'00123','fivem:42','avatar-ref');
 INSERT INTO auth_sessions VALUES ('session-hash','10000000-0000-4000-8000-000000000001',100,9999999999999,NULL);
 INSERT INTO auth_sso_requests VALUES ('sso-hash',100,9999999999999,'completed','10000000-0000-4000-8000-000000000001',101);
 INSERT INTO community_group_memberships VALUES ('10000000-0000-4000-8000-000000000001','admin');
 INSERT INTO auth_email_delivery VALUES ('new@example.com',1800000060000);
 INSERT INTO auth_registrations (id_hash,email,nickname,password_hash,code_digest,status,failed_attempts,last_sent_at,code_expires_at,retain_until)
 VALUES ('registration-secret','new@example.com','Not approved','sensitive-password','sensitive-code','pending',4,1800000000000,1800000600000,1800000700000);
 `);const before=snapshot(db);apply(db,journal.entries.slice(-1));expect(snapshot(db)).toEqual(before);expect(db.prepare('SELECT * FROM join_email_controls').all()).toEqual([{email:'new@example.com',next_send_at:1800000060000,failure_window_started_at:null,failed_attempts:0}]);
 expect(db.prepare('SELECT * FROM join_applications').all()).toEqual([]);expect(db.prepare('SELECT * FROM join_invitations').all()).toEqual([]);expect(()=>db.prepare('SELECT * FROM auth_registrations')).toThrow();expect(()=>db.prepare('SELECT * FROM auth_email_delivery')).toThrow();expect(db.pragma('foreign_key_check')).toEqual([]);expect(()=>assertJoinSchemaAvailable(db)).not.toThrow();
 let now=1800000000000, calls=0;
 const invitations=new InvitationService({sqlite:db,codeHmacKey:Buffer.alloc(32),now:()=>now,deliverInvitation:()=>{calls++}}),join=new JoinService(invitations);
 join.submit({email:'new@example.com',nickname:'New application',qq:'0001'});const id=join.list().items[0]!.id;
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
