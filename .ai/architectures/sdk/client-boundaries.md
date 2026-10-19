# SDK 请求、配置与会话边界

`packages/sdk/` 是 Browser 与 Node 的本站业务 HTTP 入口；`instance({...})` 与 `storage` 共用配置和请求管线。唯一类型来源为 OpenAPI Contract，不另建 endpoint 或 DTO。生成流程见 `.ai/architectures/api/contract-layout.md`，使用示例见 `packages/sdk/README.md`。

## 公开面与依赖

`@workspace/sdk` 公开构建后的 Browser/Node 条件入口、对象请求函数、上传对象、配置 setter 和错误类型。`@workspace/sdk/types` 仅公开 Contract 生成声明（包括 `paths`、`operations`、`components`），无运行时入口。`dist/` 必须在消费前构建，根准备流程与单 checkout 串行要求见 `.ai/architectures/runtime/runtime-boundaries.md`。

Axios、ExUI 和 COS 依赖保持外置。Browser 静态依赖 ExUI，使用者负责应用样式与消息宿主；Node 入口不加载 ExUI。环境对应的 COS 传输在 prepare 选中 COS 后才懒加载，普通 HTTP 与 file 上传不加载云传输代码。组件包继续源码导出，其形态不代表 SDK 入口形态。

单例只覆盖被加载的环境入口模块；不同进程、worker、包副本不共享状态。Node 多用户并发请求不得切换同一个单例的用户凭据，需由调用方隔离执行环境。

## API root 与凭据归属

- Browser 默认 root 为当前 origin `/api`，仅在此规范化 root 自动逐请求读取 `localStorage` 的 `exwebsite.auth.token`。读取异常视为不可用，不冒充已知空值，也不抛存储异常。
- Node 无默认 root，要求先 `setBaseUrl` 设置绝对 HTTP(S) 地址，再 `setAccessToken`。Browser 也允许相对 root；根地址禁止用户名、密码、query、hash 和不安全路径。
- 规范化后的 root 变化递增配置版本并清除显式 token；非默认 root 只接受此后显式设置的内存凭据，不读取默认存储。回到默认 root 后重新启用自动读取。
- 默认 root 的 `setAccessToken` 是内存覆盖，不写持久存储。已知存储基线变化后覆盖失效；存储不可读时保留覆盖，首次恢复可读仅建立基线。显式 null 同样覆盖旧 token。
- 有效 token 变化递增凭据版本。请求捕获配置与凭据快照；上传在阶段之间继续核对，防止后续阶段进入新 root 或新用户会话。上传失败与云阶段边界见 `.ai/knowledge/storage/lifecycle-traps.md`。

Web 应用另由适配层按规范化 root 持久化凭据，并为自定义 root 显式调用 `setAccessToken` 恢复；这不改变 SDK 的自动来源规则。存储键、升级后的首次登录、同步与清理归属统一见 `.ai/architectures/web/authentication-flow.md`。

## 请求与错误

对象参数的 `url`、`method`、`pathParams`、`params`、`data` 及成功响应从生成 Contract 推导；省略 method 只表示 GET。支持 headers、timeout、signal、responseType 与 alert，不公开底层 Axios 配置。普通请求超时缺省 30 秒，上传本站阶段为 120 秒。成功直接返回数据，204 返回 `undefined`。

请求拒绝越出 API root origin/path 范围的路径，不跟随重定向，不发送 cookie。未显式指定 Authorization 时附加当前 token；调用方显式 header 优先。第三方业务请求使用独立工具，不能复用本站 token。原始 handler/HTTP 协议断言、测试夹具和需要原始状态/header/Host 的 readiness 探针可用独立协议工具，不能成为页面业务绕过 SDK 的入口。

普通错误统一为 `ExAxiosError`，区分配置、网络、超时、取消与 HTTP。只在 JSON Content-Type 且错误体不超过 64 KiB（65,536 bytes）时解析严格的 `{ error: { code, message, requestId } }` envelope；非匹配内容使用固定文案。可保留状态、requestId 和解析后的 Retry-After 秒数，不暴露原始错误体。Browser 的 alert 缺省开启，取消不自动通知；`alert: false` 不关闭会话失效处理。

## 会话失效

仅当前配置与凭据版本的 401 `SESSION_INVALID` 可触发清理；显式 Authorization 还须匹配当前 token。默认自动存储来源只有成功条件删除匹配值并确认空值后才继续处理，不把不可读存储当作成功清除。每个失效版本只通知和处理一次，迟到旧请求不能清理新会话。

`setSessionExpiredHandler` 安装应用处理器，接收错误与 API origin 的 `/login` 地址；处理器替代默认导航，异常不改变原请求错误。未安装时 Browser 使用替换导航，Node 无默认通知或导航。Web 在首个请求前安装处理器，应用会话同步和路由例外见 `.ai/architectures/web/authentication-flow.md`。

## 取代的入口

旧 `packages/api-client/`、openapi-fetch factory 与源码导出方式已退役；SDK 不公开旧 factory、方法族、实例 setter 或环境深入口。生成类型入库、禁止手改与 Contract 同步提交的原则继续适用。旧决策及当时理由保留于 `.ai/decisions/api-client/01-generated-types-committed-and-read-only.md`，不作为当前接入指南。

核对源码：`packages/sdk/package.json`、`packages/sdk/src/config.ts`、`packages/sdk/src/browser.ts`、`packages/sdk/src/node.ts`、`packages/sdk/src/request-types.ts`、`packages/sdk/src/http/core.ts`、`packages/sdk/src/storage/core.ts`。
