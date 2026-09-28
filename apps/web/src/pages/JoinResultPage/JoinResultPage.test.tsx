// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { JoinResultPage } from '@web/src/pages/JoinResultPage/index'
const post = vi.hoisted(() => vi.fn())
vi.mock('@web/src/api/client', () => ({ api: { POST: post } }))
afterEach(() => { cleanup(); post.mockReset(); vi.restoreAllMocks() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function setup() { render(<MemoryRouter><JoinResultPage /></MemoryRouter>); return userEvent.setup() }
const states = [
  ['not_found', 'apply', '未查到申请', '/join/rifling-911'], ['pending', 'wait', '待审核', null], ['approved', 'register', '已通过', '/register'],
  ['rejected', 'contact_community', '已拒绝', null], ['invitation_expired', 'contact_community', '邀请到期', null], ['registered', 'login', '已完成注册', '/login'],
] as const
it.each(states)('renders %s and only its fixed next action', async (status, nextAction, title, href) => {
  post.mockResolvedValue({ data: { status, nextAction } })
  const user = setup()
  expect(post).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('申请邮箱'), 'Member@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
  expect(post).toHaveBeenCalledExactlyOnceWith('/join/applications/query', { body: { email: 'member@example.com' } })
  if (href) expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === href)).toBe(true)
  expect(screen.queryByText('member@example.com')).toBeNull()
})
it('validates before requests and treats a missing record as a successful result', async () => {
  const user = setup()
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByText('请输入有效的邮箱地址')).toBeTruthy()
  expect(post).not.toHaveBeenCalled()
  post.mockResolvedValue({ data: { status: 'not_found', nextAction: 'apply' } })
  await user.type(screen.getByLabelText('申请邮箱'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByRole('heading', { name: '未查到申请' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
it('clears on edits during a pending request and rejects its late result after a newer query', async () => {
  const first = deferred<{ data: { status: string; nextAction: string } }>()
  post.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: { status: 'registered', nextAction: 'login' } })
  const user = setup(), input = screen.getByLabelText('申请邮箱')
  await user.type(input, 'first@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect((screen.getByRole('button', { name: '正在查询' }) as HTMLButtonElement).disabled).toBe(true)
  await user.clear(input); await user.type(input, 'second@example.com')
  expect(screen.queryByRole('heading', { name: '待审核' })).toBeNull()
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByRole('heading', { name: '已完成注册' })).toBeTruthy()
  await act(async () => { first.resolve({ data: { status: 'pending', nextAction: 'wait' } }) })
  expect(screen.queryByRole('heading', { name: '待审核' })).toBeNull()
  expect(screen.getByRole('heading', { name: '已完成注册' })).toBeTruthy()
  await user.type(input, 'x')
  expect(screen.queryByRole('heading', { name: '已完成注册' })).toBeNull()
})
it('drops a response after unmount and starts a fresh page without automatic queries', async () => {
  const first = deferred<{ data: { status: string; nextAction: string } }>()
  post.mockReturnValueOnce(first.promise)
  const user = setup()
  await user.type(screen.getByLabelText('申请邮箱'), 'first@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  cleanup(); setup()
  await act(async () => { first.resolve({ data: { status: 'pending', nextAction: 'wait' } }) })
  expect(screen.queryByRole('heading', { name: '待审核' })).toBeNull()
  expect((screen.getByLabelText('申请邮箱') as HTMLInputElement).value).toBe('')
  expect(post).toHaveBeenCalledTimes(1)
})
it('reports rate limiting and network failures with an explicit retry', async () => {
  post.mockResolvedValueOnce({ response: new Response(null, { status: 429 }) }).mockRejectedValueOnce(new Error('private error')).mockResolvedValueOnce({ data: { status: 'pending', nextAction: 'wait' } })
  const user = setup()
  await user.type(screen.getByLabelText('申请邮箱'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByText('查询过于频繁，请稍后再试')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByText('查询失败，请检查网络后重新查询')).toBeTruthy()
  expect(screen.queryByText('private error')).toBeNull()
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByRole('heading', { name: '待审核' })).toBeTruthy()
})
it('rejects mismatched or unknown states instead of building an arbitrary action link', async () => {
  post.mockResolvedValueOnce({ data: { status: 'approved', nextAction: 'https://example.com' } }).mockResolvedValueOnce({ data: { status: 'unrecognized', nextAction: 'login' } })
  const user = setup()
  await user.type(screen.getByLabelText('申请邮箱'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByText('查询失败，请检查网络后重新查询')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: '已通过' })).toBeNull()
  await user.click(screen.getByRole('button', { name: '查询结果' }))
  expect(await screen.findByText('查询失败，请检查网络后重新查询')).toBeTruthy()
})
