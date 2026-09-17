/**
 * Drizzle schema 入口。
 *
 * 首版没有业务表：这个文件是后续业务表的唯一合法起点。
 * 新增业务表后，用 `pnpm --filter @workspace/mock-server db:generate -- --name <change>`
 * 生成新的 migration；`drizzle/0000_baseline.sql` 是不可回写的基线。
 */
export {}
