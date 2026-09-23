## 沟通语言

默认用中文沟通：面向用户的回复、澄清提问、计划与总结都使用中文，除非用户要求换用其他语言。

代码与标识符、Commit message、以及既有文档各自沿用其既定语言约定，不因为这条规则而改动。

## 开发规范

1. 开发或修改 `apps/web/`、`packages/components/` 中的 Form 前，必须先阅读并遵守 [`.ai/rules/frontend-forms.md`](.ai/rules/frontend-forms.md)。

<!-- codebase-worker:start -->
## Project AI documentation rules

- Before design, development, debugging, or a major decision, read the relevant content in `.ai/`.

### Durable knowledge extraction

- After completing a module or making a major decision, use `codebase-documenter` to update evidence-backed durable `.ai/` knowledge.
- `.ai/CONTEXT.md` holds the domain language; `.ai/architectures/`, `.ai/decisions/`, and `.ai/knowledge/` hold system structure, accepted decisions, and non-obvious behavior, each grouped by module. Database model, database-specific decisions, and database-specific operational knowledge live in `.ai/databases/`. Keep each fact in exactly one place and link instead of duplicating.
- Design documents, RFCs, and implementation plans stay where they are, normally `notes/<module>/`. After a design is complete, ask the user before distilling its stable conclusions into `.ai/`.
- Do not archive transient task narration, raw test output, unadopted speculation, source-code duplication, or version-control and workspace state. Update `.ai/README.md` and `.ai/decisions/README.md` after structural changes.

### Testing and contribution rules

- Testing rules: if this repository has a `TESTING.md`, read it before testing; when it exists, it is the single source of truth for test workflow, test-case authoring, and execution rules. When it does not exist, follow the repository's own testing conventions instead.
- Contribution rules: `@CONTRIBUTING.md`. Read this file before creating a commit or Pull Request; it is the single source of truth for contribution, commit, and PR rules.

### How to Commit
- If a code-commiter skill is available, commits must be made using this SKILL.
<!-- codebase-worker:end -->

# AGENTS.md

本仓库是一个 **Contract-first 的本地 Backend Sandbox**：`api/openapi.yaml` 是唯一的 HTTP API Contract，
Fastify + SQLite 是本地开发实现，未来的 PHP + MySQL 是生产实现，TypeScript 生成的 API Client 是前端访问层。

## 先读 Contract，再写代码

1. **不得臆造** endpoint、HTTP method、路径参数、请求字段或响应字段。
2. 实现任何 API 调用前，必须读取 `api/openapi.yaml`。
3. API 变更先修改 `api/openapi.yaml`，然后执行 `pnpm api:lint` 和 `pnpm api:generate`。
4. 前端只能通过 `@workspace/api-client` 发起 API 请求；不得直接使用 `fetch`，不得在本仓库内复制 DTO 类型。
5. Mock Server 只实现 Contract 中带 `operationId` 的 operation；不得新增 Fastify HTTP 路由、静态 JSON mock 路由，也不得用 Fastify schema 反向生成 OpenAPI。
6. Mock 数据只保留在本地 SQLite（`apps/mock-server/data/mock.sqlite`）；不得提交数据库文件。
7. OpenAPI 3.1 的 schema 只能使用 JSON Schema Draft-07 兼容子集（`type`、`const`、`enum`、`required`、`properties`、`additionalProperties`、数组、`$ref` 等）。引入 Draft 2020-12 专有语义前，必须先单独设计并确认 Fastify 的 validator 与 serializer compiler，不能只改 Contract。
8. 破坏性 Contract 变更必须显式评审与版本化；当前没有版本策略或兼容层，不要自行发明。

## 目录边界

| 路径 | 责任 | 禁止事项 |
| --- | --- | --- |
| `api/` | 定义 HTTP 路径、operation、请求/响应/错误 schema。 | 存放前端或服务端实现。 |
| `packages/api-client/` | 导出生成的类型与 `createApiClient({ baseUrl })` 工厂。 | 引入 React、Valtio、Framer Motion、业务状态或 endpoint 定义。 |
| `packages/components/` | 应用级共享 UI 组件（站点顶栏等），基于 ExUI 组装。 | 直接使用 `fetch`、import `@workspace/api-client`、import `@exre/exui/style.css`、定义路由表。 |
| `apps/web/` | 配置 Vite、SCSS、环境变量，并适配共享 Client。 | 直接调用浏览器 `fetch`、复制 DTO、臆造 endpoint。 |
| `apps/mock-server/` | 加载 Contract、映射 operation handler、执行受控的 SQLite 访问。 | 用 `app.get()` 绕过 Contract、把 schema 写成第二份 API 定义、连接生产数据库。 |
| `tests/contract/` | 从 Contract 读取 schema，对真实 Fastify app 的 HTTP 响应做验证。 | 只单测 handler 而跳过路由与 schema 注册。 |

### 共享组件与 ExUI

`packages/components` 的依赖边界：`react` / `react-dom` / `react-router` 同时声明为 `peerDependencies`（保证消费方单一实例与 context 共享）与 `devDependencies`（本包 `typecheck` 需要）；`@exre/exui` 与 `lucide-react` 是普通 `dependencies`。样式用 CSS Modules，颜色、边框、圆角一律取 ExUI 的 `var(--exui-*)`，不新建本地 token 层。

以下三条是 `@exre/exui` 自身的契约，写错不会报错、只会静默失效：

- **`@exre/exui/style.css` 每个应用只导入一次**，它已内含 Token CSS 与字体 CSS。导入点固定在 `apps/web/src/main.tsx`；不得在 `packages/components` 内导入，也不得再导入 `@exre/exui/tokens/style.css` 或 `font.css`。
- **`useTheme` 必须在 `ThemeProvider` 之内调用**，否则抛错。provider 挂在 `apps/web/src/main.tsx`，高于路由；不要在可能没有 provider 的组件里调用它。
- **`@exre/exui` 不声明 `color-scheme`**，其 `ThemeProvider` 也只增删 `documentElement` 上的 `light` / `dark` 类。应用侧必须按同一组类选择器自己补 `color-scheme`（见 `apps/web/src/styles/index.scss`）。

`@exre/exui` 会把 Sonner、Radix、Base UI 等实现库一并打包进产物；**不要**为了使用 ExUI 组件而单独安装这些库，重复实例会让状态不共享（通知类组件会静默失效）。图标统一用 `lucide-react`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 并行启动 Vite（`8081`）与 Mock Server（`8080`）；不执行 migration/reset。 |
| `pnpm api:lint` | 用 Redocly 校验 Contract 的解析、引用与项目规则。 |
| `pnpm api:generate` | 用 openapi-typescript 更新 `packages/api-client/src/generated/schema.d.ts`。 |
| `pnpm typecheck` | 对每个 workspace 包执行无输出的 TypeScript 检查。 |
| `pnpm test` | 运行 Vitest Contract Test。 |
| `pnpm build` | 构建 Vite 前端并编译 Mock Server 的 TypeScript。 |
| `pnpm db:migrate` | 创建/升级本地 SQLite 文件并应用未执行的 migration。 |
| `pnpm db:reset` | 只删除并重建 `apps/mock-server/data/mock.sqlite` 及其 WAL/SHM 文件。 |

新环境初始化顺序：

```bash
pnpm install
pnpm api:lint
pnpm api:generate
pnpm db:migrate
pnpm dev
```

## 修改 API 的固定顺序

```
修改 api/openapi.yaml
  ↓
pnpm api:lint
  ↓
pnpm api:generate          # 重新生成 packages/api-client/src/generated/schema.d.ts
  ↓
实现/更新 apps/mock-server 的 handler（并在 app.ts 的 serviceHandlers 中登记）
  ↓
前端经 @workspace/api-client 调用
  ↓
pnpm typecheck && pnpm test && pnpm build
```

## 不可手改的生成物

`packages/api-client/src/generated/schema.d.ts` 由 `pnpm api:generate` 写入并纳入版本控制。
**禁止人工编辑**；Contract 变更必须同时提交重新生成的结果。

## Mock Server 实现约定

- `apps/mock-server/src/app.ts` 通过 `fastify-openapi-glue` 注册路由：

  ```ts
  fastify.register(openapiGlue, {
    specification: openapiPath,
    prefix: '/api',
    serviceHandlers: { getHealth },
  })
  ```

- OpenAPI 路径写 `/health`，实际注册为 `/api/health`。`servers[].url` **不能**替代 Glue 的 `prefix`。
- `operationId` 通过 `serviceHandlers.<operationId>` 显式映射到 handler；文件名不参与自动解析。
- 新增 operation 时，必须同时更新 `serviceHandlers`，并在 `tests/contract/` 增加对应的 Contract Test。
- **响应序列化会掩盖 handler 回归**：Fastify 用 Contract 的 response schema 序列化响应，未声明的字段会被静默丢弃，`const` 声明会被强制写入。实测 handler 返回 `{status:'ok',secret:'x'}`、`{status:'down'}` 或 `{status:42}` 时，线上响应都仍是 `{"status":"ok"}`。
  → 因此 Contract Test 除了断言 HTTP 响应体，**必须**同时校验 `serviceHandlers` 中注册的 handler 的**原始返回值**（见 `tests/contract/health.test.ts` 的 `registered handler output`）。只断言 HTTP 响应体时，「多余字段 / `const` 值 / 值类型」三类漂移完全不可见（缺字段会让序列化失败并变成 500，反而能被 HTTP 断言抓到）。
- Contract 与 `serviceHandlers` 必须**双向一致**：`contract coverage` 测试会检查「Contract 声明的每个 operationId 都已登记 handler」以及「没有登记 Contract 未声明的 handler」。**新增** operation 却漏登记时，该路由只会在运行时返回 500，而 `/api/health` 等既有断言仍然全绿 —— 只有这条覆盖检查能发现。
- 错误一律通过 `src/errors.ts` 的统一 envelope 返回。对外消息只有两个来源：Fastify 依据 Contract schema 生成的校验错误，或固定文案；**其他异常（含应用代码抛出的 4xx）的 `error.message` 不得回显**，它可能包含堆栈、SQL、SQLite 路径或原始异常内容。
- Mock Server 在监听前检查本地数据库文件是否存在；缺失时进程必须失败并提示 `pnpm db:migrate` 或 `pnpm db:reset`，**不得**隐式创建或重置数据库。
- 首个业务表必须由**新的** Drizzle migration 创建；不得修改 `drizzle/0000_baseline.sql`。

## 数据库边界

- 修改表的职责、关系或数据规则前，先阅读并更新 [`.ai/databases/data-model.md`](.ai/databases/data-model.md)，评审其对本地 SQLite 与未来 PHP + MySQL 目标业务模型的影响，再修改 schema 和 migration。纯索引调整、迁移实现及测试数据变动不要求更新模型文档；实际物理结构以各实现的 schema 和 migration 为准。
- 本地数据库固定为 `apps/mock-server/data/mock.sqlite`，仅服务于本地 Mock 环境。
- 不连接、不共享 PHP/生产 MySQL 数据库；不提供任意数据库路径或任意文件删除入口。
- migration 只能通过显式命令执行；服务启动不建表、不生成 migration、不隐式 reset。
- `src/db/migrate.ts` 与 `src/db/reset.ts` 是 **CLI 入口，不能被 import**（会写入或删除本地数据库）。
  二者在非直接执行时抛错；需要复用逻辑时，只 import `src/db/client.ts` 中的纯函数。

## 未来接入 PHP 时

PHP 后端只需按同一份 Contract 实现 API，不使用本仓库的任何 Node、Drizzle 或 SQLite 代码。
前端业务调用点不改变，只调整 `VITE_API_BASE_URL` 指向 PHP 的 `/api` 前缀。
