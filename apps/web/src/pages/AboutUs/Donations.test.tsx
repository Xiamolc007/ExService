// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { AboutPage } from '../../content/about/types'
import { Donations } from './Donations'

vi.mock('../../content/about/registry', () => ({ aboutImage: (image: unknown) => image }))
afterEach(cleanup)
const page: Extract<AboutPage, { kind: 'donations' }> = { id: 'donations.mdx', kind: 'donations', section: 'donations', title: '捐赠', description: '介绍', url: '/aboutus/donations', channels: [], donors: [] }
it('shows honest empty states without fake channels or donor entries', () => {
  render(<Donations page={page} />)
  expect(screen.getByText('捐赠渠道仍在整理中。')).toBeTruthy()
  expect(screen.getByText('捐赠者信息仍在整理中。')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.queryByRole('listitem')).toBeNull()
})
it('renders a supplied external channel and optional QR with the real image component', () => {
  render(<Donations page={{ ...page, channels: [{ id: 'channel', name: '示例渠道', description: '渠道说明', url: 'https://example.com/support', qrCode: { src: '/qr.png', alt: '捐赠二维码', width: 200, height: 200 } }] }} />)
  const channel = screen.getByRole('article', { name: '示例渠道' })
  const link = within(channel).getByRole('link', { name: '前往示例渠道' })
  expect(link.getAttribute('href')).toBe('https://example.com/support')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(channel).getByText('渠道说明')).toBeTruthy()
  expect(within(channel).getByRole('img', { name: '捐赠二维码' })).toBeTruthy()
})
it('renders a QR-only channel without a fake payment button', () => {
  render(<Donations page={{ ...page, channels: [{ id: 'qr', name: '扫码捐赠', qrCode: { src: '/qr.png', alt: '二维码', width: 200, height: 200 } }] }} />)
  expect(screen.getByRole('img', { name: '二维码' })).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
})
it('shows donor nicknames and semantic dates as text', () => {
  render(<Donations page={{ ...page, donors: [{ id: 'first', nickname: '昵称甲', date: '2026-10-12' }, { id: 'second', nickname: '<script>消息</script>', date: '2026-10-11' }] }} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('昵称甲')).toBeTruthy()
  expect(screen.getByText('<script>消息</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('2026-10-12').getAttribute('datetime')).toBe('2026-10-12')
})
