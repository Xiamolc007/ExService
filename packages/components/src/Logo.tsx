import { Link } from 'react-router'
import styles from './Logo.module.scss'

/**
 * 站点图标与字标，图标通过 CSS 遮罩跟随文字的主题颜色。
 *
 * 用 `<Link>` 而非 `<a>`：回首页是站内导航，应交给 react-router，避免整页刷新。
 * 尺寸与字重走 ExUI 的 Token，不引用参考图的量测值。
 */
export function Logo() {
  return (
    <Link to="/" className={styles.wordmark}>
      <span className={styles.icon} aria-hidden="true" />
      ExWebsite
    </Link>
  )
}
