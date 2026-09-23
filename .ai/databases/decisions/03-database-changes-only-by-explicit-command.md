# 数据库变更只由显式命令执行

- 状态：已接受
- 模块：`mock-server`
- 日期：2026-09-16
- 来源：`notes/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`「命令语义」

_最后更新：2026-09-17_

## 背景

服务启动时自动建表、自动生成 migration 或自动 reset，在很多后端里是默认做法。但对本地 Mock 数据而言，这些行为都会在用户没有要求的情况下修改或丢弃数据。

同时，`src/db/migrate.ts` 与 `src/db/reset.ts` 既是命令入口，也是包含写库/删库逻辑的模块。

## 决策

- schema 变更只能通过显式命令发生：`pnpm db:migrate`（增量应用）、`pnpm db:reset`（删除固定文件后重建）、`pnpm db:generate`（生成新 migration）。
- `src/server.ts` 在监听前只做数据库文件存在性检查；缺失时明确失败并提示恢复命令，绝不隐式创建、建表或重置。
- `migrate.ts` 与 `reset.ts` 在非直接执行时**抛错**，而不是静默返回。
- `drizzle/0000_baseline.sql` 是不可回写的基线；首个业务表必须由**新的** migration 创建。

## 理由

- 启动期隐式改数据会让「数据怎么没了 / 表怎么多出来了」无法归因到某个动作。
- 抛错而非静默返回是刻意的：静默返回会让 `pnpm db:migrate` 变成一个「退出码 0 但什么都没做」的命令 —— 这比一次明显的错误更难发现。
- 保护 baseline 让「首个业务表」的变更在评审中有明确的差异可看，而不是夹在一个被不断改写的文件里。

## 影响

- 全新 checkout 上必须先执行 `pnpm db:migrate`（或 `db:reset`）才能启动 Mock Server。
- `runMigrations()` 与 `resetDatabase()` 虽然以具名导出存在，但**不能被 import**：抛错发生在模块顶层，导入即触发。复用逻辑只能走 `src/db/client.ts` 中的纯函数。
- `drizzle.config.ts` 只服务于 `drizzle-kit generate`；`db:migrate` 不读取它，运行时也不依赖 `drizzle-kit`。

## 重新审视的条件

- 需要自动化地初始化本地环境（应把命令串进流程，而不是让服务自动建库）。
- 引入 CI 或容器化的本地环境时。

## 证据

- `apps/mock-server/src/server.ts` 的前置检查与错误提示。
- `apps/mock-server/src/db/client.ts` 的 `assertCliEntry()` 及其注释。
- `apps/mock-server/src/db/migrate.ts`、`src/db/reset.ts`。
- `apps/mock-server/drizzle/0000_baseline.sql` 的头部注释。
- `AGENTS.md` 的「数据库边界」。
