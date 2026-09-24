import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
  SelectContent,
  SelectField,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@exre/exui'
import { Menu, UserRound } from 'lucide-react'
import type { Ref } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { AuthArea, type AuthAreaProps } from './AuthArea'
import { Logo } from './Logo'
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
 * 站点顶栏：桌面端左侧字标、中间导航菜单、右侧登录区；手机端左侧导航
 * Select、中间字标、右侧账号 Select。
 *
 * 挂在 `apps/web/src/routes/RootLayout.tsx`，因此所有路由（含兜底页）共用。
 *
 * 三区布局用 `1fr auto 1fr` 网格：两侧等宽才能让中间的菜单**真正居中**，
 * 而不是随左右内容宽度漂移。尺寸与颜色全部走 ExUI 的 Token。
 */
export interface SiteHeaderProps {
  auth: AuthAreaProps
  mobileMenuButtonRef?: Ref<HTMLSpanElement>
}

export function SiteHeader({ auth, mobileMenuButtonRef }: SiteHeaderProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedNavigation = NAV_ITEMS.some(({ to }) => to === location.pathname)
    ? location.pathname : ''

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
          <AuthArea {...auth} />
        </div>

        <div className={styles.mobileNav}>
          <SelectField value={selectedNavigation} onValueChange={(value) => {
            if (NAV_ITEMS.some(({ to }) => to === value)) navigate(value)
          }}>
            <SelectTrigger className={styles.mobileNavTrigger} aria-label="打开导航菜单">
              <Menu aria-hidden="true" />
              <SelectValue placeholder="导航菜单" />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectGroup>
                <SelectLabel>导航</SelectLabel>
                {NAV_ITEMS.map(({ to, label }) =>
                  <SelectItem key={to} value={to}>{label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </SelectField>
        </div>

        <div className={styles.mobileAccount}>
          <MobileAccountSelect auth={auth} triggerRef={mobileMenuButtonRef} />
        </div>
      </div>
    </header>
  )
}

function MobileAccountSelect({ auth, triggerRef }: {
  auth: AuthAreaProps
  triggerRef?: Ref<HTMLSpanElement>
}) {
  if (auth.state.status === 'loading') {
    return <Spinner aria-label="正在恢复登录状态" />
  }

  const selectAccountItem = (value: string) => {
    if (value === 'login') auth.onLogin()
    else if (value === 'register') auth.onRegister()
    else if (value === 'retry') auth.onRetry()
    else if (value === 'profile') auth.onProfile()
    else if (value === 'settings') auth.onSettings()
    else if (value === 'logout') auth.onLogout()
  }

  return <SelectField value="" onValueChange={selectAccountItem}>
    <span ref={triggerRef}>
      <SelectTrigger className={`${styles.mobileAccountTrigger} ${auth.state.status === 'authenticated'
        ? styles.mobileAvatarTrigger : ''}`} aria-label="用户菜单">
        {auth.state.status === 'authenticated' ? <Avatar size="sm" className={styles.mobileAvatar}>
          {auth.state.avatarUrl && <AvatarImage src={auth.state.avatarUrl} alt="" />}
          <AvatarFallback>{auth.state.initial}</AvatarFallback>
        </Avatar> : <UserRound aria-hidden="true" />}
        <SelectValue placeholder="用户菜单" />
      </SelectTrigger>
    </span>
    <SelectContent position="popper" align="end">
      <SelectGroup>
        <SelectLabel>{auth.state.status === 'authenticated' ? auth.state.nickname : '账号'}</SelectLabel>
        {auth.state.status === 'anonymous' && <>
          <SelectItem value="login">登录</SelectItem>
          <SelectItem value="register">注册</SelectItem>
        </>}
        {auth.state.status === 'authenticated' && <>
          <SelectItem value="profile">个人资料</SelectItem>
          <SelectItem value="settings">设置</SelectItem>
          <SelectItem value="logout">退出登录</SelectItem>
        </>}
        {auth.state.status === 'unavailable' &&
          <SelectItem value="retry">重试登录状态</SelectItem>}
      </SelectGroup>
    </SelectContent>
  </SelectField>
}
