# Server 正式化与 PostgreSQL 迁移设计

- 日期：2026-09-29
- 状态：已获用户批准实施（开发阶段，不授权部署）
- 模块根目录：`.notes/server-promotion/`
- 后续 RFC 目录：`.notes/server-promotion/rfcs/`

## 1. 已确认的边界

`apps/mock-server` 升级为本仓库唯一的长期 Server；前端继续通过 `@workspace/api-client` 按 `api/openapi.yaml` 访问它。本仓库不再规划或描述另一个 PHP Server / MySQL 实现。Server 使用 PostgreSQL，现有 SQLite 数据可丢弃，按空库建立新的 PostgreSQL 基线。数据库是独立的 `exre`，不借用 `outline` 数据库或在其中新建 schema。首个运行拓扑为单实例 Server + PostgreSQL，沿用本机头像文件和进程内限流状态。

本次是**开发阶段改造**，不代表立即上线或生产就绪。保留现有 Contract Test、服务测试、开发期终端邮件、临时审核流程、验证码流程与占位人机验证、SSO CLI 等已有功能和模块；按新数据库和名称调整其实现与测试。公开部署所需的权限、邮件投递、人机验证、文件共享、备份恢复、监控和多实例能力留作后续独立设计。不得将这些后续能力设成本次验收前提，也不得把当前临时流程写成已具备生产安全性。

工作在独立 worktree 的 `feat/server-promotion` 分支进行，保留原工作区的未提交内容。已在本机 `127.0.0.1:5432` 创建独立数据库 `exre`，核实 `public` schema 中业务表为零；此事实仅说明当前开发环境状态，不由应用代码自动创建数据库。数据库凭据只由本机环境提供，示例配置使用占位符，不写入仓库。

## 2. 当前实现与变更动因

当前 `apps/mock-server` 用 Fastify + `fastify-openapi-glue` 注册 `api/openapi.yaml` 中的 operation，监听 `/api` 前缀；`packages/api-client` 是 Web 的调用边界。`better-sqlite3` 同步连接承载账号、会话、SSO、社区身份、申请、附件、邀请、邮件控制等数据。`apps/mock-server/drizzle/` 是 SQLite 增量迁移历史，启动只检查数据库而不运行 migration。头像保存在 `apps/mock-server/data/avatars/`，申请证明附件保存在数据库 BLOB 中。

`apps/mock-server/src/auth/`、`profile/`、`join/`、`invitations/` 与 `records.ts` 直接使用 `sqlite.prepare` 和同步事务；HTTP handler、Fastify hook、SSO CLI 和测试夹具依赖这些同步返回值。因此换驱动时必须贯穿调用链改为异步，不能靠替换连接对象完成。部分测试使用 SQLite 内存库、`rowid`、`BEGIN IMMEDIATE`、SQLite trigger 和旧迁移快照，必须改为 PostgreSQL 语义下的同等行为验证。

## 3. 选择的方案

将包目录和名称改为 `apps/server`、`@workspace/server`；保留内部通用 `@server` TypeScript alias，更新其实际指向。沿用 Fastify、Glue、Contract 和生成式 Client。数据库层使用 `pg` 连接池、Drizzle PostgreSQL schema 和一条从空库建立当前业务模型的新迁移基线。服务层经一组很窄的异步参数化查询与事务接口访问 PostgreSQL；迁移过程中可以保留清晰的业务 SQL，不构造兼容 SQLite 的 SQL 字符串改写器。

这个方案使服务职责、HTTP 行为和前端调用边界保持连续，集中处理连接与事务生命周期。曾考虑保留 `mock-server` 路径仅更改文案，但该名称会继续误导脚本、文档和导入关系；也考虑引入完整 ORM 重写全部业务查询，但对当前目标扩大了语义改动与测试风险。因此选择名称与数据库一并迁移，业务 SQL 按必要范围逐段转换。

## 4. 包、Contract 与配置

更新 workspace、根脚本、`tsconfig.base.json`、`vitest.config.ts`、`apps/web/vite.config.ts`、构建后 alias 重写脚本、依赖和锁文件中指向旧目录或包名的位置。开发命令仍启动 Web + Server；`db:migrate`、`db:reset`、`sso:create`、`sso:inspect` 等入口迁至新包。可保留 `@server` alias 名，避免无意义的全仓 import 改写。新头像目录为 `apps/server/data/avatars/`；头像与数据库内容不提交版本控制。因为明确从空库开始，旧 SQLite 头像引用及文件不自动导入；先清点旧头像目录，保留原文件供用户自行处理，不能因目录移动而静默删除。

`api/openapi.yaml` 仍是唯一 HTTP Contract，Glue 仍只注册有 `operationId` 的路径。现有 HTTP 方法、路径、请求与响应、错误包络及 `/api` 前缀不因换数据库而改变；只修订 Contract 中有关 Mock/PHP 后端的描述。按仓库顺序执行 `pnpm api:lint`、`pnpm api:generate`，检查生成文件是否仅发生预期的元数据变化。若实现中发现必须改变对外语义，单独提出 Contract 变更评审，不能顺手更改。

Server 从 `DATABASE_URL` 取得连接信息；本地示例写成 `postgres://<user>:<password>@127.0.0.1:5432/exre`，不复制现有 `outline` URL 或真实密码。启动、迁移和重置均核验 URL 的 database 名称为 `exre`，连接后再核验 `current_database()` 确为 `exre`，拒绝缺失、错误或无法连接的目标。启动检查所需表及 migration 状态，失败时提示显式运行 `pnpm db:migrate`；启动本身不建库、建表、迁移或重置。服务关闭时释放连接池。监听地址和端口保持当前本地开发行为，改变对外绑定需另行决定。

## 5. PostgreSQL 数据与事务

在 `apps/server/src/db/schema.ts` 和全新 PostgreSQL migration 中实现 `.ai/databases/data-model.md` 的**当前有效**业务模型，不重放 SQLite 历史，不导入 SQLite 数据。账号、会话、SSO、身份组、申请、表单、附件、邀请、邮件控制及投递表均从空库创建。迁移中建立必要种子数据和全部主键、外键、唯一/部分唯一、检查与索引，确保表之间的引用和邮箱登记规则仍由数据库兜底。保留文本 ID、规范化邮箱、文本 JSON 表单的现有应用语义；附件字节改用 `bytea`；毫秒时间戳用 `bigint`，在数据库边界安全地转换为 JavaScript number，超过安全整数范围即失败；附件长度以 `octet_length` 校验，摘要格式用 PostgreSQL 等价校验。不要依赖 SQLite 的 `rowid`、`GLOB`、`length(BLOB)` 或隐式类型转换。

数据库模块暴露参数化 `query` 和 `transaction(callback)`，事务回调接收**同一连接上的事务客户端**。所有事务内读取和写入只用该客户端，不回到连接池；`BEGIN`、`COMMIT`、`ROLLBACK` 和释放连接的责任集中在此模块。对连接错误、SQLSTATE 与约束名做有限映射，既有业务冲突继续返回既有错误码，未知数据库错误走统一安全 envelope，不把 SQL、连接串或驱动异常消息回显给客户端。邮件/头像文件等外部副作用维持在数据库事务之外，并保留当前“先写新文件、再更新引用”的失败处理方式。

并发约束按操作落实：申请的“每邮箱仅一次”由登记主键裁决；审核同一申请、签发/重发邀请、验证码消费与错误计数、完成注册时锁定对应行或采用带条件的原子更新，并检查实际更新行数。相同凭证的重复完成仍返回既有结果，竞争完成不能产生双账号；批准和投递的既有事实边界保持不变。多表锁遵循固定顺序，明确处理唯一冲突与必要的重试；不在事务内执行密码哈希、邮件发送或图片处理。读路径需保持一致快照语义，尤其是申请状态、邀请与账号的联合判断；实现 RFC 应逐条指定 PostgreSQL 隔离级别或单语句读取策略，并用双连接竞争测试验证，不能把 SQLite 的串行写入特性当成保证。

`pnpm db:migrate` 只对已存在的 `exre` 库显式应用迁移；迁移脚本保持 CLI 专用、防止 import 触发副作用。`pnpm db:reset` 只在开发用途下以显式目标确认执行，先双重核验 `exre`，拒绝发现非本应用拥有的未知对象，再清理本应用表及迁移记录并重新应用基线；不删除头像目录，不操作其他数据库。命令与测试证明错误目标会在任何写入前失败。迁移已经开始或 schema 不完整时，启动应明确失败，不进行“修复性”写入。

## 6. 测试与开发验证

保留行为测试与 Contract Test 的覆盖目标，夹具改为异步 PostgreSQL，并为每个用例分配可独立清理的数据库作用域。自动测试使用独立的临时 PostgreSQL 容器，容器内数据库同样命名为 `exre`；用逐用例独立 schema 和明确的 `search_path` 隔离数据，或使用等价的独立容器。连接配置不能回退到本机 `outline` 或本机 `exre`；测试退出时清理自己的资源。没有 Docker 时应明确报告测试未执行及原因，不得静默改用开发库。旧 SQLite 迁移历史专项测试改为“空 PostgreSQL 基线、增量重复执行、失败状态、安全目标拒绝、约束”测试；测试代码和模块本身保留。故障注入和并发测试改为 PostgreSQL 可复现手段，包括两个独立连接竞争及失败后的回滚检查。

分阶段完成以下可验证切片，每片结束记录通过、失败或未执行的证据；切片不是上线门槛：

1. 固定现有 Contract 和行为基线，调整包名、配置与文档；保持构建链可用。
2. 建立 PostgreSQL schema、显式迁移/重置安全边界及测试夹具。
3. 迁移账号、SSO、资料和头像相关查询，再迁移申请、邀请、附件和投递事务；逐段验证行为与并发约束。
4. 清理旧 SQLite 依赖、迁移历史和外部 PHP Server 计划说明；修订 `.ai/databases/data-model.md`、相关决策/架构文档、根 `AGENTS.md`、示例配置与开发说明，核对全仓剩余文字。
5. 运行 `pnpm api:lint`、`pnpm api:generate`、`pnpm typecheck`、`pnpm test`、`pnpm build`；从空 `exre` 执行显式迁移并启动 Server/Web 做本地冒烟验证，检查健康、注册/登录、申请/邀请与头像/附件关键路径。

文档清理涵盖当前说明及仓库内过时设计档案：删去或修订“未来 PHP/MySQL Server”“Mock 只供本地、正式另接”的项目计划性断言，保留对历史设计决定的必要事实记录，不改动用户表单字段中“previousServer”等业务含义，也不误删 SSO、邮件等真实外部集成。`.ai/` 是完成实现后按 `codebase-documenter` 规则沉淀**已验证事实**的位置；本设计获批时先形成 RFC，不提前把提案写成已实现架构。若本次设计完成后需要先提炼稳定结论到 `.ai/`，按仓库规则另请用户确认。

## 7. 验收与留待后续

完成标准是：代码与文档把该包作为唯一 Server；无运行时 SQLite 依赖或外接 PHP Server 目标；`exre` 空库可显式迁移并承载现有 HTTP 行为；开发期功能仍可使用；自动化测试不碰其他数据库；原有 Contract/服务行为和重点并发性质被验证；生成结果、类型检查、测试、构建与本地冒烟各有准确结果记录。任何失败或未执行项都应如实报告并修复本范围内缺陷，不把“环境未具备”写成通过。

本次不做公网发布或生产部署，不设计多实例共享头像/限流，也不承诺生产级权限、邮件、验证码、数据保留与灾备。未来若进入上线阶段，再以独立设计审查这些条件及是否需要改为共享存储。当前已创建的 `exre` 空库仅用于开发验证。
