import { useState } from 'react'
import {
  Avatar,
  AvatarFallback,
  ActionButton,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@exre/exui'
import styles from './AuthArea.module.scss'

/**
 * 假的登录用户。`api/openapi.yaml` 里没有任何认证 operation，
 * 因此这里只是为了让「未登录 / 已登录」两个分支都能被看到。
 */
const SESSION_USER = { name: 'Exre', initial: 'E' } as const

/**
 * 登录区：未登录渲染「登录 / 注册」，已登录渲染头像与用户菜单。
 *
 * **登录态是纯粹的前端占位。** 它的唯一作用是让两个 UI 分支都能被渲染出来，
 * 不涉及任何请求、cookie 或 Contract。接入真实认证时必须整体替换掉这个 `useState`，
 * 不要把它当作可以演进的实现。
 *
 * 「注册」暂时也只切到已登录态：没有真实的注册流程可以走。
 */
export function AuthArea() {
  const [isSignedIn, setIsSignedIn] = useState(false)

  if (!isSignedIn) {
    return (
      <>
        <ActionButton
          className={styles.authButton}
          onClick={() => {
            setIsSignedIn(true)
          }}
        >
          登录
        </ActionButton>
        <ActionButton
          className={styles.authButton}
          variant="outline"
          onClick={() => {
            setIsSignedIn(true)
          }}
        >
          注册
        </ActionButton>
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="用户菜单">
          <Avatar size="sm">
            <AvatarFallback>{SESSION_USER.initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{SESSION_USER.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>个人中心</DropdownMenuItem>
        <DropdownMenuItem>设置</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setIsSignedIn(false)
          }}
        >
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
