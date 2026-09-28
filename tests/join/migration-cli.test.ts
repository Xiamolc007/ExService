import { spawnSync } from 'node:child_process'
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { expect,it } from 'vitest'
const requireServer=createRequire(new URL('../../apps/mock-server/package.json',import.meta.url))
const migrations=new URL('../../apps/mock-server/drizzle/',import.meta.url)
const journal=JSON.parse(readFileSync(new URL('meta/_journal.json',migrations),'utf8')) as {entries:Array<{tag:string}>}

it('executes the real migration CLI logic against an isolated boundary and stops Unicode normalization faults before migration',()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'exwebsite-join-migration-cli-')),databasePath=resolve(directory,'isolated.sqlite'),entry=resolve(directory,'migrate.ts'),client=resolve(directory,'isolated-client.mjs')
 try{
  const db=new Database(databasePath);db.pragma('foreign_keys=ON');db.transaction(()=>{for(const {tag} of journal.entries.slice(0,7))db.exec(readFileSync(new URL(`${tag}.sql`,migrations),'utf8').replaceAll('--> statement-breakpoint',''))})()
  db.prepare("INSERT INTO join_applications (id,email,nickname,qq,status,created_at) VALUES ('unicode-cli-history',?,'Old','1','pending',1)").run('Äprivate@example.com');const before=db.prepare('SELECT * FROM join_applications').all();db.close()
  const actual=readFileSync(new URL('../../apps/mock-server/src/db/migrate.ts',import.meta.url),'utf8')
  // Only dependency paths and the fixed database opener are isolated; the CLI body is unchanged.
  const source=actual.replace("'drizzle-orm/better-sqlite3/migrator'",JSON.stringify(pathToFileURL(requireServer.resolve('drizzle-orm/better-sqlite3/migrator')).href))
   .replace("'@server/src/db/client.js'",JSON.stringify(pathToFileURL(client).href))
   .replace("'@server/src/join/schema-check.js'",JSON.stringify(new URL('../../apps/mock-server/src/join/schema-check.ts',import.meta.url).href))
  writeFileSync(entry,source)
  writeFileSync(client,`import Database from ${JSON.stringify(pathToFileURL(requireServer.resolve('better-sqlite3')).href)};
   import {drizzle} from ${JSON.stringify(pathToFileURL(requireServer.resolve('drizzle-orm/better-sqlite3')).href)};
   export {assertCliEntry} from ${JSON.stringify(new URL('../../apps/mock-server/src/db/client.ts',import.meta.url).href)};
   export const DATABASE_PATH=${JSON.stringify(databasePath)};export function ensureDatabaseDirectory(){}
   export function openDatabase(){const sqlite=new Database(DATABASE_PATH);sqlite.pragma('foreign_keys=ON');return {sqlite,db:drizzle(sqlite)}};`)
  const result=spawnSync(process.execPath,['--import',pathToFileURL(requireServer.resolve('tsx')).href,entry],{encoding:'utf8',timeout:10000})
  expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(result.stderr).toContain('ids=unicode-cli-history');expect(result.stderr).not.toContain('private@example.com')
  const inspect=new Database(databasePath);try{
   expect(inspect.prepare('SELECT * FROM join_applications').all()).toEqual(before)
   expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'join_application_*'").all()).toEqual([])
   expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").all()).toEqual([])
  }finally{inspect.close()}
 }finally{rmSync(directory,{recursive:true,force:true})}
},15000)
