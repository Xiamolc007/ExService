import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@exre/exui'
import { Music, Video } from 'lucide-react'
import { ContentImage } from '@workspace/components'
import { aboutImage, aboutRegistry } from '../../content/about/registry'
import { RelatedContent, type OpenMember } from './AboutBody'
import styles from './AboutUs.module.scss'

export function MediaList({ openMember }: { openMember: OpenMember }) {
  const location = useLocation()
  const [selection, setSelection] = useState<{ key: string; value: 'all' | 'music' | 'video' }>({ key: location.key, value: 'all' })
  const filter = selection.key === location.key ? selection.value : 'all'
  const setFilter = (value: 'all' | 'music' | 'video') => setSelection({ key: location.key, value })
  const visible = aboutRegistry.media.filter(item => filter === 'all' || item.type === filter)
  return <section className={styles.mediaSection} aria-label="Media 目录">
    <div className={styles.filters}>{([{ value: 'all', label: '全部' }, { value: 'music', label: '音乐' }, { value: 'video', label: '视频' }] as const).map(item =>
      <Button key={item.value} variant={filter === item.value ? 'default' : 'ghost'} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</Button>)}</div>
    {!visible.length ? <div className={styles.empty}><p>{aboutRegistry.media.length ? '这个分类暂时没有条目。' : '音乐与影像资料仍在整理中。'}</p><Button variant="outline" onClick={() => setFilter('all')}>查看全部</Button></div> :
      <div className={styles.cards}>{visible.map(item => <article key={item.id} id={`media-${item.id}`} className={styles.card}>
        {item.cover ? <ContentImage image={aboutImage(item.cover)} /> : <div className={styles.cover} aria-hidden="true">{item.type === 'music' ? <Music /> : <Video />}</div>}
        <div className={styles.cardBody}><p className={styles.eyebrow}>{item.type === 'music' ? '音乐' : '视频'}</p><h2>{item.title}</h2><p>{item.creator}</p><p>{item.usage}</p>
          {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.type === 'music' ? '前往原始来源试听' : '前往原始来源观看'}</a> : <p className={styles.status}>来源待补充</p>}
          <RelatedContent related={item.related} openMember={openMember} />
        </div>
      </article>)}</div>}
  </section>
}
