import { Button } from '@exre/exui'
import styles from './JoinPage.module.scss'

export function CAEPJoinPage() {
  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>CAEP WON'T LAST FOREVER</h1>
        <p className={styles.subtitle}>2022.12-2026.4 - CAEP已停止运营</p>
      </div>
      <img
        className={styles.heroArtwork}
        src="/images/heros/join/caep/hero.png"
        alt="CAEP 警务主题横幅"
        draggable={false}
      />
      <Button glass size="lg" type="button" className={styles.aboutButton}>
        关于CAEP
      </Button>
    </main>
  )
}
