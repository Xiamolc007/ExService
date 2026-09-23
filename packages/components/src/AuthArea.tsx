import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  ActionButton,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
} from '@exre/exui'
import styles from './AuthArea.module.scss'

export type AuthDisplayState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'unavailable'; message: string }
  | { status: 'authenticated'; nickname: string; initial: string; avatarUrl: string | null }

export interface AuthAreaProps {
  state: AuthDisplayState
  onLogin: () => void
  onRegister: () => void
  onRetry: () => void
  onLogout: () => void
  onProfile: () => void
}

export function AuthArea({ state, onLogin, onRegister, onRetry, onLogout, onProfile }: AuthAreaProps) {
  if (state.status === 'loading') {
    return <Spinner aria-label="正在恢复登录状态" />
  }

  if (state.status === 'unavailable') {
    return (
      <div className={styles.unavailable} role="status">
        <span>{state.message}</span>
        <ActionButton className={styles.authButton} variant="outline" onClick={onRetry}>
          重试
        </ActionButton>
      </div>
    )
  }

  if (state.status === 'anonymous') {
    return (
      <>
        <ActionButton className={styles.authButton} onClick={onLogin}>登录</ActionButton>
        <ActionButton className={styles.authButton} variant="outline" onClick={onRegister}>注册</ActionButton>
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="用户菜单">
          <Avatar size="sm">
            {state.avatarUrl && <AvatarImage src={state.avatarUrl} alt="" />}
            <AvatarFallback>{state.initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{state.nickname}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onProfile}>个人资料</DropdownMenuItem>
        <DropdownMenuItem>设置</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
