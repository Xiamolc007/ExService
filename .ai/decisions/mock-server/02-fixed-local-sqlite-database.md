# 本地 Mock 数据库使用固定路径，不接受覆盖

- 状态：已接受
- 模块：`mock-server`
- 日期：2026-09-16
- 来源：`notes/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`「持久化边界」

_最后更新：2026-09-17_

## 背景

本地 Mock Server 需要一个能保存状态的数据库，而不是固定 JSON。生产环境是 PHP + MySQL，本仓库的开发机上也完全可以访问到真实的数据库配置。

同时，`db:reset` 是一个删除文件的命令。

## 决策

- 数据库固定为 `apps/mock-server/data/mock.sqlite`，由 `src/db/client.ts` 的 `DATABASE_PATH` 常量决定。
- 不接受任何路径参数或环境变量覆盖。
- 使用 `better-sqlite3` + Drizzle ORM，只访问该文件；不连接、不共享 PHP/生产 MySQL 数据库。
- `data/` 提交 `.gitkeep`，忽略 `mock.sqlite` 与其 WAL/SHM（以及可能由外部工具产生的 `-journal`）文件。

## 理由

这个决定同时排除两类不可逆事故：

1. 本地 Mock 误连生产 MySQL 并写入数据；
2. 一个可以被参数指向任意路径的删除命令。

固定路径还让命令语义可预测：`db:migrate` 与 `db:reset` 作用的对象永远是同一个文件。

## 影响

- 无法通过环境变量把 Mock Server 指向另一份数据库；需要多份数据库时属于新的设计。
- 数据库文件与其伴随文件都不入库，因此每个 checkout 都必须显式初始化。

## 重新审视的条件

- 需要同时维护多份彼此隔离的本地 Mock 数据（应设计显式的隔离方案，而不是加路径参数）。
- Mock Server 需要作为共享的团队环境运行（当前定位是本地开发，不是共享服务）。

## 证据

- `apps/mock-server/src/db/client.ts` 的 `DATABASE_PATH`、`DATABASE_SIDECAR_PATHS` 及注释。
- `apps/mock-server/drizzle.config.ts` 的 `dbCredentials.url`。
- `.gitignore` 中 `apps/mock-server/data/` 相关条目及注释。
- `AGENTS.md` 的「数据库边界」。
