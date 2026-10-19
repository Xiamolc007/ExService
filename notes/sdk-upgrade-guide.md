# 统一 SDK 升级指南

本文适用于从旧 `@workspace/api-client` 和 SDK factory 接口升级到统一单例 SDK 的调用方。代码依据为 `chore/package-optimization` 分支的 `872d637`；升级不改变现有 HTTP Contract、数据库结构或存储后端。

这是破坏性源码接口迁移，没有旧 API 转发层。`@workspace/sdk` 当前仍是版本为 `0.1.0` 的私有 workspace 包；本文不表示已发布新版 npm 包，也不定义新的版本策略。

## 1. 先核对影响

| 旧入口或用法 | 升级后 |
| --- | --- |
| `@workspace/api-client` | 删除该依赖，运行时改用 `@workspace/sdk`。 |
| 从旧包导入 `paths`、`operations`、`components` | 使用 `import type` 从 `@workspace/sdk/types` 导入。 |
| `createApiClient({ baseUrl, transport })` | 直接导入模块单例 `instance`，不再注入 transport。 |
| `createExAxios(...)`、`ExAxios`、`createSdk(...)` | 删除 factory 初始化，使用根入口的请求、上传和配置导出。 |
| `client.GET/POST/PUT/PATCH/DELETE(path, options)` | 改为 `instance({ url, method, ...options })`。 |
| `params: { path: {...}, query: {...} }` | 分别改为顶层 `pathParams` 和 `params`。 |
| JSON 或 multipart 的 `body` | 改为 `data`；multipart 仍传 `FormData`。 |
| `http.setBaseUrl(...)`、`http.setToken(...)`、`http.setAlert(...)` | 使用根导出的 `setBaseUrl`、`setAccessToken`，每次请求设置 `alert`。 |
| factory 的 `getAccessToken`、`websiteBaseUrl`、`onSessionExpired` 等选项 | 按下文迁移凭据来源、API root 和 `setSessionExpiredHandler`。 |
| `/browser`、`/node`、`/http/browser`、`/http/node` 深入口 | 统一从包根导入；环境由 package exports 条件选择。 |
| `ApiClient`、`ExAxiosInstance`、`SdkOptions`、`StorageSdk` 等旧类型 | 按用途使用 `SdkInstance`、`RequestConfig`、`Storage`、`UploadOptions` 等当前公开类型，不是逐项同名别名。 |
| 直接消费源码，无需构建 | 消费 `dist/`；先生成 Contract，再构建 SDK。 |

检查所有独立调用方，包括脚本、测试、Server 的类型导入和外部工程。不要保留指向 `packages/api-client/` 的 TypeScript/Vite 别名，也不要通过 SDK 私有源文件绕过 `exports`。

## 2. 准备依赖与构建产物

在仓库根目录使用 Node.js 22.12+ 和 `package.json` 指定的 pnpm，执行：

```sh
pnpm install --frozen-lockfile
pnpm api:generate
pnpm --filter @workspace/sdk build
```

在调用方清单中删除 `@workspace/api-client`；运行时调用方声明 `@workspace/sdk` workspace 依赖。Server 仅消费生成类型时按当前工程放在 devDependencies，不为类型入口导入 SDK 运行时。

根 `pnpm dev`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 已自动串行准备 Contract 和 SDK。低层 `pnpm --filter @workspace/web dev` 不自动重建 SDK，启动前及 SDK 修改后需自行准备，优先使用根开发入口。生产 `start` 只消费已有产物。

同一 checkout 同时只运行一个会写入 Contract/SDK 产物的命令。依次运行生成、开发、检查、测试和构建；需要并行验证时使用独立 checkout。根开发监督器在 SDK/Contract 源码变化时停止应用、串行重建后重启；已启动后的重建失败会保持应用停止，等待下一次源码修改。

Browser 入口静态依赖 `@exre/exui`，调用方必须提供匹配的 peer、全局样式和消息宿主。当前包清单要求 `^0.8.0`；`alert: false` 不会移除该依赖。Node 入口不加载 ExUI/React；仅类型子入口也没有运行时代码。Axios 和环境对应的 COS SDK 为外置依赖，COS 代码在实际选择 COS 上传后才懒加载。

## 3. 替换请求调用

例如，旧调用为：

```ts
await api.GET('/notifications/{notificationId}', {
  params: { path: { notificationId: 'receipt-id' } },
  alert: false,
})
await api.GET('/notifications', {
  params: { query: { view: 'unread', limit: 20 } },
})
await api.PATCH('/auth/me', { body: { nickname: '新昵称' } })
```

升级为：

```ts
import { instance } from '@workspace/sdk'

const detail = await instance({
  url: '/notifications/{notificationId}',
  pathParams: { notificationId: 'receipt-id' },
  alert: false,
})
const page = await instance({
  url: '/notifications',
  params: { view: 'unread', limit: 20 },
})
const me = await instance({
  url: '/auth/me',
  method: 'PATCH',
  data: { nickname: '新昵称' },
})
```

省略 `method` 只表示 GET；其他方法必须显式给出，支持大小写。成功值直接是响应 body，不额外读取 `.data`；204 返回 `undefined`。方法、路径、参数、请求体和成功类型都由唯一 OpenAPI Contract 推导，不传自定义响应 DTO 泛型，不复制 DTO。

`url` 使用 Contract 路径模板，不拼接 API 前缀、完整 URL 或 query。路径参数通过 `pathParams` 编码；查询参数通过 `params` 编码。上传原始 multipart 时将 `FormData` 放入 `data`，不手写 multipart boundary。

请求保留 `headers`、`timeout`、`signal`、`responseType`、`alert`；不公开 Axios adapter、每请求 base URL 或 transform 等配置。普通超时默认 30 秒，Browser 错误提示默认开启。可按调用关闭提示，或按响应内容选择模式：

```ts
const binary = await instance({
  url: '/storage/files',
  params: { key: 'uploads/example.bin' },
  responseType: 'arraybuffer',
  alert: false,
})
```

`responseType` 支持 `json`、`text`、`blob`、`arraybuffer`，返回类型随之变化。请求不携带 cookie，也不跟随重定向。第三方请求使用独立客户端，不复用本站 token。

仅消费 Contract 类型时使用：

```ts
import type { components, operations, paths } from '@workspace/sdk/types'

type CurrentUser = components['schemas']['CurrentUser']
```

`@workspace/sdk/types` 没有运行时入口，不能使用动态 import 或值导入。

## 4. 迁移 API root 与凭据

### Browser SDK

默认 root 为当前 origin 的 `/api`；仅在这个规范化后的默认 root，SDK 自动逐请求读取 `localStorage` 的 `exwebsite.auth.token`。SDK 不负责写入持久 token、登录 UI 或刷新 token。

```ts
import { setBaseUrl, setAccessToken } from '@workspace/sdk'

// 先选 root，再明确设置属于该 root 的凭据。
setBaseUrl('https://api.example.com/api')
setAccessToken(token)
```

root 允许 Browser 相对地址或绝对 HTTP(S) 地址；Node 必须使用绝对地址。root 变化会清除显式 token，因此 setter 顺序不能颠倒。规范化后相同的 root 不触发切换；地址不能包含用户名、密码、query、hash 或不安全路径。

非默认 root 只使用切换之后显式设置的内存 token，不能自动借用默认 root 的持久 token。返回默认 root 后重新启用自动读取。默认 root 下 `setAccessToken(token)` 或 `setAccessToken(null)` 是内存覆盖，不写存储；已知持久值变化后覆盖失效，存储不可读后首次恢复可读只建立基线。完整状态规则见 `.ai/architectures/sdk/client-boundaries.md`。

### 本站 Web 应用

本站通过 `apps/web/src/api/client.ts` 的 `installSdkIntegration()` 在首个请求和 React render 前安装接线；它读取 `VITE_API_BASE_URL`、选择持久化范围并设置失效处理器。业务组件直接导入 SDK，不重复初始化该接线。

Web 适配层按 API root 隔离持久凭据：

| API root | localStorage 键 |
| --- | --- |
| 当前 origin 的默认 `/api` | `exwebsite.auth.token`，沿用原键。 |
| 其他规范化 root | `exwebsite.auth.token:` 加 `encodeURIComponent(normalizedRoot)`。 |

**原来使用自定义 root 且 token 只保存在旧默认键的用户，升级后必须在该自定义 root 重新登录一次。** 不自动复制或迁移旧键；其他 root 的凭据保留。重新登录后的自定义 root 凭据由 Web 适配层恢复，再显式安装给 SDK；这不改变 SDK 自身的自动读取规则。

root 切换后，旧 root 的登录、邀请、OIDC、设置、通知和反馈结果不能写入新范围。表单与缓存也有范围归属，不能仅因 token 字符串相同就沿用。会话同步、存储异常和退出抑制的详细边界见 `.ai/architectures/web/authentication-flow.md`。

### Node 调用方

```ts
import { instance, setBaseUrl, setAccessToken } from '@workspace/sdk'

setBaseUrl('http://127.0.0.1:8080/api')
setAccessToken(process.env.WEBSITE_ACCESS_TOKEN ?? null)
const health = await instance({ url: '/health' })
```

Node 没有默认 root，不读取 Browser 存储，也不显示通知或默认跳转。单例只属于当前加载的环境入口模块；不同进程、worker 和包副本不共享状态。

**不能在共享同一单例的并发用户请求之间反复切换 root/token。** 原来依靠多个 factory 隔离用户的调用方必须先安排独立执行环境。多客户端接口不在本分支范围内。

## 5. 迁移会话失效与错误处理

```ts
import { ExAxiosError, setSessionExpiredHandler } from '@workspace/sdk'

setSessionExpiredHandler(({ error, loginUrl }) => {
  // 同步应用身份与缓存，再按应用路由决定导航。
})

// 卸载接线时可恢复 SDK 默认行为。
setSessionExpiredHandler(null)
```

只有匹配当前配置和凭据版本的 401 `SESSION_INVALID` 才触发失效清理，同一失效版本只处理一次。显式 Authorization 还须匹配当前 token；迟到旧响应不能清除新会话。默认自动来源须确认匹配持久值已成功删除，存储不可读不能当作清理成功。

`alert: false` 只关闭通知，仍执行会话失效处理。自定义 handler 替代默认导航，支持同步或异步函数；没有 handler 时 Browser 导航到 API origin 的 `/login`，Node 没有默认导航。本站适配层另保留支持中心、身份路由及 SSO 登录流程的原路由处理权。

普通请求抛 `ExAxiosError`，可读取 `kind`、`code`、`status`、`requestId` 和 `retryAfterSeconds`。配置、网络、超时、取消和 HTTP 错误分别归类；取消不自动提示。仅在 JSON Content-Type 且错误体不超过 64 KiB 时接受严格本站错误 envelope，其他错误体使用固定文案。不要依赖原始 Axios response 或错误 body。

## 6. 替换上传 factory

删除 `createSdk({ baseUrl, getAccessToken, ... })` 的局部初始化，改用与 HTTP 请求共享配置的 `storage`：

```ts
import { storage } from '@workspace/sdk'

const url = await storage.upload(
  'uploads/example.bin',
  new Uint8Array([1, 2, 3]),
  { medium: 'file', contentType: 'application/octet-stream' },
)
```

数据支持 `Blob`、`File`、`Uint8Array`，Node `Buffer` 作为 `Uint8Array` 支持。`medium` 可选 `file` 或 `cos`，省略时由 Server 决定；返回值仍为 URL 字符串。当前上传选项只有 `medium` 和 `contentType`，不公开每次调用的 timeout 或 signal。

本站 prepare、multipart/complete 阶段使用同一请求管线，默认 120 秒并关闭自动提示；失效处理仍生效。阶段间核对 root/token 版本，变化时抛 `StorageSdkError`，其 `code` 为 `CONFIG_CHANGED`。其他上传错误也统一为 `StorageSdkError`；取消和超时映射为 `TIMEOUT`。

上传不做应用层自动重试或回滚。同 key 会覆盖；COS 已直传但 complete 失败时仍抛错，重试可能再次覆盖。默认单文件上限 20 MiB，最终以 Server 校验为准。对真实 COS 的权限、网络和 complete 行为仍需独立验收。

## 7. 验证与回退

按顺序执行本仓库的检查：

```sh
pnpm api:check
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test
```

Linux 缺少 Browser 依赖时使用 `pnpm exec playwright install --with-deps chromium`。数据库自动测试要求 Docker 的 Linux 容器，使用临时数据库，不允许回退开发库。检查结果和本次发现的问题以关联 Issue/PR 为准。

重点验证以下升级行为：

- 默认 root 的既有登录、主动退出，以及 401 后的身份与缓存同步。
- 自定义 root 首次重新登录、刷新恢复、跨标签替换/删除和不同 origin/path 隔离。
- root 切换后拒绝旧登录、邀请、OIDC、反馈上传及设置/通知的迟到结果。
- Node 条件入口和无 DOM 的类型入口；Browser 实际产物、ExUI 消息宿主及 COS 懒加载。
- file 上传成功、失败与中途切换凭据；COS 上传另做真实服务验收。
- 根开发入口的 SDK 源码重建、失败停止和修复后恢复。

需要回退时整体回退 SDK、调用方、依赖清单和 lockfile 到同一兼容版本，再安装依赖并重新生成/构建。仅恢复旧 import 或复制旧 `dist/` 无法恢复已删除接口。自定义 root 的新存储键不会被旧适配层自动读取，回退后也可能需要重新登录；不要跨 root 复制 token。

本分支没有数据库迁移。自动测试、实际本机开发生命周期、真实 COS/身份服务和部署验收分别记录，不能互相替代。
