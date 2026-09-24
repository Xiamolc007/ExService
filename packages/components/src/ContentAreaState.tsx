import type { ReactNode } from 'react'
import { Alert, AlertDescription, Button, Skeleton } from '@exre/exui'
import styles from './ContentAreaState.module.scss'

export type ContentAreaStateProps =
  | { status: 'loading'; skeleton: ReactNode }
  | { status: 'error'; errorMessage: string; onRetry: () => void }
  | { status: 'ready'; children: ReactNode }

export function ContentAreaState(props: ContentAreaStateProps) {
  if (props.status === 'loading') {
    return <div className={styles.area} role="status" aria-label="正在加载">
      <span className={styles.visuallyHidden}>正在加载</span>{props.skeleton}
    </div>
  }
  if (props.status === 'error') {
    return <div className={`${styles.area} ${styles.error}`}>
      <Alert variant="destructive" role="alert"><AlertDescription>{props.errorMessage}</AlertDescription></Alert>
      <Button type="button" onClick={props.onRetry}>重试</Button>
    </div>
  }
  return <div className={styles.area}>{props.children}</div>
}

export function SettingsContentSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true">
    <Skeleton className={styles.title} />
    <Skeleton className={styles.card} />
    <Skeleton className={styles.card} />
  </div>
}
