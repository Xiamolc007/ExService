# @workspace/sdk

面向浏览器与 Node.js 的通用功能 SDK，当前只提供 `storage` 能力。

上传的返回值为**一个 URL 字符串**。SDK 本身不落库、不保存文件表、不提供删除或列举接口。

## 安装与入口

产物通过条件导出选择环境实现，公开类型在两个入口下完全一致：

| 入口 | 解析到 | 说明 |
| --- | --- | --- |
| `@workspace/sdk` | `browser` / `node` / `default`（浏览器） | 主出口，按运行环境自动选择 |
| `@workspace/sdk/browser` | 浏览器产物 | 只依赖 `cos-js-sdk-v5` |
| `@workspace/sdk/node` | Node 产物 | 只依赖 `cos-nodejs-sdk-v5` |

`api-client` 与 `openapi-fetch` 已打包进产物，外部消费方不需要安装私有 workspace 包。

## 用法

```ts
import { createSdk } from '@workspace/sdk/node'

const sdk = createSdk({
  baseUrl: 'http://127.0.0.1:8080/api',
  getAccessToken: async () => currentBearerToken,
})

// 返回存储后的公开 URL
const url = await sdk.storage.upload('avatars/user-123.webp', bytes, { contentType: 'image/webp' })
```

`bytes` 接受 `Blob`、`File`、`Uint8Array`；Node 的 `Buffer` 作为 `Uint8Array` 支持。

### 选项

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | 本站 API 根地址。浏览器允许 `/api` 这类相对地址，Node 要求绝对 HTTP(S) 地址。 |
| `getAccessToken` | 同步或异步返回现有 Bearer token。每次本站请求前调用，SDK 不持久化、不刷新、不提供登录界面。 |
| `options.medium` | 可选，`'file' \| 'cos'`。省略时由服务器配置决定。 |
| `options.contentType` | 可选内容声明；省略时取 `Blob.type`，再回退 `application/octet-stream`。 |

## 流程与边界

1. 归一化输入并读取字节数。
2. `prepare`：服务器决定本次介质，COS 分支返回限定权限的 STS 凭证与上传凭据。
3. `file` 分支走本站 multipart 上传；`cos` 分支由本端 `PutObject` 后经服务器 `complete` 确认。
4. 只返回 `url`。

明确的行为边界：

- 同一 key 覆盖原内容，不维护版本；最终对象以实际完成的覆盖为准。
- COS 下载 URL 是签发起一年的签名地址，不提供续签。
- 默认单文件上限 20 MiB（服务端可配置），不做分块上传。
- 直传成功但确认失败时 `upload` 抛错；调用方可重新调用，这可能再次覆盖同一 key。
- SDK 不自动重传文件，不自动申请新凭据重试。

## 错误

所有失败都抛 `StorageSdkError`，带稳定的 `code`、可选的 `status` 与 `requestId`：

```ts
import { StorageSdkError } from '@workspace/sdk/node'

try {
  await sdk.storage.upload('a.bin', bytes)
} catch (error) {
  if (error instanceof StorageSdkError && error.code === 'TOO_LARGE') { /* ... */ }
}
```

错误文本不含临时凭证、上传票据或完整 URL。COS/STS 的原始异常不会直接作为展示文案。
