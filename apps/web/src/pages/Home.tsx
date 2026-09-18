import { Button } from '@exre/exui'
import styles from './Home.module.scss'

/**
 * 首页。
 *
 * 主体内容刻意留白：中间一块矩形占位、底部两个按钮占位，两者都不接任何行为。
 * 本次的范围是导航栏与页面骨架，真实内容与交互等设计确定后再填。
 *
 * 这里没有数据请求——`api/openapi.yaml` 里目前只有 `GET /health`，
 * 且该 health check 由 `main.tsx` 在开发期负责，不属于页面逻辑。
 */
export function Home() {
  return (
    <main className={styles.home}>
      <div className={styles.placeholder} aria-hidden="true" />

      <div className={styles.actions}>
        <Button type="button">主操作</Button>
        <Button type="button" variant="outline">
          次操作
        </Button>
      </div>
    </main>
  )
}
