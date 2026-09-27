// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { JoinPage } from './index'
import { ExMessage } from '@workspace/components'
const post = vi.hoisted(() => vi.fn())
vi.mock('../../api/client', () => ({ api: { POST: post } }))
afterEach(() => { cleanup(); post.mockReset(); vi.restoreAllMocks() })
it('preserves the three-step draft on back and submits only from confirmation', async () => {
  const user = userEvent.setup()
  vi.spyOn(ExMessage, 'info').mockReturnValue('info')
  post.mockResolvedValue({ data: { status: 'received' } })
  render(<MemoryRouter><JoinPage /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '下一步' }))
  expect(await screen.findByText('请输入有效的邮箱地址')).toBeTruthy()
  await user.type(screen.getByLabelText('邮箱'), 'Member@example.com')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await user.type(screen.getByLabelText('用户名'), '成员')
  await user.type(screen.getByLabelText('QQ 号'), '001234')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByText('member@example.com')).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '返回修改' }))
  expect((screen.getByLabelText('QQ 号') as HTMLInputElement).value).toBe('001234')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await user.click(screen.getByRole('button', { name: '提交申请' }))
  expect(post).toHaveBeenCalledExactlyOnceWith('/join/applications', { body: { email: 'member@example.com', nickname: '成员', qq: '001234' } })
  expect(await screen.findByRole('heading', { name: '申请已收到' })).toBeTruthy()
})
