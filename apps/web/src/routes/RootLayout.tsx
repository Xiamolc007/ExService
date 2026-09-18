import { Outlet } from 'react-router'

/**
 * 唯一的布局层：目前只提供嵌套路由的挂载点。
 * 刻意不含导航、头部或任何交互 UI；有真实页面后再决定是否加入。
 */
export function RootLayout() {
  return <Outlet />
}
