import { Link } from 'react-router'
import { ExIcon } from '@components/src/ExIcon'
import styles from '@components/src/Logo.module.scss'

/**
 * 站点图标与字标，图标复用带 Glass 底板的 ExIcon。
 *
 * 用 `<Link>` 而非 `<a>`：回首页是站内导航，应交给 react-router，避免整页刷新。
 * 尺寸与字重走 ExUI 的 Token，不引用参考图的量测值。
 */
export function Logo() {
  return (
    <Link to="/" className={styles.wordmark}>
      <ExIcon />
      Exre Service
    </Link>
  )
}
