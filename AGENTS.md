## 沟通语言

默认用中文沟通：面向用户的回复、澄清提问、计划与总结都使用中文，除非用户要求换用其他语言。

代码与标识符、Commit message、以及既有文档各自沿用其既定语言约定，不因为这条规则而改动。

## 开发规范

1. 开发或修改 `apps/web/`、`packages/components/` 中的 Form 前，必须先阅读并遵守 `.ai/rules/frontend-forms.md`。
2. 开发或修改 `apps/web/`、`packages/components/` 中的全站临时通知时，统一使用 `ExMessage`，并先阅读、遵守 `.ai/rules/frontend-notifications.md`。

### 文档中的文件路径

- 在文档、注释和交付说明中提及仓库内文件或目录时，路径一律以**仓库根目录**为基准，例如 `.ai/databases/data-model.md`、`api/openapi.yaml`。移动文档后仍按仓库根目录填写路径。
- 仓库内路径使用行内代码表示；不要写以当前文档所在目录为基准的 `./`、`../` 路径或 Markdown 相对链接，也不要写本机绝对路径。代码中的 import 和运行时路径遵循各自的语言与工具约定。

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

本仓库采用 **Contract-first** 架构：`api/openapi.yaml` 是唯一的 HTTP API Contract，
`apps/server/` 是唯一的 Fastify Server，使用独立的 PostgreSQL `exre` 数据库；TypeScript 生成的 API Client 是前端访问层。当前仍处开发阶段，不代表已具备公网生产部署条件。

## 先读 Contract，再写代码

1. **不得臆造** endpoint、HTTP method、路径参数、请求字段或响应字段。
2. 实现任何 API 调用前，必须读取 `api/openapi.yaml`。
3. API 变更先修改 `api/openapi.yaml`，然后执行 `pnpm api:lint` 和 `pnpm api:generate`。
4. 前端只能通过 `@workspace/api-client` 发起 API 请求；不得直接使用 `fetch`，不得在本仓库内复制 DTO 类型。
5. Server 只实现 Contract 中带 `operationId` 的 operation；不得新增绕过 Contract 的 Fastify HTTP 路由、静态 JSON mock 路由，也不得用 Fastify schema 反向生成 OpenAPI。
6. 业务数据存储在独立的 PostgreSQL `exre` 数据库；头像二进制文件保存在 `apps/server/data/avatars/`。头像文件不得提交。`db:reset` 与服务启动均不删除头像目录；清理由显式核对数据库引用的工具或人工操作单独处理。
7. OpenAPI 3.1 的 schema 只能使用 JSON Schema Draft-07 兼容子集（`type`、`const`、`enum`、`required`、`properties`、`additionalProperties`、数组、`$ref` 等）。引入 Draft 2020-12 专有语义前，必须先单独设计并确认 Fastify 的 validator 与 serializer compiler，不能只改 Contract。
8. 破坏性 Contract 变更必须显式评审与版本化；当前没有版本策略或兼容层，不要自行发明。

## 目录边界

| 路径 | 责任 | 禁止事项 |
| --- | --- | --- |
| `api/` | 定义 HTTP 路径、operation、请求/响应/错误 schema。 | 存放前端或服务端实现。 |
| `packages/api-client/` | 导出生成的类型与 `createApiClient({ baseUrl })` 工厂。 | 引入 React、Valtio、Framer Motion、业务状态或 endpoint 定义。 |
| `packages/components/` | 应用级共享 UI 组件（站点顶栏等），基于 ExUI 组装。 | 直接使用 `fetch`、import `@workspace/api-client`、import `@exre/exui/style.css`、定义路由表。 |
| `apps/web/` | 配置 Vite、SCSS、环境变量，并适配共享 Client。 | 直接调用浏览器 `fetch`、复制 DTO、臆造 endpoint。 |
| `apps/server/` | 加载 Contract、映射 operation handler、执行受控的 PostgreSQL 访问。 | 用 `app.get()` 绕过 Contract、把 schema 写成第二份 API 定义、连接 `outline` 等其他数据库。 |
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
| `pnpm dev` | 并行启动 Vite（`8081`）与 Server（`8080`）；不执行 migration/reset。 |
| `pnpm api:lint` | 用 Redocly 校验 Contract 的解析、引用与项目规则。 |
| `pnpm api:generate` | 用 openapi-typescript 更新 `packages/api-client/src/generated/schema.d.ts`。 |
| `pnpm typecheck` | 对每个 workspace 包执行无输出的 TypeScript 检查。 |
| `pnpm test` | 运行 Vitest Contract、业务与 PostgreSQL 集成测试；数据库测试使用隔离容器。 |
| `pnpm build` | 构建 Vite 前端并编译 Server 的 TypeScript。 |
| `pnpm db:migrate` | 对已存在的独立 `exre` 数据库显式应用 PostgreSQL migration；不创建数据库。 |
| `pnpm db:reset -- --confirm exre` | 开发专用：校验回环地址、数据库身份和对象归属后重建应用结构；不删除头像。 |

新环境初始化顺序：

先创建独立的 PostgreSQL `exre` 数据库，并在本机 `apps/server/.env.local` 填入 `DATABASE_URL`、`AUTH_CODE_HMAC_KEY` 等配置；示例见 `apps/server/.env.example`。数据库不会由应用自动创建。

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
实现/更新 apps/server 的 handler（并在 app.ts 的 serviceHandlers 中登记）
  ↓
前端经 @workspace/api-client 调用
  ↓
pnpm typecheck && pnpm test && pnpm build
```

## 不可手改的生成物

`packages/api-client/src/generated/schema.d.ts` 由 `pnpm api:generate` 写入并纳入版本控制。
**禁止人工编辑**；Contract 变更必须同时提交重新生成的结果。

## Server 实现约定

- `apps/server/src/app.ts` 通过 `fastify-openapi-glue` 注册路由：

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
- 错误一律通过 `apps/server/src/errors.ts` 的统一 envelope 返回。对外消息只有两个来源：Fastify 依据 Contract schema 生成的校验错误，或固定文案；**其他异常（含应用代码抛出的 4xx）的 `error.message` 不得回显**，它可能包含 SQL、连接串或原始异常内容。
- Server 在监听前校验 `DATABASE_URL`、连接后的数据库身份、migration 状态和必需结构；失败时提示显式运行 `pnpm db:migrate`，**不得**在启动时创建数据库、迁移或重置。

## 数据库边界

- 修改表的职责、关系或数据规则前，先阅读并更新 `.ai/databases/data-model.md`，评审其对 PostgreSQL 模型的影响，再修改 schema 和 migration。纯索引调整、迁移实现及测试数据变动不要求更新模型文档；实际物理结构以 `apps/server/src/db/schema.ts` 和 `apps/server/drizzle/` 为准。
- `DATABASE_URL` 必须明确指向独立的 `exre` PostgreSQL 数据库；启动、迁移与重置都校验 URL 及连接后的 `current_database()`，不得触及 `outline`。
- 自动测试使用独立 PostgreSQL Testcontainers 容器和逐用例 schema，不回退到本机开发数据库。
- migration 只能通过显式命令执行；服务启动不建表、不生成 migration、不隐式 reset。
- `apps/server/src/db/migrate.ts` 与 `apps/server/src/db/reset.ts` 是 **CLI 入口，不能被 import**。二者在非直接执行时抛错；可复用逻辑位于 `apps/server/src/db/migration-runner.ts`、`apps/server/src/db/reset-plan.ts` 与 `apps/server/src/db/client.ts`。

## 开发与部署边界

当前拓扑为单实例 Server + PostgreSQL，仍使用本机头像文件、进程内限流、开发期终端邮件和临时审核流程。公网权限、邮件、人机验证、备份恢复、监控及多实例共享能力需要后续独立设计；本阶段不部署上线。
