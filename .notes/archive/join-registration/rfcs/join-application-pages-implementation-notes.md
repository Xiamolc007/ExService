# 完整加入申请的技术实施补充

> 迁移说明（2026-09-29）：本文件保留当时的业务与实现决定；其中旧 `apps/mock-server/` 路径、本地 SQLite Mock 与未来 PHP/MySQL 接管的基础设施描述，已由 `.notes/archive/server-promotion/specs/2026-09-29-server-promotion-design.md` 和 `.notes/archive/server-promotion/rfcs/server-postgresql-migration-rfc.md` 取代。当前唯一 Server 位于 `apps/server/`，使用独立 PostgreSQL `exre`；正文中的旧路径和目标仅作历史记录。

日期：2026-09-27。本文补充已批准的 `.notes/archive/join-registration/rfcs/join-application-pages-rfc.md`，保留源 RFC/spec 原文。邀请快照导入与 Contract `0.4.0` → `0.5.0` 一次破坏性切换已获批准；HTTP 的现行事实来源为 `api/openapi.yaml`。产品字段、一次申请规则、只读查询及邀请生命周期不因以下技术修正改变。

## multipart 编码修正

源 RFC 第 5.2 节的 proofs“encoding 明确 explode”改由当前 Contract 的 `contentType: '*/*'` 表达，移除显式 `style`、`explode`，也不设置 `allowReserved`。根据 [OpenAPI 3.1.1 Encoding Object](https://spec.openapis.org/oas/v3.1.1.html#encoding-object) 第 4.8.15.1.2 与 4.8.15.3 节，显式指定 RFC6570 序列化字段会使 contentType 被忽略；未指定这些字段的 multipart 数组按同名 part 传递。这里需要原始二进制及各文件自己的 MIME，不需要 percent encoding。

应用侧仍使用生成 Client 的 bodySerializer，将 application 作为 JSON Blob，将每个 File 以同名 proofs part 追加；不手设 boundary。通配 contentType 允许保留文件的实际 MIME，不表示信任它：服务器独立验证扩展名、真实字节及格式家族签名。签名验证不等于杀毒、消毒或完整 Office 文档结构验证；审核只下载，不内联呈现。

生成 Client/真实临时 Fastify 互通已经覆盖零附件与多个同名附件，核对 Unicode 原名、MIME、二进制字节与 SHA-256；证据在 `.superpowers/sdd/join-application-pages-rfc/transport-report.md`。这比手写 FormData 或 Contract lint 更能证明当前接法。

## 传输实现接缝

源 RFC 的 preParsing 计数流需要额外适配：安装的 `@fastify/multipart` 10.1.2 从 request.raw 消费 parts。仅返回计数流不能保证 request.parts 经过预算。现行接线在 parts 读取期间使用计数 Transform，结束恢复原 IncomingMessage，并始终在原连接/响应监听断开及超时。失败、事务异常和响应完成都释放容量与请求私有 Buffer。长期维护陷阱见 `.ai/knowledge/server/multipart-lifecycle-traps.md`。

## 社区链接与邀请基线

旧 ex-face 源码与旧 QQ/KOOK 地址未能取得可核对的可用证据。当前页面通过 `apps/web/src/join/community.ts` 接收可选的 `VITE_COMMUNITY_QQ_URL` / `VITE_COMMUNITY_KOOK_URL`，仅输出合法 HTTPS 配置。URL 语法有效不证明社区仍可访问；设置前由维护者核对。不提供猜测地址、虚构手册路由或死链接；缺少配置时提示阅读社区置顶指引、联系工作人员。

顶栏桌面/移动注册 Modal 与独立 `/register` 共用邀请流程。邮箱继续仍是只读资格检查，之后才进入数字码；检查不发码。完整申请不替换该流程，也不把结果查询当作注册授权。边界见 `.ai/architectures/web/authentication-flow.md`。

## 验收边界

隔离内存 SQLite、临时目录与本机随机端口的 Contract/真实 socket 测试，证明本地 Mock 的输入、字节传输与资源释放；迁移夹具只能证明对应历史数据升级路径。固定开发数据库 `apps/mock-server/data/mock.sqlite` 不存在，本次没有执行开发库 migration/reset、备份恢复或开发库升级后演练。这些步骤不得由夹具 PASS 代替。

终端邮件适配器只模拟邮件，不证明真实收件。浏览器、PHP/MySQL、生产权限及正式邮件分别需要自己的验收证据。原设计的本地临时公开审核范围保持不变。
