import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button, Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@exre/exui'
import { ChevronDown } from 'lucide-react'
import type { AboutSection } from '../../content/about/types'
import styles from './AboutUs.module.scss'

export const sections = [
  { key: 'home', title: '概览', url: '/aboutus' }, { key: 'communities', title: '社区', url: '/aboutus/communities' },
  { key: 'projects', title: '项目', url: '/aboutus/projects' }, { key: 'team', title: '团队', url: '/aboutus/team' },
  { key: 'story', title: '历程', url: '/aboutus/story' }, { key: 'media', title: 'Media', url: '/aboutus/media' },
] as const
export function AboutNavigation({ section, url }: { section: AboutSection; url: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const location = useLocation()
  const navigating = useRef(false)
  useEffect(() => { setOpen(false) }, [location.key])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 48rem)')
    const close = () => { setOpen(false) }
    media.addEventListener('change', close)
    return () => media.removeEventListener('change', close)
  }, [])
  const links = (mobile = false) => sections.map(item => <Link key={item.key} to={item.url}
    aria-current={section === item.key ? (url === item.url ? 'page' : 'location') : undefined}
    onClick={() => { if (mobile) { navigating.current = true; setOpen(false) } }}>
    {item.title}
  </Link>)
  return <div className={styles.navigation}>
    <Link className={styles.navigationTitle} to="/aboutus">关于 Exre</Link>
    <nav className={styles.desktopNavigation} aria-label="About 栏目">{links()}</nav>
    <div className={styles.mobileNavigation}><Popover open={open} onOpenChange={value => { if (value) navigating.current = false; setOpen(value) }}>
      <PopoverTrigger asChild><Button className={styles.directoryTrigger} variant="ghost" size="sm" aria-label="打开 About 目录">{sections.find(item => item.key === section)?.title}<ChevronDown aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent align="end" className={styles.directory} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
        onCloseAutoFocus={event => { if (navigating.current) event.preventDefault() }}>
        <PopoverTitle id={`${id}-title`}>关于 Exre</PopoverTitle>
        <PopoverDescription id={`${id}-description`}>选择一个栏目继续阅读</PopoverDescription>
        <nav aria-label="About 手机目录">{links(true)}</nav>
      </PopoverContent>
    </Popover></div>
  </div>
}
