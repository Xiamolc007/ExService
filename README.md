# ExWebsite

ExWebsite 使用单份 OpenAPI Contract 连接 Web、生成式 API Client 与唯一 Website Fastify Server，业务数据保存在独立 PostgreSQL `exre`。Outline 是独立文档服务。项目仍处开发阶段，本地运行成功不代表已具备公网部署条件。

## 环境要求

- Node.js 22.12+，同时满足 `apps/outline/package.json` 的 engines；pnpm 11.9.0、可用的 Corepack/Yarn 和 Docker Compose。
- 已有独立 Website PostgreSQL `exre`。文档基础设施不创建 Website 数据库或账号。
- 安装根 pnpm 依赖及 `apps/outline/` 的独立 Yarn 依赖；Outline 是 Git submodule，不属于 pnpm workspace。
- ExUI 使用 registry 发布包，由各自 lockfile 锁定版本，不需要本地 ExUI checkout 或构建。Node/Corepack 可通过 `INTEGRATION_NODE_BIN`、`INTEGRATION_COREPACK_JS` 显式指定。

普通运行配置只读取根 `.env.local`，受支持的进程变量优先，示例见 `.env.example`。不要提交凭据，也不要用示例默认值覆盖既有数据库、HMAC、存储或头像配置。

## 本地启动

### 已有环境

先在原终端停止应用，并处理旧环境未完成的准备或清理。保留原 Website `exre`、账号、秘密和持久数据，显式导入旧配置：

```bash
pnpm infra configure --import-existing
pnpm service:start
pnpm dev
```

导入校验、失败恢复和旧模式处理见 `docs/runtime.md`。

### 全新环境

1. 安装根依赖，并在 `apps/outline/` 中使用 Corepack Yarn 安装独立依赖；ExUI 随依赖安装。
2. 显式创建独立 Website `exre`，复制 `.env.example` 到根 `.env.local`，填写数据库、`AUTH_CODE_HMAC_KEY` 等配置。
3. 在仓库根目录校验 Contract、生成 Client，并显式准备数据库及文档基础设施：

   ```bash
   pnpm install
   pnpm api:lint
   pnpm api:generate
   pnpm infra configure
   pnpm db:migrate
   pnpm infra init
   ```

4. 注册 Website 账号，并由用户选择一个已有启用账号的 UUID，初始化文档管理员。将占位符替换为实际 UUID：

   ```bash
   pnpm infra bootstrap --admin-user-id <Website-UUID>
   pnpm service:start
   pnpm dev
   ```

### 日常使用

依赖已准备后，运行 `pnpm service:start` 启动 PostgreSQL、Redis、Hydra，等待就绪后该命令退出；再运行 `pnpm dev` 监督 Website 和 Outline 应用。`dev` 只读检查准备状态，不隐式迁移、reset、登记客户端或初始化管理员。

默认访问 `http://127.0.0.1:8080/` 与 `http://127.0.0.1:8080/docs/`，使用与配置一致的 public origin，不以 `localhost` 或直接 Vite origin 替代。开发终端 Ctrl+C 只清理本次应用进程；随后运行 `pnpm service:stop` 停止受管依赖，不删除卷或附件。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm service:start` | 启动已准备且归属已验证的 PostgreSQL/Redis/Hydra，等待就绪后退出。 |
| `pnpm dev` | 只读核对依赖和准备状态，监督 Website/Outline 应用。 |
| `pnpm service:stop` | 无活跃应用时停止受管依赖，不删除持久数据。 |
| `pnpm infra configure` | 校验根配置、工具、依赖及原 Website 数据源；新安装填补缺少的文档秘密。 |
| `pnpm infra configure --import-existing` | 显式导入既有 v1 local 配置，保留秘密、资源指纹与准备阶段。 |
| `pnpm infra init` / `pnpm infra migrate` | 显式准备或迁移独立 Outline/Hydra，不创建 Website `exre`。 |
| `pnpm infra bootstrap --admin-user-id <Website-UUID>` | 核验明确指定的已有启用账号，初始化文档管理员。 |
| `pnpm infra test <test-file> <case-name>` | 在隔离资源中运行指定 Outline 测试，文件须位于其 `server/` 或 `plugins/`。 |
| `pnpm api:lint` | 用 Redocly 校验 `api/openapi.yaml`。 |
| `pnpm api:generate` | 从 Contract 更新 `packages/api-client/src/generated/schema.d.ts`，禁止手改生成文件。 |
| `pnpm typecheck` | 检查工作区 TypeScript。 |
| `pnpm test` | 运行 Website Vitest；数据库用例使用 PostgreSQL Testcontainers 与逐用例 schema。 |
| `pnpm build` | 构建 SDK、Website Web/Server 和完整定制 Outline，不连接数据库或启动 Docker。 |
| `pnpm db:migrate` | 对已存在的独立 `exre` 显式应用 migration，不创建数据库。 |
| `pnpm db:reset -- --confirm exre` | 开发专用，核验回环地址、数据库身份及对象归属后重建应用结构，不删除头像。 |

数据库测试在 Docker 不可用时明确失败，不会回退到本机 `exre` 或 `outline`。`db:reset` 会清除本应用数据，运行前核对目标。

## 工程与文档入口

- `api/openapi.yaml` 是唯一 HTTP Contract；Server 通过 `operationId` 显式映射 handler。
- `apps/server/` 实现 Website 业务；PostgreSQL 结构位于 `apps/server/src/db/schema.ts` 与 `apps/server/drizzle/`。
- `packages/api-client/` 提供生成类型与共享 Client；`apps/web/` 通过它访问 API。
- `tests/contract/` 验证真实 Fastify 路由、错误 envelope、原始 handler 输出与双向 operation 覆盖。

开发规则与 workflow 见 `AGENTS.md`；架构、数据规则及已接受决策从 `.ai/README.md` 查阅。配置导入、运行恢复、镜像和部署材料见 `docs/runtime.md`；文档身份、代理与资源归属边界见 `.ai/architectures/docs-integration/integration-boundaries.md`。历史设计保存在 `.notes/archive/`，不作为当前启动指南。

自动检查、隔离资源测试、真实浏览器验收和公网部署验收分别报告；本阶段不部署上线。
