# 共享 UI 组件放在独立工作区包，而不是 app 内部目录

- 状态：共享 UI 包边界继续适用；与旧 Client 形态对齐的背景已被取代
- 模块：`components`
- 日期：2026-09-18
- 来源：`packages/components/package.json`、`packages/components/src/index.ts` 的共享包实现

_最后更新：2026-10-19_

## 当前适用范围

`packages/components/` 仍以源码形式导出且没有独立构建步骤。以下正文中用 `packages/api-client/` 作为同级包和形态来源的描述保留为历史；该包已退役，不能据此推断 SDK 也源码导出。`packages/sdk/` 的当前构建与条件入口见 `.ai/architectures/sdk/client-boundaries.md`。

## 背景

站点顶栏的使用者是「所有页面」。`apps/web` 内部可以有一个 `components/` 目录，但它不构成强制边界——任何页面代码都能绕开它，`AGENTS.md` 的目录边界表也没有可以写禁止项的位置。顶栏是从「脚手架就绪提示」走向真实页面的第一个跨页面 UI。

## 决策

- 新建工作区包 `packages/components`，包名 `@workspace/components`，与 `packages/api-client` 同级。
- 包定位是**应用级共享组件**（承载站点语义，如 `SiteHeader`），不是原子化设计系统。
- 形态对齐 `packages/api-client`：源码形式导出（`exports` 直接指向 `src/index.ts`）、无构建步骤、自带 `tsconfig.json` 与 `typecheck` 脚本。
- 公开面由 `packages/components/src/index.ts` 管理，包含站点顶栏及认证、资料、加入流程所需的共享组件。
- 依赖边界：`react` / `react-dom` / `react-router` 同时是 `peerDependencies` 与 `devDependencies`；`@exre/exui` 与 `lucide-react` 是普通 `dependencies`。
- 样式用 CSS Modules，包内自带一个 `.module.scss` 的类型声明文件。

## 理由

- 放进 `packages/` 后，「这个包不能做什么」才有地方可写，边界才是可执行的而不是靠自觉。
- 不做原子化设计系统，是因为目前只有一个消费者，先做 `Button` / `Stack` 这类原语会产出一批没有第二个使用者的抽象；而 ExUI 本身已经提供了这一层。
- `react-router` 必须是 peer：`<Link>` 依赖路由 context，包内出现第二份 `react-router` 实例就拿不到 context。
- CSS Modules 而不是全局类名，是因为共享包的全局选择器一旦与消费方撞名会静默互相覆盖。代价是需要自己声明 `.module.scss` 的导出形状——本包不是应用，没有 `vite/client` 的类型。

## 影响

- 新增或修改跨页面 UI 时，改动点在这个包，`apps/web` 只负责把它挂到布局里。
- `pnpm-workspace.yaml` 已是 `packages/*`，新包自动纳入，不需要改工作区配置；`pnpm typecheck` 会自动带上它。
- `packages/components/src/` 已有组件及交互测试；变更共享 UI 时按受影响组件运行测试，并结合 typecheck、build 与必要的浏览器验证。
- `apps/web` 的 `tsc` 会跟随 import 进入本包源码，因此本包内部的类型错误会同时让 `apps/web` 的 typecheck 失败。

## 重新审视的条件

- 出现第二个消费方（例如后台应用），需要重新评估公开面与是否补构建产物。
- 需要在不引入打包器的环境下使用本包时——源码形式导出依赖消费方解析 `@components` 别名，Node ESM 不直接识别。
- 新的共享交互超出现有组件测试覆盖时，补充相应行为验证并复核浏览器中的 provider 与路由 context。

## 证据

- `packages/components/package.json`、`packages/components/tsconfig.json`、`packages/components/src/index.ts`、`packages/components/src/scss.d.ts`。
- `packages/api-client/package.json`（被对齐的形态来源）。
- `pnpm-workspace.yaml` 的 `packages/*`。
- `AGENTS.md` 目录边界表中的 `packages/components/` 行；`packages/components/src/SiteHeader.test.tsx` 等组件测试。
