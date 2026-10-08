# 文档集成的服务边界

Website 管理账号与本站会话，Hydra 提供 OIDC 协议，Outline 管理文档、权限和附件。Website HTTP operation 以 `api/openapi.yaml` 为准；本站数据规则集中在 `.ai/databases/data-model.md`。本页集中记录当前实现的配置、准备、运行和恢复边界；浏览器与多设备撤销时延需另行验收。

_最后更新：2026-10-06_

## 本地入口与资源

根 `pnpm dev` 调用 `scripts/docs-integration/local-dev.mjs`，提供同源 Website、公共文档和统一身份。`scripts/dev-app.mjs` 是使用同一已验证 local 配置的单应用适配器，不生成配置或准备资源。Outline 运行 `dev:watch:integration`，普通启动不迁移。

| 服务 | local 默认地址 |
| --- | --- |
| Website 公共入口 | `http://127.0.0.1:8080/`，文档挂载 `/docs` |
| Website Vite / Server | `http://127.0.0.1:8081/` / `http://127.0.0.1:8082/` |
| Outline 后端 / Vite | `http://127.0.0.1:3102/` / `http://127.0.0.1:3101/` |
| Hydra public issuer / admin | `http://127.0.0.1:14444/` / `http://127.0.0.1:14447/` |
| 文档 PostgreSQL / Redis | `127.0.0.1:17432` / `127.0.0.1:17379` |

九个端口均显式、互不重复并绑定回环；默认无需 hosts。浏览器使用公共入口，`localhost`、直接 Vite 或旧 8090 origin 的 Website 会话不共享。身份地址不从请求 Host 派生。local Outline 后端/Vite 明确使用 HTTP，禁用该模式自动读取开发证书。

`compose.local-dev.yaml` 使用独立项目 `exwebsite-local-dev` 和锁定镜像，专用 PostgreSQL 仅准备 `outline`、`hydra`，不创建 Website `exre`。文档附件在 `.local/docs-integration/local-dev/data/outline/`，与旧模式隔离。Website 继续使用原 `DATABASE_URL`、`AUTH_CODE_HMAC_KEY`、业务存储和头像目录，进程环境优先于 `apps/server/.env.local`；编排只派生监听、公开地址和身份参数，不复制原 Website 凭据或替换已有账号库。

`apps/outline/` 是独立 Git submodule/Yarn 应用，不参加 pnpm workspace。Outline 的 React 17/portal ExUI 与 Website 的 React 19/ExUI 依赖分别安装和构建。需要根 Node 22.12+ 并满足 Outline engines、pnpm 11.9.0、Corepack/Yarn、两套已安装依赖、现有 ExUI checkout/链接/产物及 Docker Compose。`INTEGRATION_NODE_BIN`、`INTEGRATION_COREPACK_JS` 可显式指定工具；local 默认当前 Node，旧 dev 工具策略要求 Node v26.3.0，不能混用两种策略。

## 显式准备与只读运行

首次顺序为：`pnpm integration:configure -- --mode local` → `pnpm db:migrate` → `pnpm integration:init -- --mode local` → `pnpm integration:bootstrap -- --mode local --admin-user-id <Website-UUID>` → `pnpm dev`。bootstrap 必须由用户指定一个已存在且启用的 Website 账号；缺 UUID 拒绝，不自动挑选或创建账号。全新 Website 须先显式创建独立 `exre`、配置、迁移并注册账号，不能为文档准备替换已有业务库。

`scripts/docs-integration/command.mjs` 解析命令。local 支持 configure/init/migrate/bootstrap/down；运行入口是 `pnpm dev`，不是 `integration:dev -- --mode local` 或 `integration:up -- --mode local`。

| 动作 | 已实现边界 |
| --- | --- |
| configure | 验证工具、ExUI、原 Website 数据库身份，不要求已迁移；保存 local 配置与密钥，不写业务库。重复配置保留稳定密钥；半份或畸形配置拒绝。 |
| init | 显式准备独立基础服务，迁移 Outline/Hydra 并编译 Outline server；重复核对库/角色 owner、结构和原凭据，不重设密码或重建数据库。成功写 initialized 阶段，不代表 bootstrap-ready。 |
| migrate | 仅显式迁移已核验的 local Outline/Hydra；Website 仍单独 `pnpm db:migrate`。 |
| bootstrap | 取得独占准备锁，核对 active 账号、库和 client，以临时 Website Server 调用既有 keyed inspect，登记固定 Hydra client，再调用 Outline bootstrap 与只读检查。临时端口须空闲，成功失败均清理本次 child，不接管未知服务。 |
| dev | 核对配置、全部准备阶段、卷、真实库/结构、工作区标记和 Hydra client/discovery/secret，启动已准备基础服务及应用；不迁移、reset、创建 client/account/admin。 |
| down | 发送已验证 runId/指纹绑定的停止请求或按归属 journal 停止资源；不删除卷、数据库、附件或头像。 |

`.local/docs-integration/local-dev/config.json` 保存版本、派生 origin/issuer/callback、端口、附件目录与无凭据 Website 目标身份；`secrets.env` 保存稳定文档/身份秘密。configure 的端口参数为 `--public-port`、`--web-port`、`--api-port`、`--outline-port`、`--outline-vite-port`、`--postgres-port`、`--redis-port`、`--hydra-public-port`、`--hydra-admin-port`。旧环境变量与保存配置矛盾、目标变化或已有 issuer 冲突时拒绝，不用 8090 补值或原地改工作区 issuer。

`.local/docs-integration/local-dev/prepared.json` 记录指纹、实际卷身份、阶段和显式管理员，不替代真实检查。缺失/同名重建卷、迁移或结构缺失、错误 issuer/admin/provider/身份关联、未知容器、端口或模式冲突均拒绝启动。Hydra 正常启动只读 verify，不创建缺失 client。

首次 init 中途失败时，准备 journal 保存实际阶段、资源历史 proofs 与已知卷集合的 partial receipt；它不表示 initialized 或 bootstrap-ready，也不能代替 `prepared.json`。同 mode/指纹且完整真实归属核验通过后，可显式重试原 `integration:init -- --mode local` 或执行原 mode down；不隐式 reset、bootstrap 或重建卷。普通 dev/bootstrap 仍要求全部准备阶段完成。dead empty local preflight 没有 inventory 时不得普通跨 mode 回收；只有同 local/指纹并经外部完整目标 inventory、owner 身份与已知 history 核验才可恢复。live owner/children 先拒绝，未知资源也拒绝，不能仅因 PID 已退出或记录未含资源就回收。

Website CLI 为 `pnpm --filter @workspace/server integration:check`，可加 `--admin-user-id <Website-UUID>`；它核对原配置、真实 `exre` 与完整结构，在 READ ONLY 事务中检查可选 active 账号，不授予社区角色或清理过期记录。Outline 在 `apps/outline/` 内的 `yarn integration:check --admin-user-id <Website-UUID>` 使用编译 CLI 检查迁移、真实 `outline`、标记、启用 provider 及身份关联。初始管理员 subject 必须一致，但后续明确降权不由 readiness 或重复 bootstrap 恢复，也不要求恢复原角色才能就绪。两者不修复数据，错误输出固定安全代码。已标记的集成库禁止关闭集成恢复原生宽松认证；独立未标记 Outline 仍支持自己的直接启动配置。

## 原 8090 dev/full 兼容

无 local 参数的 `integration:configure/init/migrate/dev/up/bootstrap/down` 保留旧模式语义。Website 为 `http://exwebsite.test:8090`，issuer 为 `http://identity.exwebsite.test:8090/`，两主机须映射 `127.0.0.1`。`compose.yaml` 联同 `compose.dev.yaml` 或 `compose.full.yaml` 及受控 override：dev 运行宿主机应用，full 运行应用容器。旧模式使用自己的专用数据库/存储配置，不能当成 local 原 Website 数据源。

旧 dev 原 Outline 后端直接端口默认 `13100`、Vite 默认 `13101`，有实际证书时保持 HTTPS。额外 loopback HTTP 后端传输默认 `13102`，configure 保存，可通过 `INTEGRATION_OUTLINE_HTTP_PORT` 显式选择并检查冲突；对应 `OUTLINE_DEV_HTTP_PORT` 注入用于 gateway 后端、Website outbox 和后端 readiness。静态代理保留真实 TLS；只有原开发 static readiness 目标限定处理自签证书，其余请求正常验证 TLS。full 沿用镜像 HTTP；gateway-only HTTPS 不能证明内部撤销可用。

受控 `.local/docs-integration/runtime-dev.json` / `.local/docs-integration/runtime-full.json` 保持相同 PG/Redis 拓扑，均发布原回环 `16432`、`16379`，full 也需要这两端口空闲。原 Compose 保留，基础容器和持久卷在完整核验后跨模式保留。模式转换先核对整个旧应用集合、精确 ID、Image/Config/HostConfig/全部 Mounts proof 及卷 CreatedAt/labels，仅非强制移除已记录且停止的旧模式应用，不用 `-v`。live/未知/缺 proof/篡改资源在任何移除前拒绝。

旧 `init → dev/up` 缺 Outline 标记时进入 `awaiting-bootstrap`：仅 Website Server/Web 和 gateway 提供原注册/登录，`/docs/`、`/docs/static/` 返回 503，保留 `/api` 和 internal HTTP/WS 拒绝。此时不是完整 READY，不回退邮箱认证。显式 bootstrap 指定 UUID：dev supervisor 核对 runId/指纹后暂停其全部应用和 gateway，持有归属进入 preparing；临时 inspect 服务退出后才恢复完整应用并等待就绪。失败保持整组停止可重试，恢复失败中已重启的 gateway 也暂停。

full bootstrap 在首次 stop 前验证全部 managed application ID/proof，仅暂停这些应用，保留独立预运行基础服务。临时 Website container 保持 server network alias，独立 `preparation` profile 的受限 verifier 内部调用 Hydra，metadata 仍用真实 public issuer。一次性容器按 run/project/service/oneoff/image 精确清理。准备/readiness 失败停止整组 owned 应用，未知身份拒绝零 stop。

legacy 暂停在每项 stop 后及完整 managed application 子集结束时复核原 proof 和实际 `Running=false`，或经完整 inventory 证明缺失；暂停不完整不进入 prepare，失败恢复的暂停也不得写成已完成。full 临时 Website oneoff 的预先可信 Image ID 来自本 run 唯一已停止的 managed Server，以其原完整 proof 核验后固定，不依赖 build-only 服务未声明的 image 名。创建前持久临时 name、可信 Image ID、来源 ID 与清理意图；create 返回 CID 即记录，再首次 inspect 并持久原 temporary proof，不能从当前同名容器倒造授权。清理前验证原卷、完整 regular 资源组和唯一临时归属；确认实际停止后非强制无删卷移除并证明缺失，或完整 inventory 已证明其缺失，才清除引用。pending 临时 name/CID 未清除时保持 `cleanupRequired`，不写假 preparation-failed。已存在的 temporary 缺原 proof 时，fresh 原 mode down 拒绝且不执行 stop，保留引用/锁并要求人工诊断；只有原记录完整可验证或完整 inventory 已证明临时 ID/name 缺失，才继续恢复，不以 stop 响应或当前采样替代原授权。

## 归属与失败恢复

local/dev/full 共用 `.local/docs-integration/mode-lock.json` 原子占用与短 `.gate`，准备/运行互斥。Windows 身份含创建时间、可执行文件和命令摘要，PID 本身不是终止依据。只有证明正常旧 owner 已消失/替换且无未完成资源，才可自动回收，不杀旧 PID；live/ambiguous 拒绝。dead local owner 的 started/createdStopped 未证停止，或记录有 `cleanupRequired` / `cleanup-failed` 时，普通 configure/准备/新启动与跨模式启动拒绝，须显式原 mode down；确证 partial init 的限定重试见准备段。full 持久占用绑定项目/配置/容器，不能因 `up` CLI 退出判定陈旧。

遗留短 gate 报 `MODE_GATE_STALE`，不自动 unlink：Windows 缺少所需 compare-and-swap，检查后删除可能误删新竞争者 gate。人工恢复须停止竞争命令，核对 gate 完整创建时间/executable/command-digest 身份已死亡/替换，只删除对应 `.gate`（默认 `.local/docs-integration/mode-lock.json.gate`；操作锁有对应 gate）。live/ambiguous 不得删除；不得删 mode occupancy、prepared、目录或卷绕过核验。

Windows child 使用私有 JobObject，先挂起创建、分配后恢复，helper 关闭即停止其子孙。supervisor 必需 child 失败只清理 siblings 和当前 run 从停止状态启动的容器；真正独立预运行服务保持。显式 local down 优先有效 owner/recovery 或最新 runtime 记录，并合并仍可证明的 init/bootstrap 准备归属历史；准备自己启动的 PG/Redis 不因后续 runtime 将它们记作 preRunning 而漏停。相同 exact ID 的历史 proof 必须一致，历史 started 归属优先于后来的 preRunning 采样，不能把独立服务变成受管资源。

活 supervisor 的显式 local down 在发送控制前捕获原 mode/runId/指纹、完整 owner 身份与 children，并固定 `.local/docs-integration/local-dev/foundation.json` 和 `.local/docs-integration/local-dev/retired-run.json` 的内容及存在性。实际控制请求只发送给该原 run；锁释放不等于进程退出，须等待原 supervisor 与其私有 children 身份全部退出。之后在同一模式 mutex 的 gate 内核对原 run 的 stopped 记录、原 owner 和固定历史，再通过完整 proof/原卷核验清理剩余历史 owned 资源。交接中 owner/run 或准备/retired 历史变化在写入 recovery intent 前拒绝，不接管新运行；已进入清理后的失败保留完整 journal/锁，供 fresh 同来源显式重试。普通 Ctrl+C 或必需 child 失败仍只清当前 run started，真正独立 preRunning 始终保留。

恢复时先核对原 mode/配置指纹、完整 owner/run 身份、全部历史 exact IDs 的 Image/Config/HostConfig/全部 Mounts proof 及原卷集合，再进行第一项 stop；完整组内的未知或篡改资源拒绝零 stop。`docker inspect` 非零不证明 missing，只有成功的全局完整 ID 与 literal Name inventory 确认缺失才可跳过；inventory 或 inspect 不确定时保留 journal 并拒绝。stop 前后继续核验原 proof，不以当前采样替换历史授权。

stop 成功响应不等于已停止：清理结束及显式 down 最终恢复核验后，还须确认全部 owned started/createdStopped 实际 `Running=false` 或经完整 inventory 证明缺失，才可写 stopped 并 release；已观察到仍运行、未知资源或 inspect/inventory 失败时保留 journal/锁，核验范围不要求真正独立 preRunning 停止。

legacy 尚未交给 supervisor/full runtime 的命令，在本 run 即将 start 或新增受管资源前持久清理意图与原 identity/run/mode/配置、secret 指纹、资源 proofs 和实际卷集合；后续变化继续记录本 run 的真实新增归属。此前旧 stopped 应用退役沿用旧模式转换段的原履历核验规则；本 run 的 `cleanupArmed` 生效后，清理失败保持同锁和原意图，不让清理异常掩盖原业务错误。首次 init/migrate 缺 `.local/docs-integration/initialized.json` 时，仅原命令的真实 partial 意图、阶段状态、secret 指纹、卷身份及原资源允许同 mode 显式清理；partial 写 stopped 不代表 initialized-ready。原有卷 name/CreatedAt/labels 不得被当前采样替换，新增卷仅限已记录 owned 容器经原 proof 核验的实际 Mounts 引用，完整卷 inventory 的未知资源拒绝；原意图未成功持久时拒绝自动恢复，不能补造授权。成功 initialized 标记及显式管理员权限保持既有语义。

显式 `pnpm integration:down -- --mode <原模式>` 使用原 `local`、`dev` 或 `full`，fresh CLI 可恢复 dead owner 的 cleanup-failed，包括首次 full up 失败留下的 nonpersistent 记录；legacy 还核对原 prepared 卷集合、secret 指纹和 gateway 配置摘要。成功核验并持久写入 stopped 后才 release；proof、stop、inventory 或 journal 写入失败保留真实失败 journal/锁，供同来源显式重试，不删除 mode occupancy 绕过。legacy 对 stopped 记录核验幂等，记录受管资源重新运行时拒绝。local 显式 down 则按已核验的历史 owned IDs 清理受管资源：同 proof 的历史 started 容器再次运行也会被停止，真正独立 preRunning 仍保留。

full `up` 部分失败清理成功后，先保存完整 stopped 容器/资源 proofs，保留仍有效的原 owned stopped 应用，再释放占用，支持安全重试；stopped down 可只读幂等核验。独立 `createdStopped` 集合只记录本轮新建、归属确认、StartedAt 为零且从未启动的应用，与实际启动后需 cleanup 的 IDs 分离；短暂启动后 exit 仍算已启动。端口冲突创建的 never-started 容器可能无 network，后续启动也未必恢复；仅完整集合/卷/exact proof 验证后，此类别才可非强制、无删卷地退役重建。空 network 不提供归属授权，未知/live/普通运行后停止应用不凭此退役；该特定类别 ID 可变化，持久数据保留。

## 派生产物与首次初始化

full override 选择忽略的 `.local/docs-integration/Dockerfile.website-runtime`，build stage 将 `/exui` 链接到复制的 `vendor/exui`，支持根 frozen `link:` 依赖；保留原 `Dockerfile`、消费 manifest、根 lockfile。生成器要求唯一原 anchor，冲突产物拒绝。镜像构建证据不替代完整产品 runtime 验收。

旧 `infra/docs-integration/postgres/init.sh` 与原 Compose 保留；`.local/docs-integration/runtime-init.sh` 只派生 CRLF→LF，经受控 PG override 挂载，SQL/角色/库语义不变。仅 PostgreSQL entrypoint 首次初始化执行，不对已有卷重跑非幂等 SQL，也不删真实卷修复不完整初始化。既有不完整目标拒绝并另行限定诊断修复。新 local `infra/docs-integration/postgres/init-local.sh` 由 `.gitattributes` 精确限定 LF，不扩到旧脚本。

## 浏览器主题与界面语言

集成 Outline 与 Website 在同一浏览器存储分区、同一 origin 使用原始字符串 `localStorage.theme`，合法值为 `light`、`dark`、`system`；缺失或非法值解析为 `system`。Outline 不迁移 `UI_STORE.theme`，保存侧栏等属性时保留旧主题供独立模式使用。根级订阅重读当前存储并处理页面恢复，收到事件不反向写入；Website 通过 ExUI 公开 API 补偿迟到事件与恢复。跨 origin、跨设备同步不在此协议内，存储不可访问时 Outline 只保证本页切换。

`apps/outline/shared/styles/websiteTheme.css` 是 Website 已有黑白品牌覆盖的唯一来源，主站在 ExUI 样式之后导入它。集成 Outline 在布局阶段解析这份 CSS 的受覆盖变量，先应用有效 token，再解析 legacy 字段、语义字段和 recipe；不使用工作区品牌、交互页面查询参数或手机纯黑主题。打印使用局部浅色并恢复，不持久化。`website-theme-profile` 标记限制覆盖作用域；独立 Outline 保留原偏好和品牌行为。Website 构建须包含该 submodule 样式资源，Outline 构建不依赖父仓库文件。

集成有效默认语言为 `zh_CN`，新账号创建显式写入该语言，已有账号资料同步不改语言。根级语言投影只采用 `auth.info` 已验证账号的语言；缓存账号不作为语言权威，匿名和退出回到默认中文。语言切换串行收敛并更新 HTML `lang`/`dir`；独立模式仍沿用浏览器检测与原配置。公共页面复用已有翻译键，项目特有提示通过局部 `defaultValue` 与 `fallbackLng: []` 提供中文/英文回退，避免英文 fallback 遮蔽中文；locale catalog 只能由提取流程生成，文档正文与用户内容不翻译。

## 身份、自动登录与撤销

Website/Outline 各自解析不可变模式配置。local 固定 `ex-outline-local`、经校验回环 HTTP issuer/origin、精确 `<publicOrigin>/docs/auth/oidc.callback`、退出 `<publicOrigin>/identity/signed-out`；dev/full 保留 `ex-outline`、8090 issuer/callback 和旧 Hydra-only `ex-oidc-probe`。不允许 wildcard/任意 client 注册。Outline `URL` 带 `/docs`，`WEBSITE_URL` 是 Logo/身份页面返回主站的根地址，不可互换。

根级 `WebsiteIdentityController` 通过同源 `WebsiteSessionProbe` `/identity/status` 交换粗粒度 active/anonymous/unavailable，校验 origin/source/nonce，最多一秒，不交换 Bearer/资料/token。active 发起已有 OIDC，匿名直接公共阅读；运行中身份服务不可用保持公共页与可重试状态。标签页 sessionStorage 仅存安全 returnPath、随机 attemptId、时间；同路径十分钟内抑制重复自动尝试，被动刷新不清失败记录。成功关联清除，另一安全路径或到期允许新尝试；失败 fragment 抑制自动跳转，显式操作可重试。公共与成员的呈现、临时 DTO 及请求代次边界见 `.ai/architectures/docs-integration/unified-reading-interface.md`。

OIDC 保留 state/nonce/PKCE、签名、issuer/audience、userinfo.sub、sid/`ex_session_id` 核验。begin 成功设置 client-qualified、HttpOnly、SameSite=Lax、Path=/docs/auth、十分钟随机 browser-proof cookie；Redis 仅存摘要，callback 消费 state/换 token 前验证发起浏览器，结果清除 cookie。他人浏览器不能消费原流程。可信故障返回校验后的原 docs path/query 与 `#website-signin-unavailable`；不可信 state/proof 返回 `/docs/`。returnPath 拒绝外域、反斜杠、控制字符、编码穿越与非 docs 路径。

Outline 仅在 Website internal session check 确认 subject/sid/本站 sessionId/有效期后建立 `ExternalSession`。邮箱相同不自动合并，资料版本同步防止迟到覆盖；本站 CLI SSO 是独立流程。`SessionGuard` 同步核对受保护 HTTP，实时连接按租约复核；事务撤销立即阻止新有效核验，outbox 再按旧 sid/sessionId 清理，迟到停用不撤销恢复后的新会话。五秒实时目标需真实多浏览器验收，快照/保留规则见 `.ai/databases/data-model.md`。

outbox 按固定 clientId 独立选择 Hydra admin、Outline internal URL 与原 delivery key，幂等键含 clientId，probe 仅清 Hydra。当前目标不可覆盖；其他目标仅从完整原配置或严格 `IDENTITY_OUTBOX_TARGETS_JSON` 装载。未知、缺失、不可达目标保持 pending，不用当前模式秘密补齐。cleanup-only 目标不扩大 OIDC 批准 client 或内部 session-check 权限。

仅 full 调用方清理旧 `ex-outline-local` 时，cleanup-only 两个目标根允许 literal `host.docker.internal`、HTTP、显式非默认端口，full server override 声明 `host-gateway`；保留原 local 端口、delivery key 与 issuer 来源。此例外不改当前 local auth origin，不授予 cleanup client 认证权限。DNS/adapter/映射验证不等于成功投递，旧目标离线仍 pending。

## 公开授权与代理

Outline 集合成员权限控制登录阅读/评论/编辑，Website 社区管理员不自动成为文档管理员。集合 Share 与当前发布状态共同决定匿名可见，旧单篇 Share 不提供旁路。`apps/outline/server/commands/publicAccess.ts` 统一目录/搜索/文档/附件可见性；SSR 提供公开标题/正文摘要/canonical/sitemap，私有、草稿、缺失统一 404。附件须属于可读已发布内容，不能只凭 URL 读私有字节。

local 公共入口与直接 Vite 在 HTTP/upgrade 转发前拒绝规范化 `/api/internal`、`/docs/internal` 根及后代，含编码、斜杠/反斜杠、点段和畸形 escape 绕过。Hydra admin 不经公共代理。`/docs` 308 至 `/docs/` 保留 query；Website `/api` 保留，Outline 后端仅剥一次 `/docs`，集成 Vite 静态保留 `/docs/static/`。standalone Outline 保留直接 URL、static strip/TLS，不能套用集成前缀规则。

可信 forwarding/mount headers 只来自已验证 public origin；浏览器 Origin 不改写，hostile/缺失 Origin 仍被上游 CSRF 拒绝。Location 仅对 allowlist 的 Outline 未挂载路径添加前缀，外部、Website identity、Hydra、已挂载地址保持。Cookie 保留 Path：`exdocs_access` 为 `/docs`，HTTP `csrfToken` 为 `/docs`，HTTPS 唯一 `__Host-csrfToken` 为 `/`，不全局 cookiePathRewrite。

带会话的非安全方法要求精确 origin 与签名双提交 CSRF，安全方法签发 token；四个匿名读 POST `public.collections.list`、`public.documents.list`、`public.documents.info`、`public.documents.search` 免 CSRF，其余合法读 POST 也携带 token。OIDC browser proof/state/nonce/PKCE 不由 CSRF cookie 替代。

local HMR 从 public origin 派生，legacy 保持 8090。生产 `httpReady` 显式 Host 分支使用 node:http/node:https 真正传递 Host，保留 gateway foreign Host 421、手动 redirect、真实 Response/expected 和正常 TLS；无 Host 分支使用 fetch。请求、body/expected、剩余总 deadline 与必需 child 退出均受限，不能以另一 smoke helper 或无限等待替代真实就绪。
