import { Outlet } from 'react-router'
import { SiteHeader } from '@workspace/components'

/**
 * 唯一的布局层：提供站点顶栏与嵌套路由的挂载点。
 *
 * 顶栏放在这里而不是各页面里，因此所有路由（含 `*` 兜底页）共用同一个导航，
 * 且页面切换时它不会重新挂载。
 */
export function RootLayout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  )
}
