import { Outlet } from 'react-router'
import { SiteHeader } from '@workspace/components'

/**
 * 唯一的布局层：提供站点顶栏与嵌套路由的挂载点。
 *
 * 布局内的路由共用同一个导航，页面切换时它不会重新挂载。
 * `*` 兜底页在布局外注册，不显示顶栏。
 */
export function RootLayout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  )
}
