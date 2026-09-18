import { Link } from 'react-router'
import styles from './Logo.module.scss'

/**
 * 站点字标。
 *
 * 仓库里没有任何 logo 资源，也没有 `public/` 目录，因此首版以文本字标呈现；
 * 拿到正式 logo 文件后只需替换本组件内部。
 *
 * 用 `<Link>` 而非 `<a>`：回首页是站内导航，应交给 react-router，避免整页刷新。
 * 尺寸与字重走 ExUI 的 Token，不引用参考图的量测值。
 */
export function Logo() {
  return (
    <Link to="/" className={styles.wordmark}>
      ExWebsite
    </Link>
  )
}
