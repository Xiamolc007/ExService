// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@exre/exui'
import { createContentStore } from '../../content/store'
import { AboutUs } from './AboutUs'
import { AboutBody } from './AboutBody'

vi.mock('../../content/about/registry', () => {
  const pages = [
    { id: 'index.mdx', url: '/aboutus', title: '关于 Exre', description: 'Intro', section: 'home', kind: 'home', hero: { headline: '共同创造', summary: 'Summary' }, introHeading: '认识我们' },
    ...['communities', 'projects', 'team', 'story', 'media'].map(section => ({ id: `${section}.mdx`, url: `/aboutus/${section}`, section, kind: 'section', title: { communities: '社区', projects: '项目', team: '团队', story: '历程', media: 'Media' }[section], description: `${section} introduction` })),
    { id: 'donations.mdx', url: '/aboutus/donations', section: 'donations', kind: 'donations', title: '捐赠', description: '捐赠信息', channels: [], donors: [] },
    { id: 'project.mdx', url: '/aboutus/projects/example-project', section: 'projects', kind: 'project', slug: 'example-project', title: '项目故事占位', description: '项目介绍', status: 'unknown', order: 0 },
    { id: 'community.mdx', url: '/aboutus/communities/example-community', section: 'communities', kind: 'community', slug: 'example-community', title: '社区故事占位', description: '社区介绍', status: 'unknown', order: 0 },
  ]
  return {
    aboutRegistry: { pages, members: [{ id: 'person.mdx', slug: 'person', title: '贡献者甲', role: '设计', summary: '介绍甲', kind: 'contributor', order: 0, links: [] }], media: [
      { id: 'song', title: '音乐甲', type: 'music', creator: '作者甲', usage: '使用背景' }, { id: 'film', title: '视频乙', type: 'video', creator: '作者乙', usage: '使用背景' },
    ], milestones: [] },
    aboutStore: createContentStore(Object.fromEntries([...pages.map(page => page.id), 'person.mdx'].map(id => [id, async () => ({ default: () => <p>{id === 'person.mdx' ? '成员甲的正文' : `正文 ${id}`}</p> })]))),
    aboutImage: (value: unknown) => value,
    aboutTarget: () => '/aboutus',
  }
})
vi.mock('@paper-design/shaders-react', () => ({ MeshGradient: () => <div /> }))
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function show(path: string) { return render(<ThemeProvider><MemoryRouter initialEntries={[path]}><AboutUs /></MemoryRouter></ThemeProvider>) }
it('shows an introduction and all six section links from the home', async () => {
  show('/aboutus')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('共同创造')
  await screen.findByText('正文 index.mdx')
  expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === '/aboutus/media')).toBe(true)
})
it('shows one text hero, seven ordered modules and six section targets without the old home navigation', async () => {
  show('/aboutus')
  await screen.findByText('正文 index.mdx')
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.queryByRole('region', { name: 'Exre 品牌' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'About 栏目' })).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'About 面包屑' })).toBeNull()
  expect(screen.queryByRole('link', { name: /向下滚动|认识 Exre|探索我们的社区/ })).toBeNull()
  expect(document.querySelector('canvas')).toBeNull()
  const grid = document.getElementById('about-content')!
  expect([...grid.children].map(child => child.getAttribute('aria-label'))).toEqual(['社区', '项目', '我们的理念', '团队', 'Media', '历程', '捐赠'])
  expect(within(grid).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/aboutus/communities', '/aboutus/projects', '/aboutus/team', '/aboutus/media', '/aboutus/story', '/aboutus/donations'])
  expect(within(screen.getByRole('article', { name: '我们的理念' })).getByText('正文 index.mdx')).toBeTruthy()
})
it('opens the donation section from its home card and keeps the section navigation active', async () => {
  show('/aboutus')
  fireEvent.click(within(screen.getByRole('article', { name: '捐赠' })).getByRole('link'))
  expect(await screen.findByRole('heading', { level: 1, name: '捐赠' })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'About 栏目' })).getByRole('link', { name: '捐赠' }).getAttribute('aria-current')).toBe('page')
  expect(await screen.findByText('正文 donations.mdx')).toBeTruthy()
  expect(screen.getByText('捐赠渠道仍在整理中。')).toBeTruthy()
  expect(screen.getByText('捐赠者信息仍在整理中。')).toBeTruthy()
})
it('focuses the home heading when navigating from a section', async () => {
  // jsdom has no document layout; supply the scroll extent used by the real restoration hook.
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(window.innerHeight * 3)
  show('/aboutus/projects')
  await screen.findByText('正文 projects.mdx')
  fireEvent.click(screen.getByRole('link', { name: '关于 Exre' }))
  await screen.findByText('正文 index.mdx')
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
})
it('keeps the legacy home hash anchored to the stories grid', async () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  try {
    show('/aboutus#about-content')
    await screen.findByText('正文 index.mdx')
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
    expect(document.getElementById('about-content')?.getAttribute('aria-label')).toBe('进一步认识 Exre')
  } finally { delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView }
})
it('places section breadcrumbs beside the section links outside the main content', () => {
  show('/aboutus/projects')
  const breadcrumb = screen.getByRole('navigation', { name: 'About 面包屑' })
  const sections = screen.getByRole('navigation', { name: 'About 栏目' })
  expect(breadcrumb.parentElement).toBe(sections.parentElement)
  expect(within(screen.getByRole('main')).queryByRole('navigation', { name: 'About 面包屑' })).toBeNull()
  expect(screen.getAllByRole('link', { name: '关于 Exre' })).toHaveLength(1)
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe('项目')
})
it.each([
  ['/aboutus/projects/example-project', '项目故事占位', '项目', '/aboutus/projects'],
  ['/aboutus/communities/example-community', '社区故事占位', '社区', '/aboutus/communities'],
])('keeps the parent link and current section when breadcrumbs are merged for %s', async (path, title, parent, parentPath) => {
  show(path)
  const breadcrumb = screen.getByRole('navigation', { name: 'About 面包屑' })
  const sectionNavigation = screen.getByRole('navigation', { name: 'About 栏目' })
  expect(breadcrumb.parentElement).toBe(sectionNavigation.parentElement)
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe(title)
  expect(within(sectionNavigation).getByRole('link', { name: parent }).getAttribute('aria-current')).toBe('location')
  const parentLink = within(breadcrumb).getByRole('link', { name: parent })
  expect(parentLink.getAttribute('href')).toBe(parentPath)
  fireEvent.click(parentLink)
  expect(await screen.findByRole('heading', { level: 1, name: parent })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'About 面包屑' }).querySelector('[aria-current="page"]')?.textContent).toBe(parent)
})
it('filters media locally and exposes a missing-source state', async () => {
  show('/aboutus/media')
  await screen.findByText('音乐甲')
  fireEvent.click(screen.getByRole('button', { name: '视频' }))
  expect(screen.queryByText('音乐甲')).toBeNull()
  expect(screen.getByText('视频乙')).toBeTruthy()
  expect(screen.getByText('来源待补充')).toBeTruthy()
})
it('opens the selected member body in a named modal', async () => {
  show('/aboutus/team')
  fireEvent.click(screen.getByRole('button', { name: /贡献者甲/ }))
  expect(await screen.findByRole('dialog', { name: '贡献者甲' })).toBeTruthy()
  expect(await screen.findByText('成员甲的正文')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '关闭成员简介' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('renders the existing not-found view for an unknown slug', () => {
  show('/aboutus/projects/no-such-project')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/404|找不到|不存在/)
})
it('offers a document reload when the browser retains a failed module import', () => {
  render(<MemoryRouter><AboutBody state={{ status: 'error' }} components={{}} retry={vi.fn()} /></MemoryRouter>)
  expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '重新加载当前页面' })).toBeTruthy()
})
