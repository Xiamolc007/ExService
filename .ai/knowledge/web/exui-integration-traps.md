# ExUI 的集成陷阱

**结论：`@exre/exui` 的几条契约违反了不会报错，只会静默失效；其中三条与 CSS 特异性有关，读我们自己的代码看不出来。**

_最后更新：2026-09-18_

## 已知陷阱

### 1. `style.css` 是「每个应用一次」，它已内含 Token 与字体 CSS

`@exre/exui/style.css` 指向 `dist/index.css`，其中已经包含 Token CSS（`dist/tokens/style.css` 的内容）与字体 CSS（`@fontsource-variable/outfit`）。

- 导入点固定在 `apps/web/src/main.tsx`，且必须排在 `./styles/index.scss` **之前**，应用样式才能覆盖库的默认值。
- 不得再导入 `@exre/exui/tokens/style.css` 或 `@exre/exui/tokens/font.css`——那是重复的 CSS，不会报错。
- 不得在 `packages/components` 内导入它：那是共享包，一旦被第二个入口引用就会出现第二个导入点。

### 2. `useTheme` 在 `ThemeProvider` 之外调用会抛错

这是 ExUI 的公开契约（`useTheme must be used within a ThemeProvider`），不是可选的防御。provider 挂在 `apps/web/src/main.tsx`，高于 `<BrowserRouter>`，因此所有路由都能用；但**不要**在可能没有 provider 的组件里调用它。

`ThemeProvider` 在渲染期读 `localStorage`，只能在浏览器挂载。本仓库是纯客户端 SPA（Vite，无 SSR），因此安全；将来若引入预渲染，这里会变成真实故障。

### 3. `color-scheme` 没人声明，必须由应用补

ExUI 的样式表**完全不声明** `color-scheme`；`ThemeProvider` 只做两件事——在 `documentElement` 上增删 `light` / `dark` 类（`src/components/theme-provider.tsx`）。

后果：如果应用不补，深色主题下页面是深色而原生滚动条、表单控件仍是浅色。

补法必须按同一组类选择器，且注意**特异性**：

```scss
:root { color-scheme: light; }  /* 伪类，特异性 (0,1,0) */
.dark { color-scheme: dark; }   /* 类，特异性 (0,1,0)，与 :root 相同 */
```

两者特异性相同，胜负由源码顺序决定，所以 `.dark` 必须写在 `:root` 之后。

另外，原来的 `color-scheme: light dark` 跟随**操作系统**偏好，与本应用「用户显式选择且持久化」的主题模型矛盾，已删除。

### 4. 库字体曾被应用的 `:root` 声明静默压掉

ExUI 在 `html` 上写 `font-family: var(--exui-font-family)`（`'Outfit Variable', …`）。`html` 的选择器特异性是 (0,0,1)，而 `:root` 是 (0,1,0)——**应用只要在 `:root` 上写 `font-family`，库自带的 Outfit 就永远不会生效**，且没有任何报错或可见提示。

`apps/web/src/styles/index.scss` 因此不再声明 `font-family`，字体完全交给 ExUI 的 Token。

同理需要注意：任何想在 `:root` 上覆盖的字体、行高类属性，都会压过 ExUI 写在 `html` 上的同名声明。

### 5. `NavigationMenu` 自己就渲染 `<nav>`，不要再套一层

ExUI 的 `NavigationMenu`（Radix）渲染出的是 `<nav aria-label="Main">`。把它包在自己的 `<nav>` 里会产生**嵌套的导航地标**，对辅助技术是噪音。

正确做法：外层只用一个普通容器，把中文标签直接传给 `NavigationMenu`：

```tsx
<div className={styles.nav}>
  <NavigationMenu viewport={false} aria-label="主导航">…</NavigationMenu>
</div>
```

`viewport={false}` 用于纯链接场景；有下拉内容时按需开启。

### 6. ExUI 的 `NavigationMenuLink` 用 `asChild` 接路由链接

不要写 `href`，把 react-router 的 `<Link>` 作为子元素传入，样式函数负责外观：

```tsx
<NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
  <Link to="/dispatch">Dispatch</Link>
</NavigationMenuLink>
```

### 7. 没有通用圆角 token

ExUI 有 `--exui-border-*`、`--exui-surface-*`、`--exui-text-*`、`--exui-shadow-*`、`--exui-control-*`，但**没有** `--exui-radius-*` 命名空间。圆角值分散在 `--density-control-radius` 与 `--exui-component-*-radius` 里。自定义容器需要圆角时，从这些值里取，或按 scaling rules 用 `rem`。

### 8. 按钮会自动给子图标定尺寸

`buttonVariants` 带 `[&_svg:not([class*='size-'])]:size-[var(…-icon-size)]`，所以 `lucide-react` 图标放进去不需要自己写宽高。反过来，**不要**给图标加 `size-*` 类，那会绕过这套尺寸。

### 9. 顶栏 1px 溢出：边框不计入放在内层的 `min-height`

如果内层元素设 `min-height: H`、外层只负责边框，外层实际高度是 `H + 1px`，而给页面用的「视口减去顶栏」仍按 `H` 算，页面就会多出 1px 并长出滚动条。

修法：把 `min-height` 放到**外层**并配 `box-sizing: border-box`，让边框计入这 `H`；外层同时用 `display: flex` 让内层撑满。

### 10. `Button` 没有显式的 `role` 属性

ExUI 的 `Button` 渲染 `<button>` 但**不写** `role="button"`（依赖隐式角色）。因此用 `[role="button"]` 查询它一定查不到，自动化断言要按标签名或 `data-slot` 查。`data-slot="button"` 在 `DropdownMenuTrigger asChild` 场景下会被 Radix 的 `data-slot="dropdown-menu-trigger"` 取代。

## 证据

- 已安装包内：`dist/index.css`（含 `body{background-color:var(--background);color:var(--foreground)}`、`html{font-family:var(--exui-font-family)}`）、`dist/tokens/style.css`（`:root` / `.dark` / `.pitch-black` 三个主题选择器）、`src/components/theme-provider.tsx`、`src/components/ui/{button,navigation-menu,dropdown-menu}.tsx`、`types/components/ui/*.d.ts`。
- `apps/web/src/main.tsx`、`apps/web/src/styles/index.scss`、`packages/components/src/SiteHeader.module.scss`。
- `.agents/skills/exui-usage/references/react-setup.md`、`theme-usage.md`、`icon-usage.md`、`guides/EXUI_SCALING_RULES.md`。
