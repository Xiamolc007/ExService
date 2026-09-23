# 本地数据库生命周期的陷阱

**结论：本地 Mock 数据库没有任何隐式创建或隐式重置路径，这是有意的设计；但 `db:reset` 的清理范围比 `.gitignore` 覆盖的范围更窄。**

_最后更新：2026-09-17_

## 已知陷阱

### 1. 全新 checkout 上 Mock Server 会拒绝启动

`src/server.ts` 在监听前用 `existsSync(DATABASE_PATH)` 检查数据库文件。文件缺失时进程设置非零退出码并打印修复命令，**不会**创建数据库、建表或生成 migration。

因此 `pnpm install` 之后直接 `pnpm dev` 会得到「Mock Server 启动失败」，必须先跑 `pnpm db:migrate`。这不是环境问题，不要通过让服务自动建库来「修好」它。

### 2. `db:migrate` / `db:reset` 被当作模块 import 时会抛错

`src/db/migrate.ts` 与 `src/db/reset.ts` 都在模块顶层调用 `assertCliEntry(import.meta.url)`，且都发生在副作用之前。被 import 时抛错，而不是静默返回。

抛错而不是静默返回，是刻意的取舍：静默返回会让 `pnpm db:migrate` 变成一个「退出码 0 但什么都没做」的命令，比误删开发数据库更难发现。这条取舍见 [数据库变更只由显式命令执行](../decisions/03-database-changes-only-by-explicit-command.md)。

注意 `runMigrations()` 与 `resetDatabase()` 虽然以具名导出存在，也**不能**被 import：抛错发生在模块顶层，导入即触发。需要复用逻辑时只能 import `src/db/client.ts` 中的纯函数（`openDatabase()`、`ensureDatabaseDirectory()` 等）。

### 3. `db:reset` 不清理 rollback journal

`resetDatabase()` 只删除三个固定路径：`mock.sqlite`、`mock.sqlite-wal`、`mock.sqlite-shm`。

`.gitignore` 同时忽略了 `mock.sqlite-journal`（外部工具如 `sqlite3` CLI 可能产生，且可能包含数据页），但该文件不在 `db:reset` 的删除范围内。用外部工具操作过数据库后执行 `db:reset`，可能残留一个未被清理的 journal 文件。

### 4. 路径被固定，不可通过参数或环境变量覆盖

数据库路径、WAL 伴随文件路径都由 `src/db/client.ts` 的常量决定，不接受任何路径参数或环境变量覆盖。这是为了排除「指向生产 MySQL」或「删除任意文件」的可能。如果需要指向别的数据库，那属于新的设计，不是在现有代码里加参数。

### 5. WAL 模式会产生伴随文件

`openDatabase()` 设置 `journal_mode = WAL`，因此 `mock.sqlite` 旁边会出现 `-wal` 与 `-shm`。这三个文件都不提交。

## 证据

- `apps/mock-server/src/db/client.ts`：`DATABASE_PATH`、`DATABASE_SIDECAR_PATHS`、`assertCliEntry`、`openDatabase` 及其注释。
- `apps/mock-server/src/db/reset.ts`、`src/db/migrate.ts`、`src/server.ts`。
- `.gitignore` 中关于 `data/` 与 journal 文件的注释。
- `AGENTS.md` 的「数据库边界」一节。
