import { assertCliEntry } from '@server/src/db/client.js'
import { resetDatabase } from '@server/src/db/reset-plan.js'

assertCliEntry(import.meta.url)

const confirmation = process.argv[2] === '--confirm' ? process.argv[3] : undefined
try {
  await resetDatabase({}, confirmation ?? '')
  console.log('[db:reset] exre 已重建；头像目录未更改。')
} catch {
  console.error('[db:reset] 拒绝重置；请核对目标 exre、显式确认值和对象归属。')
  process.exitCode = 1
}
