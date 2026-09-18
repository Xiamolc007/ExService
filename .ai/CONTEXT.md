# ExWebsite

本仓库是一个 Contract-first 的本地 Backend Sandbox：在前端生产后端（PHP + MySQL）尚未交付期间，用一个可运行、可保存状态的本地 Node 后端替代固定 JSON Mock；未来 PHP 服务按同一份 API Contract 实现后，前端只需切换 API base URL。

_最后更新：2026-09-17_

## Language

**Contract（API Contract）**:
前端、本地 Mock 实现与未来生产实现共同遵守的唯一 HTTP API 事实来源。任何一方都不得在 Contract 之外新增路径、字段或错误格式；实现只能从 Contract 派生行为或类型。
_Avoid_: 接口文档、Swagger 文件、示例 API

**operation**:
Contract 中一个具体的「HTTP 方法 + 路径」行为单元。它是 Contract 与实现之间的最小交付单位。
_Avoid_: 接口、路由、endpoint 定义

**operationId**:
把一个 operation 绑定到其实现者（handler）的稳定标识。Service handler 是否被注册，以及覆盖检查是否通过，都以它为准；文件位置不参与解析。
_Avoid_: handler 名、路由名、函数名

**Mock Server**:
本地替代生产后端的 Fastify 进程。它按 Contract 注册路由并实现行为，可写本地数据库，但只服务于本地开发。
_Avoid_: 假后端、stub 服务、测试服务器

**生产实现（PHP 实现）**:
未来按同一份 Contract 实现的 PHP + MySQL 后端。它不使用本仓库的 Node、Drizzle 或 SQLite 代码，但必须实现相同的行为与错误结构。
_Avoid_: 真实后端、正式服务器、上线环境

**Mock 数据**:
只存在于本地 Mock 数据库中、可被受控重置丢弃的数据。它不代表任何业务事实，也不得提交到版本控制。
_Avoid_: 测试数据、种子数据、演示数据

**Mock 数据库**:
服务本地 Mock 环境的固定 SQLite 文件，不连接、不共享生产数据库。
_Avoid_: 本地库、开发库、测试数据库

**健康检查**:
Mock Server 自身可用性的最小信号。它表示进程已完成监听前置检查，不表示业务数据可被读写。
_Avoid_: 存活探针、业务就绪检查、状态接口

**envelope（错误 envelope）**:
所有失败响应的统一外壳。Contract 只约束它的外壳形状；具体的错误码取值属于实现侧的约定。
_Avoid_: 错误对象、错误详情、error 结构

**migration**:
对本地 Mock 数据库结构的可执行、可累积的变更单元。它只能由显式命令应用，服务启动不会生成或应用它。
_Avoid_: 建表脚本、schema 变更、SQL 文件

**baseline migration**:
记录迁移基线的 migration。它不产生业务结构，且不可回写；首个业务表必须由新的 migration 创建。
_Avoid_: 初始 migration、0000 脚本、空迁移

**受控重置**:
只丢弃本地 Mock 数据库及其 SQLite 伴随文件、随后重建为空结构的操作。它不接受路径参数，也不删除目录、migration、源码或其他工作区文件。
_Avoid_: 清库、重置环境、删除数据库

**共享 Client**:
前端发起 HTTP 请求的唯一通道，由 Contract 生成的类型支撑。它不定义 endpoint，只承载调用。
_Avoid_: API 封装、请求库、SDK wrapper

**API base URL**:
前端请求前缀。它由部署配置决定，使同一份前端代码可以从本地 Mock Server 切换到生产实现而不改动业务调用点。
_Avoid_: 接口域名、服务地址、代理地址

**破坏性 Contract 变更**:
会使既有调用方失效的 Contract 修改（例如删除或重命名 operation、收紧必填字段、改变响应类型）。当前没有版本策略或兼容层，因此这类变更必须单独评审。
_Avoid_: 不兼容改动、大改动、breaking

**Draft-07 兼容子集**:
Contract 中 schema 允许使用的 JSON Schema 关键字范围。它由运行时校验器的语义决定，而不是由 OpenAPI 版本号决定。
_Avoid_: JSON Schema 子集、受限 schema、简化 schema
