# multipart 上传与响应生命周期陷阱

仅提高路由 bodyLimit 或让 preParsing 返回计数流，不能证明 multipart 的实际字节、并发和内存预算受到约束。资源值以 `api/openapi.yaml` 为准。

_最后更新：2026-09-29_

## parts 必须经过实际计数流

`@fastify/multipart` 10.1.2 的 request.parts() 直接读取 request.raw。Fastify preParsing 返回的 Transform 不会自动成为插件输入。`apps/server/src/join/transport.ts` 仅在消费 parts 时适配 raw，并在 finally 恢复原 IncomingMessage；连接断开、响应结束和期限监听一直绑定原对象。升级插件时必须重新核对这一接缝，避免计数与解析各读不同流。

Busboy 的头部限制可能截断而非拒绝输入，实际 header 字节/对数须在解析前扫描；字段名按 UTF-8 字节数校验。原文件名通过 preservePath 保留，再独立拒绝路径字符，不能以静默 basename 化掩盖违规输入。

## 容量回收需要连接层证据

上传从 body 解析前占位，保留到响应/失败清理；下载在读取 BLOB 前占用独立响应容量，慢下载不占上传槽。Content-Length 预检不能替代 chunked wire 计数。下载开始后到期只能终止连接，不能追加 JSON 错误。

有效证明包括容量满后的拒绝、主动断开、截断、期限到期、事务写失败及随后有效重试。Fastify inject 和普通成功请求不能证明真实连接上的释放。`tests/contract/join-upload-sockets.test.ts` 使用真实本机 HTTP socket；测试缩短期限以覆盖回收，不能据此改短 Contract 默认期限。

## schema 标记不代表附件字节

附件 Buffer 位于请求私有上下文；进入 Contract validator 的 body 只有与数量匹配的 binary 字符串标记。handler 必须拒绝没有私有上下文的伪造标记。生成类型的字符串占位也不能被 serializer 发上线，或被误当成已持久化文件。资料与附件的保存责任及历史版本规则见 `.ai/databases/data-model.md`。

## 证据

- `apps/server/src/join/transport.ts` 与 `apps/server/src/handlers/join.ts`。
- `tests/contract/join-upload.test.ts`：生成 Client 真实互通、原始 handler、字节/头部及存储失败。
- `tests/contract/join-upload-sockets.test.ts`：容量、chunked、断开与期限回收。
- `.notes/archive/join-registration/rfcs/join-application-pages-implementation-notes.md`：编码规范修正。
