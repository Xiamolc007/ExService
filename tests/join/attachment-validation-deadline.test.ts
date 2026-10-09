import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect,it } from 'vitest'
const serverRequire=createRequire(new URL('../../apps/server/package.json',import.meta.url))
const loader=pathToFileURL(serverRequire.resolve('tsx')).href
const validator=new URL('../../apps/server/src/join/attachment-validation.ts',import.meta.url).href

it.each([
  ['many BOMs then non-SVG',"'\\uFEFF'.repeat(50000)+'<html/>'",'rejected'],
  ['many comments then non-SVG',"'<!--x-->'.repeat(50000)+'<html/>'",'rejected'],
  ['many comments then an unterminated comment',"'<!--x-->'.repeat(50000)+'<!--unfinished'",'rejected'],
  ['many comments then an unterminated XML declaration',"'<!--x-->'.repeat(50000)+'<?xml version=\"1.0\"'",'rejected'],
  ['large comment prefix then a self-closing SVG',"'<!--x-->'.repeat(50000)+'<svg/>'",'accepted'],
])('validates %s within a separate process hard deadline',(_description,expression,expected)=>{
  const source=`import {validateJoinProofs} from ${JSON.stringify(validator)};
    const content=${expression};
    try {validateJoinProofs([{originalName:'proof.svg',bytes:Buffer.from(content)}],'experienced');console.log('accepted')}
    catch(error){if(error.code!=='JOIN_UNSUPPORTED_MEDIA_TYPE')throw error;console.log('rejected')}`
  const result=spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',source],{encoding:'utf8',timeout:3000,killSignal:'SIGKILL',maxBuffer:64*1024})
  expect(result.error,`child validation must finish before the 3000ms OS deadline: ${result.stderr}`).toBeUndefined()
  expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe(expected)
})
