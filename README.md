# ExWebsite

Website 使用独立 PostgreSQL `exre`；Outline 是独立文档服务，使用自己的数据库和附件存储。Docker 运行 PostgreSQL、Redis、Hydra，Website 与 Outline 在宿主机开发监听。当前为本地开发阶段，不部署上线。

## 日常启动检查单

已有环境按以下顺序执行：

- [ ] Docker Desktop/daemon 已启动：`docker info` 能连接引擎。
- [ ] 根 `.env.local` 已填写现有配置，`RUNTIME_PROFILE=local`。保留原账号、密码、密钥、库和存储路径。
- [ ] 执行 `pnpm service:start`，直到显示“后台依赖已就绪”。
- [ ] 执行 `pnpm service:status`，确认 PostgreSQL、Redis、Hydra 都在运行。
- [ ] 执行 `pnpm dev`。启动检查通过后显示网站与文档入口，默认网站为 `http://127.0.0.1:8080/`，文档为 `http://127.0.0.1:8080/docs/`。

启动失败会直接输出检查项、错误点、相关配置键和下一步。修正该项后重试；不要重复执行初始化或重置来绕过错误。Ctrl+C 结束应用，后台依赖继续运行；`pnpm service:stop` 停止本项目依赖并保留持久数据。

终端提示自动使用颜色；设置 `NO_COLOR=1` 可关闭。重定向输出和保存的日志保持纯文本；`pnpm dev --verbose` 显示完整日志时间。

## 首次准备检查单

仅全新环境执行；已有环境跳过已经完成的项。

- [ ] 安装 Node 22.12+（同时满足 `apps/outline/package.json` 的 engines）、pnpm 11.9.0、Corepack/Yarn 和 Docker Compose。
- [ ] 安装根依赖：`pnpm install --frozen-lockfile`。安装 Outline 依赖：`corepack yarn --cwd apps/outline install --immutable`。两者分别使用自己的 lockfile。
- [ ] 按根 `.env.example` 填写 `.env.local`：三库的 host、port、name、user、password 及原始秘密。库名分别为 `exre`、`outline`、`hydra`，各自使用独立 owner；应用只读取根配置，进程变量优先。
- [ ] 执行 `pnpm infra init`，准备 Outline/Hydra 数据库及 migration。该命令不会创建 Website `exre`。
- [ ] 显式创建独立 Website `exre` 及其 owner，然后执行 `pnpm db:migrate`。
- [ ] 执行 `pnpm service:start`。准备已有 active Website 账号；新环境尚无账号时，可先用 `pnpm --filter @workspace/server dev` 启动已迁移 Website，并通过 Website 注册流程建号。
- [ ] 由用户选择已有 active Website 账号 UUID，执行 `pnpm infra bootstrap --admin-user-id <UUID>`，准备文档身份。
- [ ] 执行 `pnpm dev`。

普通启动只检查就绪状态，不创建库、迁移、重置、登记 client 或授予管理员。已有环境切换旧 URL 配置时，先核对原连接目标和凭据，再显式执行 `pnpm infra convert`；它备份配置并保留原值，不迁移数据。更换持久卷、PostgreSQL 版本、issuer 或已有凭据需要独立维护，不属于启动检查单。

## 常用命令

| 目的 | 命令 |
| --- | --- |
| 启动/停止后台依赖 | `pnpm service:start` / `pnpm service:stop` |
| 查看状态/日志 | `pnpm service:status` / `pnpm service:logs [postgres\|redis\|hydra]` |
| 开发监听 | `pnpm dev` |
| Website 显式迁移 | `pnpm db:migrate` |
| Outline/Hydra 显式迁移 | `pnpm infra migrate` |
| 自动测试/监听测试 | `pnpm test` / `pnpm test:watch` |
| 构建 | `pnpm build` |
| Contract 与类型检查 | `pnpm api:lint` / `pnpm api:generate` / `pnpm api:check` / `pnpm typecheck` |

测试使用临时数据库，不连接开发库；Build 不连接数据库或启动 Docker。自动测试、本机生命周期、浏览器和部署验收分别报告。

## 工程入口

`api/openapi.yaml` 与 `api/paths/`、`api/schemas/` 是唯一 HTTP Contract 源，统一生成 `api/generated/openapi.json` 和 Client 类型；`apps/server/` 是唯一 Website Fastify Server；Web API 调用只经 `packages/api-client/`。`pnpm dev`、`pnpm test` 和 `pnpm build` 先生成 Contract，生产启动只读取已有 JSON。Outline 不属于 pnpm workspace，Website 不接管其 API。ExUI 使用 lockfile 锁定的 registry 包。

开发规则见 `AGENTS.md`，模块知识从 `.ai/README.md` 查阅，运行与资源边界见 `.ai/architectures/runtime/runtime-boundaries.md`。
