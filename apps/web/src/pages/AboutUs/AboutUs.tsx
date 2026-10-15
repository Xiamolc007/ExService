import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { ArrowUpRight, Code2, Compass, Users } from 'lucide-react'
import { ContentImage } from '@workspace/components'
import { NotFound } from '../NotFound'
import { aboutImage, aboutRegistry, aboutStore } from '../../content/about/registry'
import type { AboutPage } from '../../content/about/types'
import { useContent } from '../../content/useContent'
import { AboutNavigation } from './AboutNavigation'
import { AboutHome } from './AboutHome'
import { AboutBody, aboutMdxComponents, RelatedContent, type OpenMember } from './AboutBody'
import { MediaList } from './MediaList'
import { MemberModal } from './MemberModal'
import { useReadingPosition } from './useReadingPosition'
import styles from './AboutUs.module.scss'

const statuses = { unknown: '状态待补充', active: '活跃社区', archived: '历史记录', planned: '筹备中', concept: '构想阶段', development: '开发中', released: '已发布' }
export function AboutUs() {
  const location = useLocation()
  const canonical = location.pathname.replace(/\/+$/, '')
  const page = aboutRegistry.pages.find(item => item.url === canonical)
  if (!page) return <NotFound />
  if (canonical !== location.pathname) return <Navigate replace to={`${canonical}${location.search}${location.hash}`} />
  return <AboutPageView page={page} />
}
function AboutPageView({ page }: { page: AboutPage }) {
  const location = useLocation()
  const [selected, setSelected] = useState<{ slug: string; trigger: HTMLElement; path: string } | null>(null)
  const openMember = useCallback<OpenMember>((slug, trigger) => {
    if (aboutRegistry.members.some(member => member.slug === slug)) setSelected({ slug, trigger, path: location.pathname })
  }, [location.pathname])
  useEffect(() => { setSelected(null) }, [location.pathname])
  const components = useMemo(() => aboutMdxComponents(openMember), [openMember])
  const state = useContent(aboutStore, page.id)
  const main = useReadingPosition(state.status !== 'loading', page.title, page.description)
  const home = page.kind === 'home'
  return <div className={home ? styles.home : styles.about}>
    {!home && <AboutNavigation page={page} />}
    <main ref={main} className={home ? styles.homeMain : styles.main}>
      {page.kind === 'home' ? <AboutHome page={page} state={state} components={components} retry={state.retry} /> : <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>{page.eyebrow}</p><h1 tabIndex={-1}>{page.title}</h1>
        <p className={styles.summary}>{page.description}</p>
      </header>
      <section className={styles.reading}>
        {(page.kind === 'community' || page.kind === 'project') && <><p className={styles.status}>{statuses[page.status]}</p>{page.cover && <ContentImage image={aboutImage(page.cover)} />}</>}
        <AboutBody state={state} components={components} retry={state.retry} />
      </section>
      {page.section === 'communities' && page.kind === 'section' && <EntityList kind="community" />}
      {page.section === 'projects' && page.kind === 'section' && <EntityList kind="project" />}
      {page.section === 'team' && <TeamList openMember={openMember} />}
      {page.section === 'media' && <MediaList key={page.id} openMember={openMember} />}
      {(page.kind === 'community' || page.kind === 'project') && <div className={styles.reading}><RelatedContent related={page.related} openMember={openMember} />
        {page.kind === 'community' && page.joinUrl && (page.joinUrl.startsWith('/') ? <Link to={page.joinUrl}>了解加入方式</Link> : <a href={page.joinUrl} target="_blank" rel="noopener noreferrer">了解加入方式</a>)}
        {page.kind === 'project' && page.publicUrl && <a href={page.publicUrl} target="_blank" rel="noopener noreferrer">前往项目公开页面</a>}
      </div>}
      </>}
    </main>
    {selected && selected.path === location.pathname && <MemberModal key={selected.slug} slug={selected.slug} trigger={selected.trigger} components={components} onClose={() => setSelected(null)} />}
  </div>
}
function EntityList({ kind }: { kind: 'community' | 'project' }) {
  const items = aboutRegistry.pages.filter((page): page is Extract<AboutPage, { kind: 'community' | 'project' }> => page.kind === kind).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
  if (!items.length) return <p className={styles.empty}>内容仍在整理中。</p>
  return <div className={styles.cards}>{items.map(page => <Link key={page.id} to={page.url} className={`${styles.card} ${styles.entry}`}>
    {page.cover ? <ContentImage image={aboutImage(page.cover)} /> : <div className={styles.cover} aria-hidden="true">{kind === 'community' ? <Compass /> : <Code2 />}<span>素材待补充</span></div>}
    <div className={styles.cardBody}><h2>{page.title}<ArrowUpRight aria-hidden="true" /></h2><p>{page.description}</p><p className={styles.status}>{statuses[page.status]}</p></div>
  </Link>)}</div>
}
function TeamList({ openMember }: { openMember: OpenMember }) {
  if (!aboutRegistry.members.length) return <p className={styles.empty}>成员与贡献者资料仍在整理中。</p>
  return <div className={styles.cards}>{aboutRegistry.members.map(member => <button key={member.slug} className={`${styles.card} ${styles.member}`} onClick={event => openMember(member.slug, event.currentTarget)}>
    {member.avatar ? <ContentImage image={aboutImage(member.avatar)} /> : <div className={styles.cover} aria-hidden="true"><Users /><span>头像待补充</span></div>}
    <div className={styles.cardBody}><span className={styles.eyebrow}>{member.kind === 'member' ? '团队成员' : '贡献者'}</span><h2>{member.title}</h2><p>{member.role}</p><p>{member.summary}</p></div>
  </button>)}</div>
}
