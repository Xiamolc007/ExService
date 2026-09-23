# 决策索引

本目录记录 ExWebsite 中已接受的设计决策：背景、替代方案、理由、代价，以及重新审视它们的条件。

决策按模块分组，编号在每个模块内从 `01` 开始，编号不重复使用。引用某条决策时使用 `[[<module>/<NN>-<kebab-title>]]`，例如 `[[mock-server/03-database-changes-only-by-explicit-command]]`。

决定「为什么这样做」的内容留在本目录；它产生的结构写在 `../architectures/`，运行中暴露的失败模式写在 `../knowledge/`。

_最后更新：2026-09-23_

## 索引

| 编号 | 标题 | 模块 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| 01 | [以单份 OpenAPI Contract 作为唯一的 API 事实来源](api/01-openapi-as-single-contract.md) | `api` | 已接受 | 2026-09-16 |
| 02 | [把 Contract schema 限制在 Draft-07 兼容子集](api/02-draft07-compatible-schema-subset.md) | `api` | 已接受 | 2026-09-16 |
| 03 | [所有错误共用同一个 envelope](api/03-unified-error-envelope.md) | `api` | 已接受 | 2026-09-16 |
| 04 | [本站会话与 SSO 完成使用不同的 Contract 结果](api/04-separate-local-session-and-sso-completion.md) | `api` | 已接受 | 2026-09-23 |
| 01 | [生成的类型纳入版本控制，共享 Client 以源码形式导出](api-client/01-generated-types-committed-and-read-only.md) | `api-client` | 已接受 | 2026-09-16 |
| 01 | [共享 UI 组件放在独立工作区包，而不是 app 内部目录](components/01-app-level-shared-component-package.md) | `components` | 已接受 | 2026-09-18 |
| 01 | [由 Contract 注册路由，并显式声明前缀与 handler 映射](mock-server/01-contract-driven-route-registration.md) | `mock-server` | 已接受 | 2026-09-16 |
| 02 | [本地 Mock 数据库使用固定路径，不接受覆盖](mock-server/02-fixed-local-sqlite-database.md) | `mock-server` | 已接受 | 2026-09-16 |
| 03 | [数据库变更只由显式命令执行](mock-server/03-database-changes-only-by-explicit-command.md) | `mock-server` | 已接受 | 2026-09-16 |
| 04 | [只对外回显安全的错误消息](mock-server/04-safe-error-messages.md) | `mock-server` | 已接受 | 2026-09-16 |
| 01 | [前端只经共享 Client 调用，base URL 由配置决定](web/01-shared-client-with-configurable-base-url.md) | `web` | 已接受 | 2026-09-16 |
| 02 | [前端使用 react-router 的声明式路由](web/02-react-route-skeleton.md) | `web` | 已接受 | 2026-09-18 |
| 03 | [以 ExUI 作为组件库与主题来源](web/03-exui-as-component-and-theme-source.md) | `web` | 已接受 | 2026-09-18 |
| 01 | [Contract Test 必须断言 handler 的原始返回值](contract-tests/01-assert-raw-handler-output.md) | `contract-tests` | 已接受 | 2026-09-16 |
| 02 | [测试直接以 Contract 为 schema 来源，并做双向覆盖检查](contract-tests/02-contract-as-sole-schema-source.md) | `contract-tests` | 已接受 | 2026-09-16 |

## 模块目录

上表的模块列与磁盘上的目录一一对应：`api/`、`api-client/`、`components/`、`mock-server/`、`web/`、`contract-tests/`。这些目录名与 `../README.md` 中的模块划分保持一致。

尚未包含的决策领域：API 版本策略与兼容层、完整 Draft 2020-12 支持、PHP 侧 Contract Test 与 CI。它们都不是既有决策的例外，而是尚未开始的独立设计。

`web/02` 把「`RootLayout` 是否加入导航」留成了待决项。该问题已结掉：导航现在是 `RootLayout` 渲染的共享组件，见 [components/01](components/01-app-level-shared-component-package.md) 与 [web/03](web/03-exui-as-component-and-theme-source.md)。
