# 日常运行、配置迁移与部署材料

## 日常命令

根目录 `pnpm service:start` 只启动已初始化的 PostgreSQL、Redis、Hydra；就绪后命令退出，依赖继续运行。`pnpm dev` 只读检查依赖、schema、client 和工作区，监督 Website Server/Web 与 Outline。开发终端 Ctrl+C 只清理本次应用进程。随后 `pnpm service:stop` 停止依赖；应用仍运行时它拒绝，不删除卷、容器文件或附件。

`pnpm build` 构建 SDK、Website Web/Server 和定制 Outline client/server/static。构建不需要数据库、Docker、准备 receipt 或后端秘密。Outline 从已有 locale catalog 打包，不运行翻译提取，避免覆写译者改动。前端 API 默认为同源 `/api`；更改跨域 `VITE_API_BASE_URL` 需要重新构建。

普通运行配置只来自根 `.env.local`，受支持的进程变量优先。旧配置仅由显式导入读取，不用于普通 runtime fallback。Web 和各后端分别使用白名单环境，不能把秘密改为 `VITE_*`。本地 origin 默认 `http://127.0.0.1:8080`，浏览器使用 `/docs/` 挂载入口。

## 已有环境导入

先在原开发终端停止应用，完成旧 preparing/cleanup-failed 恢复。保持原 Website `exre`、HMAC、存储、头像、文档秘密及卷不变。不要把新示例默认值覆盖到既有环境。

```bash
pnpm infra configure --import-existing
pnpm service:start
pnpm dev
```

导入校验历史 exact IDs/proofs、卷和准备阶段，保持 v1 资源指纹与管理员 UUID。root 同名键不同值时拒绝，仅报告键名。旧文件保留；`config.v1.json` 保存转换前配置，`upgrade.json` 记录转换来源和输出 hashes。任何未完成转换拒绝正常运行，使用同一个显式导入命令恢复，不能删除 journal 绕过检查。

## 全新 local 环境

安装根 pnpm 与独立 `apps/outline/` Yarn 依赖，并准备独立 Website `exre`。ExUI 使用 registry 发布包，无需源码 checkout、链接或额外构建；启动检查已安装包声明的公开产物。复制 `.env.example` 到根 `.env.local`，填写已有数据库与 `AUTH_CODE_HMAC_KEY`。普通 configure 仅为新安装填补不存在的文档 secret 键；显式空值非法，已有值不轮换。

```bash
pnpm infra configure
pnpm db:migrate
pnpm infra init
# 注册 Website 账号并由操作者选择一个已有 active 用户 UUID
pnpm infra bootstrap --admin-user-id <Website-UUID>
pnpm service:start
pnpm dev
```

文档 PostgreSQL 专用于 `outline`、`hydra`，不创建 Website `exre`。根保留 `db:migrate`、`db:reset`、API lint/generation、typecheck、test。账号维护工具保留为 `pnpm --filter @workspace/server sso:create`、`sso:inspect`、`auth:disable`、`auth:enable`，参数不变。`db:reset -- --confirm exre` 仍是显式开发操作。

Outline 隔离测试入口为 `pnpm infra test <server/plugins test file> <literal case name>`，按原 runner 使用 disposable PostgreSQL/Redis。它不能替代 Website Vitest。runtime 脚本测试使用 `node --test scripts/runtime/*.test.mjs`；真实 lifecycle fixture 须显式设置 `RUN_COMMAND_RUNTIME_REAL=1`，Docker inventory 测试需串行执行。

## 秘密、地址和准备记录

11 个文档 secret 键为 `POSTGRES_PASSWORD`、`OUTLINE_PASSWORD`、`HYDRA_PASSWORD`、`OUTLINE_SECRET_KEY`、`OUTLINE_UTILS_SECRET`、`HYDRA_SYSTEM_SECRET`、`OUTLINE_INTEGRATION_KEY`、`IDENTITY_BOOTSTRAP_KEY`、`IDENTITY_DELIVERY_KEY`、`IDENTITY_FLOW_KEY`、`OUTLINE_OIDC_CLIENT_SECRET`，均为 64 hex。Website HMAC 与 COS/存储键沿用 Server parser，不能丢失原值。

配置 receipt 分开记录 configurationFingerprint 与 resourceFingerprint；前者绑定有效 root 设置，后者绑定原资源授权。显式 configure 可以核验非资源设置变更，不自动改密码、卷标签、issuer 或原 proof。`dependencies.json` 记录真实依赖阶段，`run.json` 记录应用进程；失败只回收本次新启动且可证明归属的容器，事先运行的依赖保留。失败的依赖 start 须显式 `pnpm service:stop` 恢复。

旧 dev/full 不在根日常命令表。其恢复仍使用 `node scripts/docs-integration/command.mjs down --mode dev` 或 `--mode full`；旧 local v1 使用 `--mode local`。保留原 mode 和历史配置，不把新 root stop 当成旧 full down。

## Linux 镜像

Website 与 Outline 使用独立依赖树，构建分别按 pnpm 与 Yarn lockfile 安装 registry ExUI，无需额外源码 build context：

```bash
docker build --target server -t <website-server:version> .
docker build -f apps/outline/Dockerfile.integration -t <outline:version> .
```

后端镜像包含编译代码、运行依赖、Contract、migration 文件和 runtime 脚本；Linux build stage 安装原生依赖。Outline 镜像含定制 build/public/plugin metadata，启动使用 `--no-migrate`。Website 静态文件为 `apps/web/dist/`，独立 Nginx/CDN 托管。镜像不含真实 root 环境文件、本机数据库或附件。

## 独立服务器部署配置

`compose.production.yaml` 与 local/旧 full 隔离。root 设置 `RUNTIME_PROFILE=deployment`，填写显式 HTTPS `PUBLIC_ORIGIN`、`HYDRA_PUBLIC_URL`；显式私有 `HYDRA_ADMIN_URL`、`WEBSITE_INTERNAL_URL`、`OUTLINE_INTERNAL_URL`；独立 `DATABASE_URL`（exre）、`OUTLINE_DATABASE_URL`、`HYDRA_DATABASE_URL`、`OUTLINE_REDIS_URL`；绝对容器 `OUTLINE_STORAGE_DIRECTORY` 与所有秘密。填写精确版本的 `WEBSITE_SERVER_IMAGE`、`OUTLINE_IMAGE`。容器内用所选网络的 service DNS，宿主机运行不要把它们当回环地址。

默认应用为 server/outline/hydra，Website 没有额外 Vite/Web 应用容器。可选择 `managed-postgres`、`managed-redis` profiles，但不会自动创建三个应用数据库或迁移。公开反向代理示例为 `infra/runtime/nginx.conf.example`，须填写与配置一致的两个域名及 TLS 证书。它保留 `/api`，Outline `/docs` 仅剥一次，承接 SSR/static/附件/WS，拒绝规范化 internal 路径；Hydra admin 和数据库不公开。

部署初次准备由操作者显式建立/迁移选定数据库与注册 active 账号。维护容器只在显式命令中挂载完整 root 文件，应用服务仅接收各自的 environment 白名单。先创建 `.local/runtime-deployment/`，然后在依赖已运行、数据库已显式迁移时：

```bash
# 首次锁定 issuer/target：必须无未处理的旧 ex-outline bindings/flows/outbox
docker compose --env-file .env.local -f compose.production.yaml --profile maintenance run --rm --no-deps validate node scripts/runtime/deployment.mjs prepare
# 显式登记精确 Docs client（Hydra schema 已由显式 migrate sql 命令准备）
docker compose --env-file .env.local -f compose.production.yaml --profile maintenance run --rm --no-deps validate node scripts/runtime/deployment.mjs client
```

`prepare` 不创建账号、不授予管理员、不写业务数据库。绑定 receipt 同时核验原 Website target、issuer、origin、client secret 与 delivery key；Website 在 outbox 启动前强制检查该 receipt。旧 full 使用同一个 `ex-outline` ID，有未撤销会话、有效 flow 或未投递事件时首次绑定拒绝。issuer/secret 改动须另行身份迁移，不通过覆盖旧 target 解决。

绑定后可启动 Website，使用操作者明确 UUID 运行 Outline 镜像既有 `build/server/scripts/integration-bootstrap.js --admin-user-id <UUID>`，准备工作区；它不在容器普通启动内执行。部署前运行维护容器的 `validate` 操作，真实检查两个数据库、Outline marker、Hydra client/discovery。缺失配置、migration、marker/client 拒绝，不能将 `docker compose config` 当作这些检查。

数据库、头像、上传文件、Outline 附件使用独立稳定卷。停止不带 `--volumes`。镜像回退不回退 schema；运行地址从后端公开 presenter 注入，前端 build 参数仍需重建。本材料不包含实际服务器发布或公网生产验收。
