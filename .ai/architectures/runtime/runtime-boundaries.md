# 运行配置与进程边界

运行入口由 `scripts/runtime/entry.mjs`、`settings.mjs`、`services.mjs`、`applications.mjs` 和 `native.mjs` 分担。日常启动和首次准备检查单集中在 `README.md`；文档身份与公开阅读见 `.ai/architectures/docs-integration/integration-boundaries.md`。

_最后更新：2026-10-11_

## 配置来源与消费者

普通 runtime 仅从仓库根 `.env.local` 和受支持进程变量读取配置，进程变量优先。三库组件字段分别生成 URL，校验库名 `exre`、`outline`、`hydra`，对账号密码编码并保留显式 TLS 等选项。前端只接收公开编译与开发代理设置；数据库和身份秘密不进入 Web 环境。普通密码与密码学密钥按各自消费者格式校验。

旧 URL、旧文档密码键或手工版本仍在来源中时，普通入口拒绝并要求显式转换。转换核对三个原数据库、owner、issuer 和 pending 目标，原子替换根文件前保存原始备份；不迁移数据或轮换秘密。普通配置不依赖 config receipt。部署的 identity routing pin 仍有独立用途：防止已有文档绑定与待投递撤销被投向不同 issuer 或密钥。

PM2 wrapper 收到根适配器生成的服务专属环境快照；管理入口校验该进程配置摘要，不会回落到 daemon 的其他服务环境。`PM2_HOME` 用于选择调用方指定的 daemon。摘要是内部运行一致性检查，不是用户维护的设置文件。更改配置后显式停止、启动应用。

## 资源与准备

本地依赖仅有 PG18、Redis、Hydra，由根 `compose.yaml` 定义，固定项目与回环端口；来源不明的同名卷或容器拒绝接管。服务停止以保存的 exact ID 和完整配置摘要为依据，检查整个 inventory 后才停止，停止后继续核验；不删除持久卷。应用监督与依赖操作使用独立锁，显式依赖停止还须取得应用锁。Windows 子进程使用私有 JobObject，Linux 使用私有进程组。

Windows 外层运行器可能在异步清理完成前结束监督进程。应用锁恢复在私有 gate 内核验原 run/lock 的完整身份与空依赖归属，确认原 owner、记录的 helper 及未登记直接子进程均已退出后才归档并接管；不按 PID 杀进程。正常 preflight 的已退出 owner 同样检查未登记子进程，归档或完成记录写入失败保留可重试状态。显式依赖停止取得应用锁后，还须核验全部应用端口静默。Linux 不套用 Windows JobObject 的退出证明。

Docker inspect 的 Mounts 数组顺序及未设置 DNS 列表的表示可能在启停后变化。`services.mjs` 的 proof 保留全部挂载字段并按 Destination 排序；仅将 `HostConfig.Dns`、`DnsOptions`、`DnsSearch` 的 null 归一为 []。非空 DNS 值、其他配置或挂载字段变化仍拒绝，不能通过刷新 proof 或删除归属记录接管资源。

启动在 Compose 操作前核验已有归属记录的完整 proof；操作后保存记录前再次比较原容器的 ID 与完整配置。已核验容器沿用原 proof，只有本次创建的服务容器建立新 proof。已有容器但归属记录缺失时拒绝启动，空 inventory 仍允许首次创建。启动后核验失败时保留原记录，不用失败现场刷新证明或调用依赖停止；仅在本次记录成功保存后，才能按记录回收本次启动的资源。

PG 管理角色由 `POSTGRES_USER` 配置，缺省为新安装的 `postgres`；它与三个业务连接的 owner 分开。显式准备禁止将管理角色作为文档 owner。外部 PG 卷由 `POSTGRES_VOLUME_EXTERNAL` 指定，普通运行只接受精确配置卷名且已有完整核验的本项目 PG 容器引用，并拒绝其他运行中的卷消费者；维护记录不参与日常配置读取。受管新卷依据 Compose 项目与逻辑卷标签核验。

普通应用运行先只读核对数据库结构、Outline marker、账号关联及 Hydra client。部署运行在启动应用前核对原身份绑定；Hydra 就绪并通过 client 核验后才启动 Website、Outline。PM2 online 之外仍要求真实健康通过。失败回收本轮创建的进程，保留先前存在的进程与后台服务。

创建文档库、迁移、登记 client 与 bootstrap 分属显式维护。Website 库与迁移独立；bootstrap 必须使用用户选择的已有 active Website UUID，重复准备不会恢复已撤销管理员权限。数据表职责以 `.ai/databases/data-model.md` 为准。

## 构建、测试与证据

`pnpm dev` 在只读 preflight 和应用启动前生成 Contract JSON 与 Client 类型；单独的 Server 开发入口使用同一生成流程。`pnpm test` 的每轮测试（含 watch 重跑）及 `pnpm build` 也先生成，内容未变化时不重写。watch 观察 `api/` 源变更，排除 `api/generated/` 和 Client 生成目录，避免产物触发下一轮。生产 `start` 与 Nginx 渲染只读取已有 `api/generated/openapi.json`，不在运行时生成 Contract 或修改数据库。生成与消费路径详见 `.ai/architectures/api/contract-layout.md`。

Build 只读取工具和固定公开编译设置，执行 SDK、Website Web/Server、Outline clean/vite/i18n/server，不要求运行秘密、数据库或服务。生产 Website 维护 CLI 使用编译入口。根自动测试由明确的文件和原样用例清单驱动，使用临时 PG18 和独立 schema/库；不连接开发库。完整范围见 `.ai/architectures/contract-tests/test-layers.md`。

日志在写入前脱敏，原生应用 JSONL 按大小和数量轮转。Nginx 使用由根设置渲染的同源模板，覆盖 HTTPS、WebSocket、内部拒绝与 Hydra public 白名单；系统安装和重载仍由操作者显式执行。Nginx 用实际连接地址覆盖客户端传入的转发 IP；Website 监听入口只信任回环代理，保留客户端 IP 限流隔离。`createApp()` 默认不信任转发头，直接非回环请求不能用该头改变限流键。

运行输出由 `scripts/runtime/output.mjs` 统一呈现服务状态、地址、错误检查项和下一步。颜色仅用于交互终端，非空 `NO_COLOR`、`TERM=dumb` 或 `FORCE_COLOR=0` 禁用颜色；状态同时保留符号与中文文字。终端持续日志默认使用本地短时间，`--verbose` 使用完整 ISO 时间；开发日志在同一次脱敏后分流保存为含 ISO 时间的纯文本，ANSI 配色不进入日志文件。开发就绪摘要在真实 readiness 通过并保存 ready 状态后输出；`service:status` 只呈现 Docker 容器与其健康检查状态，不把缺少容器健康检查等同于应用健康通过。

Docker 调用将命令缺失、调用超时和已知引擎连接失败分别报告为 `DOCKER_NOT_FOUND`、`DOCKER_COMMAND_TIMEOUT`、`DOCKER_UNAVAILABLE`；其他失败保留 `DOCKER_COMMAND_FAILED`。引擎连接失败提示检查 `docker info`、Docker Desktop/daemon 和 `docker context show`，不回显原始 stderr。`service:status` 仅在成功查询并核验空项目清单后报告服务未创建，并提示检查 Docker 状态及显式启动；Docker 不可用时以失败退出，不能当作空清单。

启动诊断直接给出服务、失败检查项、相关配置键与明确处理步骤，不把阅读文档作为恢复步骤。Website 检查 CLI 区分连接配置、认证、缺库、DNS/网络和结构未就绪；Outline 检查 CLI 只将已知身份/结构错误码和数据库错误码转为固定文案；Hydra 区分缺失 client、配置冲突与网络故障。未知异常不回显原始消息，HTTP 错误 envelope 保持原 Contract。只读检查失败不能自动迁移、创建账号或覆盖身份。

Nginx 的 `/api/` 请求体限额按 Contract 中申请的整份 multipart wire 预算与存储文件上限加 multipart 开销的较大值渲染，默认 64 MiB。`STORAGE_MAX_BYTES` 超过默认预算时同步提高代理限额；非法值或求和超出安全整数时拒绝渲染。代理放行不替代 Server 的单文件、累计字节、wire 和认证校验。`tests/contract/storage.test.ts` 经隔离 HTTPS Nginx、真实 Fastify 与临时 PostgreSQL 验证默认上限文件上传下载及两层超限拒绝；TLS 凭据仅来自公开测试夹具。

统一配置适配器在 local 和 deployment 中均要求 Website、Outline、Hydra 的应用监听地址为 `127.0.0.1`；部署的公网访问由 Nginx 终止并转发。

旧运行入口、额外根 Compose、服务器 Docker 打包和 ExUI 本地链路已退役；身份兼容与 cleanup-only 投递规则继续由业务实现维护。数据库恢复、issuer 切换与资源归属迁移必须独立验收，持久历史库、卷及维护备份保留，不能按新项目名称自动接管原卷。源码、隔离测试和模板校验不等于已有环境切换成功，也不证明 Linux 服务器或公网部署已验收。
