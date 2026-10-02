import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { changedTargets, watchExui } from './watch-exui.mjs'

const tokenSources = resolve('fixture/exui/packages/tokens/src')
test('generated token CSS is ignored for both relative and absolute native filenames', () => {
  assert.deepEqual(changedTargets('tokens', tokenSources, 'style.css'), [])
  assert.deepEqual(changedTargets('tokens', tokenSources, resolve(tokenSources, 'style.css')), [])
})

test('Corepack launches and native generated CSS events do not reenter package builds', async () => {
  const fixtureBase = resolve('output/docs-integration-team/watcher-fixtures')
  mkdirSync(fixtureBase, { recursive: true })
  const fixture = mkdtempSync(join(fixtureBase, 'fixture-'))
  const calls = join(fixture, 'calls.jsonl')
  const runner = join(fixture, 'fake-corepack.mjs')
  for (const target of ['tokens', 'components']) for (const subdir of ['src', 'scripts']) {
    mkdirSync(join(fixture, 'packages', target, subdir), { recursive: true })
  }
  writeFileSync(runner, `import {appendFileSync,writeFileSync} from 'node:fs';
    const args=process.argv.slice(2); const pkg=args[2];
    if(args[0]!=='pnpm'||args[1]!=='--filter'||args[3]!=='build')process.exit(1);
    appendFileSync('calls.jsonl',JSON.stringify(pkg)+'\\n');
    if(pkg==='@exre/exui-tokens')writeFileSync('packages/tokens/src/style.css',':root{}');`)
  const records = () => existsSync(calls) ? readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse) : []
  const waitFor = async count => {
    for (let attempt=0;attempt<100;attempt++) { if(records().length>=count)return; await delay(50) }
    assert.fail('ExUI watcher did not finish the expected builds')
  }
  const stop = watchExui({ root: fixture, pnpm: '', corepack: runner })
  try {
    await waitFor(2)
    await delay(500)
    assert.deepEqual(records(), ['@exre/exui-tokens','@exre/exui'])
    appendFileSync(join(fixture,'packages/tokens/src/colors.ts'),'export const color = 1;\n')
    await waitFor(4)
    await delay(500)
    assert.deepEqual(records(), ['@exre/exui-tokens','@exre/exui','@exre/exui-tokens','@exre/exui'])
  } finally {
    stop()
    await delay(200)
    if (dirname(resolve(fixture)) !== fixtureBase) throw new Error('Watcher fixture cleanup escaped its owned directory')
    rmSync(fixture,{recursive:true,force:true})
  }
})
test('authored token changes rebuild tokens then components while component changes stay scoped', () => {
  assert.deepEqual(changedTargets('tokens', tokenSources, 'colors.ts'), ['tokens', 'components'])
  assert.deepEqual(changedTargets('tokens', tokenSources, 'themes/dark.ts'), ['tokens', 'components'])
  assert.deepEqual(changedTargets('components', resolve('fixture/components/src'), 'button/Button.tsx'), ['components'])
  assert.deepEqual(changedTargets('components', resolve('fixture/components/scripts'), 'build.mjs'), ['components'])
})
