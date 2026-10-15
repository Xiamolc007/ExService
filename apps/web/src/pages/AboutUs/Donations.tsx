import { ArrowUpRight } from 'lucide-react'
import { ContentImage } from '@workspace/components'
import { aboutImage } from '../../content/about/registry'
import type { AboutPage } from '../../content/about/types'
import styles from './Donations.module.scss'

export function Donations({ page }: { page: Extract<AboutPage, { kind: 'donations' }> }) {
  return <div className={styles.donations}>
    <section aria-labelledby="donation-channels">
      <h2 id="donation-channels">捐赠渠道</h2>
      {!page.channels.length ? <p className={styles.empty}>捐赠渠道仍在整理中。</p> : <div className={styles.channels}>
        {page.channels.map(channel => <article key={channel.id} className={styles.channel} aria-label={channel.name}>
          <h3>{channel.name}</h3>{channel.description && <p className={styles.description}>{channel.description}</p>}
          {channel.qrCode && <div className={styles.qr}><ContentImage image={aboutImage(channel.qrCode)} /></div>}
          {channel.url && <a className={styles.entry} href={channel.url} target="_blank" rel="noopener noreferrer">前往{channel.name}<ArrowUpRight aria-hidden="true" /></a>}
        </article>)}
      </div>}
    </section>
    <section aria-labelledby="donation-donors">
      <h2 id="donation-donors">捐赠者</h2>
      {!page.donors.length ? <p className={styles.empty}>捐赠者信息仍在整理中。</p> : <ul className={styles.donors}>
        {page.donors.map(donor => <li key={donor.id}><span className={styles.nickname}>{donor.nickname}</span><time dateTime={donor.date}>{donor.date}</time></li>)}
      </ul>}
    </section>
  </div>
}
