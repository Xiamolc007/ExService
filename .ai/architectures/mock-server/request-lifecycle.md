# `mock-server` 模块：请求生命周期与数据边界

本文件说明 Mock Server 从创建实例到返回响应、以及本地数据库从迁移到重置的结构与流程。表的职责与关系见 [数据库模型](../../databases/data-model.md)，选择理由见 [决策索引](../../decisions/README.md)，失败模式见 [数据库生命周期陷阱](../../databases/knowledge/database-lifecycle-traps.md)。

_最后更新：2026-09-27_

## 组合结构

`src/app.ts` 按固定顺序组装应用，不在这里书写任何路由细节：

1. 读取 Contract 路径 `OPENAPI_PATH`。
2. 创建 Fastify 实例（日志由调用方决定：测试静默，`server.ts` 开启）。
3. 注入必需的 AuthService、ProfileService、JoinService、InvitationService，并注册 404 与统一错误处理。
4. 注册 `fastify-openapi-glue`，显式传入 `specification`、`prefix: API_PREFIX`（`/api`）、`serviceHandlers` 与 Bearer security handler。

`serviceHandlers` 是 `operationId -> handler` 的唯一映射表，并且被导出：Contract Test 需要直接调用它，以校验 handler 的原始返回值。

因此：

- State: 路由、HTTP 方法、输入校验与响应 schema 全部来自 Contract；应用里不存在手写的 `app.get(...)`。
- `createApp()` 接收上述四个服务，可被 `inject()` 测试而不绑定端口；`apps/mock-server/src/server.ts` 拥有数据库连接、监听行为与进程生命周期。
- 包以源码导出（`exports` 指向 `src/app.ts`），Contract Test 通过 `@workspace/mock-server` 导入 `createApp` 与 `serviceHandlers`。

## 路径解析

两处相对路径都依赖「`src/` 下与 `dist/` 下的文件距包根目录层级相同」这一事实，因此开发与构建产物解析到同一位置：

| 常量 | 表达式 | 解析结果 |
| --- | --- | --- |
| `OPENAPI_PATH` | `../../../api/openapi.yaml`（相对 `src/app.ts` / `dist/app.js`） | 仓库根的 `api/openapi.yaml` |
| `DATABASE_PATH` | `../..` + `data/mock.sqlite`（相对 `src/db/*.ts`） | `apps/mock-server/data/mock.sqlite` |
| `MIGRATIONS_FOLDER` | `../../drizzle`（相对 `src/db/*.ts`） | `apps/mock-server/drizzle` |

移动这些文件（例如把 `app.ts` 换到更深一层目录，或把 `db/` 提升一级）会静默指向错误位置，必须同步调整常量。

## 请求处理

- Glue 依据 Contract 注册方法、路径与 schema；handler 只实现行为。
- 响应由 Fastify 用 Contract 的 response schema 序列化后发出。
- 统一错误输出由 `registerErrorHandlers` 负责，见下一节。
- 日志默认带着 Fastify request ID，并与响应中的 `requestId` 对应。

## 错误输出

`src/errors.ts` 是构造错误 envelope 的唯一位置，并区分两类输入：

1. **未声明路径** 由 `setNotFoundHandler` 返回固定的 `NOT_FOUND` 文案。
2. **其他错误** 由 `setErrorHandler` 处理：`error.statusCode` 先被规范到 `[400, 600)`，超出范围一律记作 500，避免异常状态码原样透出。

对外文案只允许两种来源：Fastify 依据 Contract schema 生成的校验错误（`error.validation`），或固定文案。业务错误从 AuthError 固定表读取公开分类；其他异常按状态码归类。日志与响应通过 request ID 关联，日志不序列化原始异常。理由见 `.ai/decisions/mock-server/04-safe-error-messages.md`。

业务错误码及固定文案集中在 `apps/mock-server/src/auth/errors.ts`，统一 envelope 仍只在 `apps/mock-server/src/errors.ts` 构造。普通异常的 `BAD_REQUEST`、`INTERNAL_ERROR`、`NOT_FOUND` 按状态码推导。错误和未声明路径均禁止缓存。

## 启动前置检查

`src/server.ts` 在监听之前检查本地数据库文件是否存在：

- 只绑定 `127.0.0.1:8080`，不对局域网暴露。
- 文件缺失时打印包含 `DATABASE_PATH` 与可执行恢复命令的错误信息，并设置非零退出码，**不**隐式创建或重置数据库。
- 文件存在后检查认证、资料、社区和加入结构，校验 `AUTH_CODE_HMAC_KEY` 与受控邮件链接配置；全部通过后构造服务并监听。启动不执行 migration、数据清理或投递恢复。

## 数据库层

`src/db/` 分成「纯函数」与「CLI 入口」两类：

| 文件 | 性质 | 内容 |
| --- | --- | --- |
| `client.ts` | 纯函数 + 常量 | `DATABASE_PATH`、`DATABASE_SIDECAR_PATHS`、`ensureDatabaseDirectory()`、`assertCliEntry()`、`openDatabase()`。 |
| `migrate.ts` | CLI 入口 | `runMigrations()`：建目录、打开数据库、按 `drizzle/meta/_journal.json` 增量应用 migration。 |
| `reset.ts` | CLI 入口 | `resetDatabase()`：只删除固定的数据库文件与其 WAL/SHM 伴随文件，不删除目录或源码。 |
| `schema.ts` | Drizzle schema 入口 | 声明账号、会话、SSO、社区关系与申请/邀请业务结构；职责见 `.ai/databases/data-model.md`。 |

两个 CLI 入口都在模块顶层、任何副作用之前调用 `assertCliEntry(import.meta.url)`。即使存在具名导出，整个文件仍不可 import；复用数据库纯函数只能从 `apps/mock-server/src/db/client.ts` 引入。

`openDatabase()` 打开（必要时创建）SQLite 文件并设置 `journal_mode = WAL` 与 `foreign_keys = ON`，返回 `{ sqlite, db }`；调用方负责 `sqlite.close()`。认证状态流见 [authentication-lifecycle.md](authentication-lifecycle.md)。

`drizzle.config.ts` 只服务于 `drizzle-kit generate`（生成新的 migration）。`db:migrate` 不读取它，运行时也不依赖 `drizzle-kit`。

## 命令与生命周期

| 命令 | 结构上的行为 |
| --- | --- |
| `pnpm db:migrate` | 创建固定数据库目录与 SQLite 文件，并增量应用未执行的 migration；数据保留或删除由已评审 migration 决定，本次旧注册材料删除影响见 `.ai/databases/data-model.md`。 |
| `pnpm db:reset` | 先执行 `reset.ts`，再执行 `migrate.ts`，因此结果是一个已迁移但无业务数据的数据库。 |
| `pnpm db:generate` | 用 `drizzle-kit` 从 `src/db/schema.ts` 生成新的 migration（`-- --name <change>`）。 |

`drizzle/0000_baseline.sql` 是不可回写的基线；首个业务表必须由新的 migration 创建。
