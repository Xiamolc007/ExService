// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@exre/exui'
import { createContentStore } from '../../content/store'
import { AboutUs } from './AboutUs'
import { AboutBody } from './AboutBody'

vi.mock('../../content/about/registry', () => {
  const pages = [
    { id: 'index.mdx', url: '/aboutus', title: '关于 Exre', description: 'Intro', section: 'home', kind: 'home', hero: { headline: '共同创造', summary: 'Summary' }, introHeading: '认识我们' },
    ...['communities', 'projects', 'team', 'story', 'media'].map(section => ({ id: `${section}.mdx`, url: `/aboutus/${section}`, section, kind: 'section', title: { communities: '社区', projects: '项目', team: '团队', story: '历程', media: 'Media' }[section], description: `${section} introduction` })),
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
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function show(path: string) { return render(<ThemeProvider><MemoryRouter initialEntries={[path]}><AboutUs /></MemoryRouter></ThemeProvider>) }
it('shows an introduction and all five section links from the home', async () => {
  show('/aboutus')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('共同创造')
  await screen.findByText('正文 index.mdx')
  expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === '/aboutus/media')).toBe(true)
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
