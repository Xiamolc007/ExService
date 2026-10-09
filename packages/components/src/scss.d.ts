/**
 * `.module.scss` 的默认导出形状。
 *
 * 本包不依赖 `vite/client` 的类型（它是被应用打包的源码包，不是应用本身），
 * 所以需要自己声明 CSS Modules 的导出。`apps/web` 侧由 `vite/client` 提供同样的声明，
 * 两者的作用域互不重叠：本文件只在本包自己的 `tsconfig.json` 里被 include。
 */
declare module '*.module.scss' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
