# ExWebsite

本仓库以单份 HTTP Contract 驱动 Web、本站 SDK 和唯一 Fastify Server。Server 使用独立的 PostgreSQL `exre` 数据库；目前仍处开发阶段。

_最后更新：2026-10-19_

## Language

**Contract（API Contract）**:
前端与 Server 共同遵守的唯一 HTTP API 事实来源。任何一方都不得在 Contract 之外新增路径、字段或错误格式；实现只能从 Contract 派生行为或类型。
_Avoid_: 接口文档、Swagger 文件、示例 API

**operation**:
Contract 中一个具体的「HTTP 方法 + 路径」行为单元。它是 Contract 与实现之间的最小交付单位。
_Avoid_: 接口、路由、endpoint 定义

**operationId**:
把一个 operation 绑定到其实现者（handler）的稳定标识。Service handler 是否被注册，以及覆盖检查是否通过，都以它为准；文件位置不参与解析。
_Avoid_: handler 名、路由名、函数名

**Server**:
本仓库唯一的 Fastify 服务，按 Contract 注册路由并实现行为。当前单实例开发拓扑不意味着已具备公网生产部署条件。
_Avoid_: Mock Server、临时后端、PHP 接管服务

**开发数据库**:
独立的 PostgreSQL `exre` 数据库，由环境变量明确指定；不与 Hydra 共用数据库。自动测试使用独立容器和隔离 schema。
_Avoid_: Mock SQLite、生产数据库、共享测试库

**健康检查**:
Server 自身可用性的最小信号。它表示进程已完成监听前置检查，不表示所有业务流程已经验收。
_Avoid_: 存活探针、业务就绪检查、状态接口

**envelope（错误 envelope）**:
所有失败响应的统一外壳。Contract 只约束它的外壳形状；具体的错误码取值属于实现侧的约定。
_Avoid_: 错误对象、错误详情、error 结构

**migration**:
对 PostgreSQL 应用结构的可执行变更单元。它只能由显式命令应用，服务启动不会生成或应用它。
_Avoid_: 建表脚本、schema 变更、SQL 文件

**baseline migration**:
从空 `exre` 数据库建立当前有效业务结构的首条 PostgreSQL migration；不回放旧 SQLite 历史。
_Avoid_: SQLite 基线、历史数据导入

**受控重置**:
开发专用命令：显式确认 `exre` 后，核验回环地址、连接身份和对象归属，清理本应用结构并重新应用基线；不删除头像目录，也不触及其他数据库。
_Avoid_: 清库、重置环境、删除数据库

**本站 SDK**:
Browser 与 Node 发起本站业务 HTTP 请求及上传的统一入口，由 Contract 生成的类型支撑；公开对象请求 `instance({...})` 与 `storage`，不定义第二份 endpoint。配置和会话边界见 `.ai/architectures/sdk/client-boundaries.md`。
_Avoid_: 旧 api-client、SDK wrapper、独立 endpoint 表

**API base URL**:
前端请求前缀。开发环境缺省 `/api`，Vite 将请求代理到唯一 Server。
_Avoid_: 接口域名、服务地址、代理地址

**破坏性 Contract 变更**:
会使既有调用方失效的 Contract 修改（例如删除或重命名 operation、收紧必填字段、改变响应类型）。当前没有版本策略或兼容层，因此这类变更必须单独评审。
_Avoid_: 不兼容改动、大改动、breaking

**Draft-07 兼容子集**:
Contract 中 schema 允许使用的 JSON Schema 关键字范围。它由运行时校验器的语义决定，而不是由 OpenAPI 版本号决定。
_Avoid_: JSON Schema 子集、受限 schema、简化 schema

**加入申请**:
申请人提交加入资料后、等待人工审核的记录。申请与正式账号独立，审核通过也不意味着已创建账号或邮件已送达。
_Avoid_: 临时账号、注册会话

**邀请资格**:
获批申请在邀请期限内可以验证邮箱并完善账号的资格。只读资格检查帮助选择下一步，不证明邮箱归属，也不能授权建号。
_Avoid_: 登录资格、账号权限、邮箱认证结果

**完善凭证**:
邀请验证码验证成功后签发的短期授权，只允许创建绑定申请的账号及有限成功重试。它不属于本站会话，不授予本人资料或 SSO 访问权。
_Avoid_: 登录 token、注册会话、SSO token

**投递尝试**:
一次邀请验证码邮件的交付记录。投递结果与已提交的审核事实独立；失败后可以重发，不能据投递失败推断申请仍待审核。
_Avoid_: 审核结果、邀请资格

**用户名（显示名称）**:
注册界面中的用户名沿用 `nickname` Contract 字段，允许重复，不作为登录标识；账号仍通过邮箱登录。旧文案称为昵称。
_Avoid_: 唯一用户名、用户名登录

**本人资料 snapshot**:
已验证本站会话读取到的当前账号资料，包含仅本人可见的登录邮箱；它不作为公开用户资料响应。
_Avoid_: 公开资料、会话缓存

**社区身份组**:
本站账号可被明确授予的社区成员分组，以稳定 `code` 标识。它不代表游戏角色或 FiveM 权限；当前尚无站内权限判断入口。
_Avoid_: 游戏权限组、角色权限

**普通身份**:
正式账号没有显式社区身份组成员关系时的默认身份；未登录者不因此成为普通用户。
_Avoid_: `general` 成员关系、匿名用户身份

**管理员组（`admin`）**:
只通过受信任的管理流程显式授予的社区身份组；注册不会自动加入。当前没有管理员初始化或权限判断入口。
_Avoid_: 注册默认权限、游戏管理员权限

**本站会话**:
普通登录成功后由 Server 签发、浏览器通过 Bearer 使用的 7 天固定期限会话。原始 token 只交付给浏览器，数据库只保存摘要；它与 SSO 完成结果是两类状态。
_Avoid_: 登录信息、用户缓存、SSO token

**SSO 请求**:
由本地显式 CLI 创建、等待浏览器确认某个账号的短期请求。接收页只能检查或完成它；完成不会签发本站会话，当前也没有生产发起方或轮询协议。
_Avoid_: SSO 会话、回调 token、外部登录凭据

## 独立身份系统

**统一身份**:
Website 是账号和本站会话的事实来源；Hydra 承担 OIDC 协议，客户端按显式批准的配置接入。
_Avoid_: 把本地 CLI SSO 当成 OIDC、共享数据库、默认应用

**身份客户端**:
由可信配置精确登记的应用，拥有独立 clientId、回调、scope 和秘密。显示名仅用于界面，不参与授权。
_Avoid_: 公开自动注册、任意回调、登录即拥有应用权限

**cleanup-only 目标**:
仅供已有 outbox 事件投递的原目的地，不具有新 OIDC 授权或内部会话调用权限。
_Avoid_: 备用登录客户端、当前秘密回退

**会话绑定**:
clientId、Hydra sid 与稳定本站 sessionId 的关联；普通退出只影响当前会话及其绑定，停用账号使既有会话失效，恢复不复活旧会话。
_Avoid_: 按用户批量清理全部设备、以邮箱关联身份

**应用撤销通知**:
在完成 Hydra 撤销之外，可选向已配置的应用 endpoint 投递原 eventId/sessionId。未配置或未完成通知不证明外部应用实时退出。
_Avoid_: 无条件跨应用同步退出、成功请求即外部验收

身份结构见 `.ai/architectures/identity/integration-boundaries.md`；数据规则见 `.ai/databases/data-model.md`。
