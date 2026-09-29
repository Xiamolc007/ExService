# 历史决策：本地 Mock 数据库使用固定 SQLite 路径

- 状态：已被 `.ai/databases/decisions/07-independent-postgresql-exre-database.md` 取代
- 原模块：`mock-server`
- 日期：2026-09-16
- 取代日期：2026-09-29

## 当时的背景与决定

本地 Mock Server 最初需要保存状态，同时避免开发命令误连原规划中的外部数据库。`db:reset` 当时是删除文件的命令，因此选择固定的 `apps/mock-server/data/mock.sqlite`，不接受覆盖路径，使用 `better-sqlite3` 和 Drizzle SQLite migration。这个选择还避免了任意路径删除风险。

## 被取代的原因

本仓库现以 `apps/server/` 作为唯一 Server，并采用独立 PostgreSQL `exre`，不再规划 PHP/MySQL 外接实现。旧 SQLite 文件、迁移历史和数据没有导入新库。当前连接与重置安全边界见 `.ai/databases/decisions/07-independent-postgresql-exre-database.md`；显式迁移原则见 `.ai/databases/decisions/03-database-changes-only-by-explicit-command.md`。

本文件保留原决策的原因，不作为当前开发或运行指令。
