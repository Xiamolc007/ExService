# ExWebsite

ExWebsite 使用单份 OpenAPI Contract 连接 Web、生成式 API Client 与唯一 Fastify Server。Server 将业务数据保存在独立的 PostgreSQL `exre` 数据库。当前项目仍处开发阶段；本地运行成功不代表已具备公网部署条件。

## 本地启动

需要 Node.js 22.12+（同时满足 `apps/outline/package.json` 的 Node engines）、pnpm 11.9.0、可用的 Corepack/Yarn、Docker Compose，以及原 Website PostgreSQL。`apps/outline/` 是独立 Git submodule，使用自己的 Yarn 安装依赖，不属于 pnpm workspace；按两个应用现有依赖配置分别安装。现有 ExUI checkout、链接和已构建产物须可用；不要为启动改写链接或根 lockfile。Node/Corepack 可通过 `INTEGRATION_NODE_BIN`、`INTEGRATION_COREPACK_JS` 显式指定。

1. 保留当前 Website 的独立 `exre` 数据库、账号、HMAC、存储和头像目录。`apps/server/.env.local` 与进程环境仍提供原 Website 配置，进程环境优先；示例见 `apps/server/.env.example`。不要用另一套空库替换已有 `exre`，不要提交凭据。
2. 必须已有一个由用户选定、存在且启用的 Website 账号，供首次文档管理员初始化。全新 Website 安装须先显式创建独立 `exre`、配置并迁移 Website、完成账号注册，再进行 bootstrap；下列 configure/init 不创建 Website 数据库或账号。
3. 安装根依赖，并在 `apps/outline/` 中使用其 Corepack Yarn 安装依赖，准备已有 ExUI 产物。随后在仓库根目录按顺序运行（把示例 UUID 占位替换为用户选定的实际账号 UUID）：

   ```bash
   pnpm install
   pnpm api:lint
   pnpm api:generate
   pnpm integration:configure -- --mode local
   pnpm db:migrate
   pnpm integration:init -- --mode local
   pnpm integration:bootstrap -- --mode local --admin-user-id <Website-UUID>
   pnpm dev
   ```

访问 `http://127.0.0.1:8080/` 与 `http://127.0.0.1:8080/docs/`。`pnpm dev` 只读核对已准备的 local 目标，监督 Website、Outline 和本地身份基础服务；不隐式 configure、迁移、reset、登记客户端或初始化管理员。缺配置、迁移、客户端、工作区标记、持久卷或端口冲突时拒绝启动，不回退原生 Outline 邮箱登录。不要用 `localhost` 或直接 Vite origin 代替该浏览器入口。

端口、独立 Outline/Hydra 资源、旧 8090 模式、只读检查和安全恢复的完整说明集中在 `.ai/architectures/docs-integration/integration-boundaries.md`。上述启动流程是实现的使用说明；自动检查与隔离资源证明不能替代真实浏览器场景验收，也不代表公网生产部署验收。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动显式准备好的 local 文档与统一身份集成。 |
| `pnpm integration:configure -- --mode local` | 校验原 Website 数据源、工具和依赖，保存 local 配置与稳定密钥。 |
| `pnpm integration:init -- --mode local` | 显式准备独立 Outline/Hydra 数据库及迁移，不创建 Website `exre`。 |
| `pnpm integration:migrate -- --mode local` | 对已核验的 local 文档与身份数据库显式迁移。 |
| `pnpm integration:bootstrap -- --mode local --admin-user-id <Website-UUID>` | 以明确的已有启用账号初始化文档管理员。 |
| `pnpm integration:down -- --mode local` | 停止本模式受管运行资源，不删除卷或数据。 |
| `pnpm integration:dev` / `pnpm integration:up` | 原 8090 dev / full 集成，须独立配置与准备。 |
| `pnpm api:lint` | 校验 `api/openapi.yaml`。 |
| `pnpm api:generate` | 从 Contract 生成 Client 类型；不要手改生成文件。 |
| `pnpm typecheck` | 检查工作区 TypeScript。 |
| `pnpm test` | 运行 Vitest；数据库用例使用独立 PostgreSQL Testcontainers 容器与逐用例 schema。 |
| `pnpm build` | 构建 Web 和 Server。 |
| `pnpm db:migrate` | 对已存在的 `exre` 显式应用 PostgreSQL migration。 |
| `pnpm db:reset -- --confirm exre` | 开发专用，核验目标和对象后重建应用结构；不删除头像文件。 |

数据库测试在 Docker 不可用时应明确失败，不会回退到本机 `exre` 或 `outline`。`db:reset` 会清除 `exre` 内本应用数据，运行前核对目标。

## 代码与契约

- `api/openapi.yaml` 是唯一 HTTP Contract；Server 只注册带 `operationId` 的 operation。
- `apps/server/` 实现认证、资料、加入申请、邀请和本机头像文件；PostgreSQL 结构位于 `apps/server/src/db/schema.ts` 与 `apps/server/drizzle/`。
- `packages/api-client/` 提供生成的类型与共享 Client；`apps/web/` 只经它访问 API。
- `tests/contract/` 验证真实 Fastify 路由、错误 envelope 与 handler 的原始返回值。

开发约束见 `AGENTS.md`；系统边界、数据规则和历史决策见 `.ai/README.md`。Server 正式化设计与技术细节见 `.notes/server-promotion/specs/2026-09-29-server-promotion-design.md` 和 `.notes/server-promotion/rfcs/server-postgresql-migration-rfc.md`。
