# 配置、维护与原生运行

## 配置来源与边界

正常入口位于 `scripts/runtime/entry.mjs`；`scripts/runtime/settings.mjs` 从仓库根读取 `.env.local`，支持的进程变量优先，按服务白名单注入。日常命令见 `README.md`。不再要求手工配置版本或 config hash receipt。真实数据库身份、schema、Outline integration marker、Hydra client/discovery 与进程/容器归属仍需核验。

数据库连接使用 `DATABASE_*`、`OUTLINE_DATABASE_*`、`HYDRA_DATABASE_*` 的 host、port、name、user、password 字段；库名分别为 `exre`、`outline`、`hydra`。同一 PG 实例可容纳独立 owner 的三库；服务器也可使用三个不同地址。应用 URL 由适配器编码生成；不同时维护 URL 与组件字段。

`*_SSLMODE`、`*_SSLROOTCERT`、`*_CONNECT_TIMEOUT`、`*_OPTIONS` 显式保存连接语义。无法无损转换的 URL 选项会被拒绝，不丢弃后继续运行。密码与 OIDC client secret 为原始明文，可读字符串和随机 hex 都是原值；配置读取不会轮换它们。签名/加密密钥保留格式和值；`SERVER_NOTIFICATION_TOKEN_KEY` 是可选 32 字节 hex，缺省由 Server 派生。

前端固定同源 `/api` 和 `/docs`。秘密只进入后端白名单，不进入 Vite。更换后端地址、数据库或域名无需重建前端；改变编译功能或公开挂载路径仍须重新 Build。

## 显式转换旧配置

在原终端停止应用写入，完成原模式未完成的操作并备份持久数据，然后执行 `pnpm infra convert`。它只读核验三个原数据库、owner、Outline issuer、Hydra client 与 pending 目标后备份根环境文件、拆分连接 URL、保留原端口和 issuer，再原子替换文件。字段冲突仅输出键名；验证失败不替换文件。

转换不接管已有容器或卷、不更新数据库密码、不迁移数据、不切换 issuer。旧端口会被显式保留；要收敛到 `5432/6379/4444/4445`，先完成下面的数据与身份维护，不直接更改 `.env.local` 后假设服务已同步。普通密码维护也须先选定新值，再显式同步角色或 client 并验证一致性；当前没有自动密码维护入口。

备份位于忽略的 `.local/runtime/config-backups/`，不进入 Git。旧模式入口已退役；已有旧环境须依据原配置与资源清单完成显式维护，不能将历史 journal 当成当前运行授权。

## 本地依赖和首次准备

本地单一用途的 Compose 位于根 `compose.yaml`，固定项目 `exwebsite-runtime`，只含 PG18、Redis、Hydra v2.3.0。镜像见 `infra/runtime/images.lock.json`。默认端口 `5432/6379/4444/4445`，只绑定 `127.0.0.1`；冲突失败，不自动递增。端口可明确配置，临时 Testcontainers 端口不受此固定规则影响。

旧根 Compose、适配器及应用服务器 Docker 打包已退役。数据库备份、历史库和持久卷独立保留；现有旧容器或卷不能按名称自动认作当前项目资源。

全新本地环境先填写各连接字段、密码和密钥。`pnpm infra init` 显式启动 PG/Redis，创建缺失的 Outline/Hydra owner 和库、迁移并核验结构；已存在 owner/password 不会被覆盖，角色冲突拒绝。Website `exre` 和 owner 必须由操作者显式创建，之后 `pnpm db:migrate`。不要对已有环境使用 reset 或替换卷来完成初始化。

迁移后 `pnpm service:start` 启动三个依赖；`pnpm infra bootstrap --admin-user-id <UUID>` 要求一个已有 active Website 账号，临时 Website 进程核验账号后准备精确 client 与 Outline 身份，结束时清理临时进程。用户注册/选择及管理员降权规则保持原语义。

服务归属记录位于 `.local/runtime/dependencies.json`，保存 exact ID 和完整配置摘要，用于启动前核验与停止授权；不是普通设置的 config receipt。未知容器、同名卷或配置变化拒绝接管。失败只回收本次启动的服务；停止不删除卷、数据库或附件。应用监督使用自己的锁和 Windows JobObject/Unix 进程组，Ctrl+C 只清理本次应用。

Windows 外层运行器可能在监督清理持久化结束前退出。下次应用启动或依赖停止会在应用锁 gate 内核验原 owner、全部已记录 helper 及未登记直接子进程都已退出，且原记录没有依赖资源，再归档原记录并恢复；证明不完整则拒绝，不删除锁绕过校验。依赖停止还须确认五个应用端口均已释放；Linux 不使用这项 Windows 自动恢复。

本地 PG 管理角色使用 `POSTGRES_USER`，新安装默认 `postgres`；已有卷须填写经真实 TCP 连接核验的现行管理角色和 `POSTGRES_PASSWORD`。镜像初始化环境不会改写已有卷里的角色密码，`pg_isready` 也不能证明密码正确。文档 owner 不得使用该管理角色或 Website owner。

原 PG18 卷的受控接管使用精确 `POSTGRES_VOLUME_NAME` 与 `POSTGRES_VOLUME_EXTERNAL=true`。外部卷的 Compose 定义只有名称和 external 属性，不添加卷标签。普通启动要求已存在经完整核验的本项目 PG 容器引用该卷，并拒绝其他正在运行的容器同时挂载；首次容器创建必须在显式维护中完成。停止原 PG 容器前保存完整资源清单和备份、核验管理凭据；后续不得同时启动仍保留的旧容器。新安装使用 `POSTGRES_VOLUME_EXTERNAL=false`，由 Compose 创建带项目和逻辑卷标签的受管卷。

## 自动验证和 Build

`pnpm test` 依次运行 Website Vitest、runtime/Docs Node 用例、静态清单中的 Outline app/shared 和 server 用例。清单位于 `scripts/runtime/test-manifest.mjs`；Outline server runner 为每个 literal case 创建临时 PG18/Redis，执行完整迁移并核对恰好一个通过的匹配用例，未处理错误、无匹配和重复匹配均失败。各组不继承开发库或身份秘密。旧模式专属测试随旧入口退役，仍有意义的归属、健康及附件回归保留在当前分组。

`pnpm test:watch` 串行重跑分组，变化排队不并发。指定 Outline server 用例仍可显式运行 `node scripts/docs-integration/test-outline.mjs <server/plugins-file> <literal-case>`。日志位于忽略的 `output/`。真实生命周期、浏览器、PG16→18 恢复和服务器 HTTPS 验收分别执行，不把未执行项目计为通过。

`pnpm build` 顺序构建 SDK、Website Web/Server，再执行 Outline clean、vite:build、copy:i18n、build:server。仅打包现有翻译，不重提取翻译源。Build 不连接数据库、Docker 或 PM2，不读准备状态，不执行测试；失败显示阶段、文件和必要上下文。产物沿用 `packages/sdk/dist`、`apps/web/dist`、`apps/server/dist`、`apps/outline/build`。

服务器交付同时保留根 `package.json`、pnpm lock/workspace、`apps/server/package.json` 与 drizzle、`api/openapi.yaml`、`apps/outline/package.json` 和 Yarn lock/public/plugins/shared i18n、`scripts/runtime/`、其复用的 Docs 模块/进程 helper、`infra/runtime/`。在目标操作系统按两个 lockfile 安装运行依赖，不能复制 Windows `node_modules` 到 Linux。Website 生产 CLI 使用 `dist/` 编译入口，不依赖 `tsx`。

## Linux 原生运行

设置 `RUNTIME_PROFILE=deployment`，填入 HTTPS `PUBLIC_ORIGIN`、`HYDRA_PUBLIC_URL`、私有内部地址、三库连接、Redis、绝对附件目录和原始秘密。监听 host/port、原生 Hydra 路径、日志限制、Nginx 证书见 `.env.example`。原生服务由操作者安装与准备；`infra init/migrate` 使用原生 Hydra 和已有库，不强制调用 Docker。

初次 identity routing pin 仍位于 `.local/runtime-deployment/identity.json`：这是防止旧 outbox 被投递到新 issuer 的身份绑定，不是可删的普通配置缓存。显式准备检查旧 binding/flow/outbox 和 Outline marker；issuer/client/delivery 密钥改变必须按身份迁移处理。普通 start 不创建 client、不授予管理员、不迁移。

`pnpm start` 只管理 `infra/runtime/ecosystem.config.cjs` 的三个单实例 PM2 wrapper；wrapper 接收统一适配器的服务专属环境快照，运行编译 Website、Outline 的 web/worker/cron/collaboration/WebSocket 服务，以及原生 Hydra。启动任何应用前核验原身份绑定；Hydra client 核验通过后才启动 Website/Outline。PM2 online 后仍必须通过真实 HTTP、schema、marker、discovery/client 检查。失败只回收本次创建的进程，已有进程保留；`pnpm stop` 不使用 `pm2 delete all`，不停止数据库。

`PM2_HOME` 保留调用方选择的 daemon；三个 wrapper 各自只接收其消费者设置，不传播其他服务密码。原生 Hydra 启动和迁移前核对 v2.3.0。Outline 单 worker、HTTP loopback，由 Nginx 终止 TLS；`SERVER_HOST`、`OUTLINE_HOST` 和 `HYDRA_LISTEN_HOST` 在 local/deployment 中均只允许 `127.0.0.1`。内部探测与实际监听端口必须一致。

更改运行设置后显式 `pnpm stop`、`pnpm start`。应用日志写为脱敏 JSONL，默认每个文件 10 MiB、保留 5 个轮转文件；大小与保留数有界可配。`pnpm logs` 跟随本项目日志，退出不停止应用。

`pnpm infra nginx` 生成 `.local/runtime/nginx/nginx.conf`。模板保留 Website static/SPA、API、Outline `/docs`、WebSocket、HTTPS forwarding、internal 路径拒绝和 Hydra public 白名单。操作者先配置正确证书和静态目录，显式 `nginx -t -c <generated-file>`，通过后安装/重载；start 不修改系统 Nginx。当前阶段不执行服务器部署。

## 数据、issuer 与归属切换

停止写入，保存根配置、完整三库备份、原 owner/卷、附件清单和恢复步骤。保留现有 PG18 的 `exre` 和卷；PG16 最新 Outline/Hydra 恢复到 PG18 候选库，PG18 同名历史库先保留为明确 legacy 名称。比较 migration 集合、owner、约束、完整数据摘要、账号/subject、文档及附件引用，未通过不能切换。

先由原目标完成 pending 撤销投递，再停止新 OIDC flow、撤销旧文档登录绑定，让未完成 flow 重发；受控同步 Outline marker 与 external identity issuer。保留账号、用户、subject、文档、权限及管理员选择；新 issuer 下重新登录，不能用重复 bootstrap 恢复已撤销权限。

验收新登录、退出、撤销、附件及协作后，才调整唯一 Compose/资源归属、提升根 Compose 并退役旧链路。现有 PG18 卷必须经明确的维护归属迁移后复用；新入口不按名字接管。旧 PG16 卷、备份和历史库保留。失败恢复原配置和原目标；若切换后发生新写入，先停写并恢复增量，不能直接挂旧备份宣称无损回退。维护清单放忽略的 `.local/`，不进入持久知识叙事。

`IDENTITY_OUTBOX_TARGETS_JSON` 保存其他历史 client 的 cleanup-only 目标，结构为 `{ "ex-outline": { "hydraAdminUrl": "http://127.0.0.1:14445/", "outlineInternalUrl": "http://127.0.0.1:13102/", "deliveryKey": "原目标的原密钥" } }`；实际键只允许既有 `ex-outline`、`ex-outline-local`、`ex-oidc-probe`，probe 只需 Hydra 地址。当前 client 目标由正常配置提供，不能被此 JSON 覆盖。地址和密钥必须来自完整原配置，旧目标离线时事件保持 pending，不用新 issuer/新密钥补齐；该字段及嵌套秘密均须脱敏。

## 故障诊断

错误区分 Docker 不可用、端口冲突、DNS、连接拒绝/超时、密码错误、缺库、缺迁移和身份冲突，并输出服务、阶段、配置键及下一步。远程连接拒绝不能被解释成本项目容器没启动。默认/verbose 均隐藏短密码、编码密码、Bearer、连接串和 SQL；HTTP 对外固定 envelope 保持原 Contract。

`EXPLICIT_CONFIG_CONVERSION_REQUIRED`：先核对原来源再显式 convert。`VOLUME_ADOPTION_REQUIRES_MAINTENANCE`：按维护清单核验原卷，不删卷重建。`PM2_OWNERSHIP_CONFLICT`：检查命名相同的外部进程，不对全局 PM2 执行停止。锁/归属不确定时保留现场，不能通过删除记录绕过核验。
