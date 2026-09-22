import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from '@exre/exui'
import { Link } from 'react-router'
import { AuthArea } from './AuthArea'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import styles from './SiteHeader.module.scss'

/**
 * 站点的 5 个导航项。
 *
 * 写死在这里而不是作为 props 传入：导航项是站点结构，不是可变配置，目前也没有
 * 第二个传入方。目标路由（`/dispatch` 等）**尚未建立**，点击会落到 `*` → `NotFound`，
 * 这是本次明确接受的代价；页面做好后只需在 `apps/web/src/App.tsx` 增加路由。
 */
const NAV_ITEMS = [
  { to: '/dispatch', label: 'Dispatch' },
  { to: '/document', label: 'Document' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/about', label: 'About Us' },
  { to: '/join', label: 'Join' },
] as const

/**
 * 站点顶栏：左侧字标、中间导航菜单、右侧主题切换与登录区。
 *
 * 挂在 `apps/web/src/routes/RootLayout.tsx`，因此所有路由（含兜底页）共用。
 *
 * 三区布局用 `1fr auto 1fr` 网格：两侧等宽才能让中间的菜单**真正居中**，
 * 而不是随左右内容宽度漂移。尺寸与颜色全部走 ExUI 的 Token。
 */
export function SiteHeader() {
  return (
    <header className={styles.header} data-site-header>
      <div className={styles.inner}>
        <div className={styles.start}>
          <Logo />
        </div>

        {/* ExUI 的 `NavigationMenu` 自身就渲染 `<nav>`（Radix 默认标签为 "Main"），
            所以这里只能是一个普通容器：再套一层 `<nav>` 会产生嵌套的导航地标。 */}
        <div className={styles.nav}>
          <NavigationMenu viewport={false} aria-label="主导航">
            <NavigationMenuList>
              {NAV_ITEMS.map(({ to, label }) => (
                <NavigationMenuItem key={to}>
                  <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
                    <Link to={to}>{label}</Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <div className={styles.end}>
          <ThemeToggle />
          <AuthArea />
        </div>
      </div>
    </header>
  )
}
