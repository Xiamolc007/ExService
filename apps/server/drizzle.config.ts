import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit 的配置，用于生成后续业务表的 migration。
 *
 * `db:migrate` 不读取本文件：它由 drizzle-orm 的 migrator 按 `drizzle/meta/_journal.json`
 * 应用，因此运行时不会依赖 drizzle-kit。
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
