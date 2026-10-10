# ExWebsite

ExWebsite 以 `api/openapi.yaml` 为唯一 HTTP Contract，Website 使用独立 PostgreSQL `exre`。Outline 是独立 Git submodule，使用自己的 Yarn、数据库和附件存储。项目仍处开发阶段，不执行公网部署。

## 环境与配置

需要 Node 22.12+ 且满足 `apps/outline/package.json` 的 engines、pnpm 11.9.0、Corepack/Yarn。本地依赖使用 Docker Compose；服务器由操作者安装原生 PostgreSQL、Redis、Hydra v2.3.0、PM2 和 Nginx。

根依赖与 Outline 依赖分别按 lockfile 安装。ExUI 使用 registry 发布包，不需要本地源码或链接。普通运行只读取根 `.env.local`，支持的进程变量优先；字段见 `.env.example`，详细说明见 `docs/runtime.md`。不要用示例覆盖已有配置。

## 已有环境的切换

先阅读 `docs/runtime.md` 的维护切换章节。配置转换、PG16→18 恢复、issuer 变更及卷归属迁移是不同步骤；不能以一次配置转换替代数据和身份迁移。

```bash
pnpm infra convert
```

转换保留原连接目标、端口、issuer、密码和密钥，备份原文件，冲突时只报告键名并停止。新运行入口不自动导入旧 URL 配置，不读取旧配置 receipt。现有服务仍需按维护清单完成归属和数据切换后才能被新入口管理。

## 新环境的首次准备

1. 安装根 pnpm 与 Outline Yarn 依赖，填写根 `.env.local` 的数据库连接字段和原始秘密。
2. 显式 `pnpm infra init`：启动受管 PostgreSQL/Redis，只准备 Outline/Hydra 数据库并迁移；不创建 Website `exre`。
3. 显式创建独立 `exre` 及其 owner，执行 `pnpm db:migrate`。使用已有账号或通过 Website 注册账号；首次注册前可用 Server 的单独 dev 入口运行已迁移 Website。
4. 执行 `pnpm service:start`。由用户选择一个已有 active Website 用户 UUID，再执行 `pnpm infra bootstrap --admin-user-id <UUID>`。
5. 执行 `pnpm dev`。

普通启动不会迁移、reset、创建身份 client、账号或管理员；重复 bootstrap 不恢复已明确撤销的管理员权限。

## 日常命令

```bash
pnpm service:start
pnpm dev
```

全部就绪后显示网站和文档入口，默认分别为 `http://127.0.0.1:8080/` 和 `http://127.0.0.1:8080/docs/`。使用配置中的 public origin；`localhost` 与 `127.0.0.1` 的会话不互换。Ctrl+C 结束本次应用，后台依赖继续运行。

| 命令 | 职责 |
| --- | --- |
| `pnpm service:start` / `pnpm service:stop` | 启停本项目 PG/Redis/Hydra，真实就绪后 start 退出；保留卷与数据。 |
| `pnpm service:status` / `pnpm service:logs [postgres\|redis\|hydra]` | 查询实际容器状态或跟随日志；退出日志不停止服务。 |
| `pnpm dev` | 校验真实结构、marker、client，watch Website 和 Outline。 |
| `pnpm test` / `pnpm test:watch` | 顺序运行 Website、runtime/Docs 脚本与定制 Outline；不执行 Build。 |
| `pnpm build` | 构建 SDK、Website 和完整 Outline；不连接数据库、启动 Docker 或自动测试。 |
| `pnpm start` / `pnpm stop` / `pnpm logs [server\|outline\|hydra]` | PM2 原生运行、停止与查看本项目应用。 |
| `pnpm infra init` / `pnpm infra migrate` | 显式准备或迁移 Outline/Hydra。 |
| `pnpm infra bootstrap --admin-user-id <UUID>` | 核验用户明确指定的启用账号，准备文档身份。 |
| `pnpm infra nginx` | 渲染配置；操作者须独立执行 `nginx -t`，安装及重载。 |
| `pnpm db:migrate` | 仅迁移已有独立 Website `exre`。 |
| `pnpm db:reset -- --confirm exre` | 显式开发操作，清除应用数据；核对回环地址、库及对象归属。 |
| `pnpm api:lint` / `pnpm api:generate` / `pnpm typecheck` | Contract lint、生成 Client 与类型检查。 |

`--verbose` 保留详细日志并继续脱敏。数据库测试使用临时 PG18/Testcontainers，Docker 不可用明确失败，不回退开发库。

## 工程入口

`apps/server/` 是唯一 Website Fastify Server；`apps/web/` 只经 `packages/api-client/` 调用 API；`tests/contract/` 验证真实路由、原始 handler 输出及双向 operation 覆盖。Outline 不属于 pnpm workspace，Website 不接管其 API。

开发规则见 `AGENTS.md`，持久知识从 `.ai/README.md` 查阅；配置、维护和原生运行见 `docs/runtime.md`。自动测试、本机生命周期、浏览器及服务器验收分别报告。
