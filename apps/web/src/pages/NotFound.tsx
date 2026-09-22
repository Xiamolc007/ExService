import { Button, Card, useTheme } from '@exre/exui'
import { exuiTokens } from '@exre/exui/tokens'
import { useSyncExternalStore } from 'react'
import { SimplexNoise } from '@paper-design/shaders-react'
import { Link } from 'react-router'
import styles from './NotFound.module.scss'

const backgroundColors = {
  dark: [
    exuiTokens.themes.dark.control.primary,
    exuiTokens.themes.dark.surface.background,
    exuiTokens.themes.dark.surface.secondary,
  ],
  light: [
    exuiTokens.themes.light.control.primary,
    exuiTokens.themes.light.surface.background,
    exuiTokens.themes.light.surface.secondary,
  ],
}

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function isSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 未匹配路径的兜底页面。
 * 它不能替代 Mock Server 的 404 envelope —— 这里只处理前端路由，不发起任何 API 请求。
 */
export function NotFound() {
  const { theme } = useTheme()
  const systemDark = useSyncExternalStore(subscribeSystemTheme, isSystemDark)
  const dark = theme === 'dark' || (theme === 'system' && systemDark)

  return (
    <main className={styles.page} aria-labelledby="not-found-title">
      <div className={styles.background} aria-hidden="true">
        <SimplexNoise
          width={1280}
          height={720}
          colors={backgroundColors[dark ? 'dark' : 'light']}
          stepsPerColor={1}
          scale={4}
          softness={0.02}
          speed={0.2}
        />
      </div>
      <section className={styles.frame}>
        <Card glass className={styles.content}>
          <img className={styles.logo} src="/ExIcon.svg" alt="Ex" width="160" height="160" draggable={false} />
          <h1 id="not-found-title" className={styles.code}>404</h1>
          <p className={styles.description}>Page not found</p>
          <Button asChild className={styles.homeLink}>
            <Link to="/">返回首页</Link>
          </Button>
        </Card>
      </section>
    </main>
  )
}
