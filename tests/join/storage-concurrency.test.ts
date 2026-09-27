import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { experiencedJoinApplication, newJoinApplication } from '../helpers/auth'
const requireServer = createRequire(new URL('../../apps/mock-server/package.json',import.meta.url))
const tsx = pathToFileURL(requireServer.resolve('tsx')).href, databaseModule=pathToFileURL(requireServer.resolve('better-sqlite3')).href
const joinModule=new URL('../../apps/mock-server/src/join/service.ts',import.meta.url).href
const invitationModule=new URL('../../apps/mock-server/src/invitations/service.ts',import.meta.url).href
const migrations=new URL('../../apps/mock-server/drizzle/',import.meta.url)
const journal=JSON.parse(readFileSync(new URL('meta/_journal.json',migrations),'utf8')) as {entries:Array<{tag:string}>}

it('arbitrates one lifetime email across separate concurrent SQLite connections and categories', async () => {
  const directory=mkdtempSync(resolve(tmpdir(),'exwebsite-join-race-')), path=resolve(directory,'isolated.sqlite'), sqlite=new Database(path)
  const children:Array<ReturnType<typeof spawn>>=[]
  try {
    sqlite.pragma('foreign_keys=ON'); sqlite.pragma('journal_mode=WAL')
    sqlite.transaction(()=>{for(const {tag} of journal.entries)sqlite.exec(readFileSync(new URL(`${tag}.sql`,migrations),'utf8').replaceAll('--> statement-breakpoint',''))})()
    const source=`import Database from ${JSON.stringify(databaseModule)};
      import {JoinService} from ${JSON.stringify(joinModule)};
      import {InvitationService} from ${JSON.stringify(invitationModule)};
      const sqlite=new Database(process.argv[1]);sqlite.pragma('foreign_keys=ON');sqlite.pragma('busy_timeout=10000');
      const join=new JoinService(new InvitationService({sqlite,codeHmacKey:Buffer.alloc(32),now:()=>1800000000000}));
      let input='';process.stdin.on('data',data=>input+=data);process.stdin.on('end',()=>{try{join.submit(JSON.parse(input));console.log('received')}catch(error){console.log(error.code??'internal')}finally{sqlite.close()}});console.log('ready');`
    const running = [newJoinApplication(' RACE@EXAMPLE.COM '),experiencedJoinApplication('race@example.com')].map(payload=>{
      const child=spawn(process.execPath,['--import',tsx,'--input-type=module','-e',source,path],{stdio:['pipe','pipe','pipe']});children.push(child)
      let output='',error=''; let ready!:()=>void
      const readiness=new Promise<void>((resolve,reject)=>{ready=resolve;child.on('error',reject);child.on('exit',exit=>{if(exit!==0)reject(new Error(error))})})
      child.stdout!.on('data',data=>{output+=data.toString();if(/ready\r?\n/.test(output))ready()});child.stderr!.on('data',data=>error+=data.toString())
      const finished=new Promise<string>((resolve,reject)=>{child.on('error',reject);child.on('exit',exit=>{if(exit!==0)reject(new Error(error));else resolve(output.trim().split('\n').at(-1)!)} )})
      void finished.catch(()=>{})
      return {payload,child,readiness,finished}
    })
    await Promise.all(running.map(item=>item.readiness))
    sqlite.exec('BEGIN IMMEDIATE')
    running.forEach(item=>item.child.stdin!.end(JSON.stringify(item.payload)))
    await new Promise(resolve=>setTimeout(resolve,40));sqlite.exec('COMMIT')
    const results=await Promise.all(running.map(item=>item.finished));expect(results.sort()).toEqual(['JOIN_APPLICATION_EXISTS','received'])
    expect(sqlite.prepare('SELECT count(*) n FROM join_applications').get()).toEqual({n:1})
    expect(sqlite.prepare('SELECT count(*) n FROM join_application_email_registry').get()).toEqual({n:1})
    expect(sqlite.prepare('SELECT count(*) n FROM join_application_forms').get()).toEqual({n:1})
    expect(sqlite.prepare('SELECT count(*) n FROM join_applications a JOIN join_application_forms f ON f.application_id=a.id WHERE a.form_version=1 AND f.version=1').get()).toEqual({n:1})
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    children.forEach(child=>child.kill());if(sqlite.inTransaction)sqlite.exec('ROLLBACK');sqlite.close();rmSync(directory,{recursive:true,force:true})
  }
},15000)
