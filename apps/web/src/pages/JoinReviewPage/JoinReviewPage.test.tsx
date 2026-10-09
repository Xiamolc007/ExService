// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExMessage, ExMessageContext } from '@exre/exui'
import { JoinReviewPage } from '@web/src/pages/JoinReviewPage/index'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import type { components } from '@workspace/api-client'
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@web/src/api/client', () => ({ api: { GET: get, POST: post } }))
const application: components['schemas']['JoinApplicationSummary'] = { id: 'a', email: 'member@example.com', nickname: '成员', qq: '001234', status: 'pending', createdAt: 1000, reviewedAt: null, reviewedByUserId: null, invitationStatus: null, deliveryStatus: null, applicationType: 'legacy' }
afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
const listOf = (items = [application], offset = 0, total = items.length) => ({ items, offset, total, limit: 20, serverTime: 1000 })
const detailOf = (item = application) => ({ application: item, invitation: null, serverTime: 1000, formVersion: 0, form: null, attachments: [] })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
it('shows approval feedback through the ExUI message host', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  post.mockResolvedValue(detailOf({ ...application, status: 'approved' }))
  render(<><ExMessageContext /><JoinReviewPage /></>)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '同意并发送邀请' }))
  expect(await screen.findByText('审核与邀请状态已更新')).toBeTruthy()
})

it('opens fresh detail in two tabs and restores focus without changing the list filter', async () => {
  const user = userEvent.setup()
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  render(<JoinReviewPage />)
  const trigger = await screen.findByRole('button', { name: '查看 成员' })
  await user.click(trigger)
  expect(await screen.findByRole('dialog', { name: '申请详情' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: '申请资料' }).getAttribute('aria-selected')).toBe('true')
  await user.click(screen.getByRole('tab', { name: '审核与邀请' }))
  expect(screen.getByText('审核人').nextElementSibling?.textContent).toBe('未记录')
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  expect(document.activeElement).toBe(trigger)
  await user.click(trigger)
  expect(get.mock.calls.filter(([path]) => path.endsWith('{applicationId}'))).toHaveLength(2)
})

it('resets pagination when filtering and rejects a late page response', async () => {
  const user = userEvent.setup(), late = deferred<ReturnType<typeof listOf>>()
  get.mockResolvedValueOnce(listOf([application], 0, 21)).mockReturnValueOnce(late.promise).mockResolvedValueOnce(listOf([{ ...application, id: 'b', nickname: '新成员' }], 0, 1))
  render(<JoinReviewPage />)
  await screen.findByRole('button', { name: '查看 成员' })
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(get).toHaveBeenLastCalledWith('/admin/join/applications', { params: { query: { view: 'pending', offset: '20', limit: '20' } }, alert: false })
  await user.click(screen.getByRole('tab', { name: '全部申请' }))
  expect(await screen.findByRole('button', { name: '查看 新成员' })).toBeTruthy()
  expect(get).toHaveBeenLastCalledWith('/admin/join/applications', { params: { query: { view: 'all', offset: '0', limit: '20' } }, alert: false })
  await act(async () => { late.resolve(listOf([{ ...application, nickname: '过时成员' }], 20, 21)) })
  expect(screen.queryByRole('button', { name: '查看 过时成员' })).toBeNull()
  expect(screen.getByText('第 1 页，共 1 条')).toBeTruthy()
})

it('ignores a closed detail response and opens fresh detail for another selection', async () => {
  const user = userEvent.setup(), late = deferred<ReturnType<typeof detailOf>>()
  get.mockResolvedValueOnce(listOf([application, { ...application, id: 'b', nickname: '另一成员' }])).mockReturnValueOnce(late.promise).mockResolvedValueOnce(detailOf({ ...application, id: 'b', nickname: '另一成员' }))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await user.click(screen.getByRole('button', { name: '查看 另一成员' }))
  await waitFor(() => expect(screen.getByText('用户名').nextElementSibling?.textContent).toBe('另一成员'))
  await act(async () => { late.resolve(detailOf(application)) })
  expect(screen.getByText('用户名').nextElementSibling?.textContent).toBe('另一成员')
})

it('keeps a submitted approval running after close and refreshes the list without a late toast', async () => {
  const user = userEvent.setup(), next = deferred<ReturnType<typeof detailOf>>(), notify = vi.spyOn(ExMessage, 'info').mockReturnValue('info')
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  post.mockReturnValue(next.promise)
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '同意并发送邀请' }))
  expect((screen.getByRole('button', { name: '拒绝申请' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await act(async () => { next.resolve(detailOf({ ...application, status: 'approved' })) })
  expect(post).toHaveBeenCalledExactlyOnceWith('/admin/join/applications/{applicationId}/approve', { params: { path: { applicationId: 'a' } }, body: {}, alert: false })
  expect(get.mock.calls.filter(([path]) => path === '/admin/join/applications')).toHaveLength(2)
  expect(notify).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('restores focus to refresh when approval removes the original pending row', async () => {
  const user = userEvent.setup()
  vi.spyOn(ExMessage, 'info').mockReturnValue('info')
  get.mockResolvedValueOnce(listOf()).mockResolvedValueOnce(detailOf()).mockResolvedValueOnce(listOf([]))
  post.mockResolvedValue(detailOf({ ...application, status: 'approved' }))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '同意并发送邀请' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看 成员', hidden: true })).toBeNull())
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '刷新列表' }))
})

it('refreshes conflicted detail and presents delivery failure without changing approval facts', async () => {
  const user = userEvent.setup()
  const approved = { ...application, status: 'approved' as const, deliveryStatus: 'failed' as const }
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  post.mockRejectedValue(new ExAxiosError('http', 'JOIN_STATE_CONFLICT', 'safe', { status: 409 }))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await screen.findByRole('button', { name: '同意并发送邀请' })
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? { ...detailOf(approved), invitation: { status: 'active', resendAvailableAt: 1000, expiresAt: 100000, latestDelivery: { status: 'failed' } } } : listOf([])))
  await user.click(screen.getByRole('button', { name: '拒绝申请' }))
  await user.click(screen.getByRole('tab', { name: '审核与邀请' }))
  expect(await screen.findByText('邀请投递失败，审批已保留。冷却结束后可重新发送。')).toBeTruthy()
  expect(screen.getByText('审核状态').nextElementSibling?.textContent).toBe('已同意')
  expect(screen.getByRole('button', { name: '重新发送邀请' })).toBeTruthy()
  expect(get.mock.calls.filter(([path]) => path.endsWith('{applicationId}'))).toHaveLength(2)
})

it('retains pending approval on inherited cooldown 429 and enables retry after the header interval', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const user = userEvent.setup()
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  post.mockRejectedValue(new ExAxiosError('http', 'CODE_RESEND_TOO_SOON', 'safe', { status: 429, retryAfterSeconds: 2 }))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '同意并发送邀请' }))
  expect((screen.getByRole('button', { name: '2 秒后同意' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '拒绝申请' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => { vi.advanceTimersByTime(3000) })
  expect((screen.getByRole('button', { name: '同意并发送邀请' }) as HTMLButtonElement).disabled).toBe(false)
  expect(post).toHaveBeenCalledTimes(1)
})

const newForm: components['schemas']['JoinNewForm'] = {
  applicationType: 'new', birthDate: '2000-01-01', applicantCategory: '102b', department: 'ems', freeTime: '周末晚上', discoveryChannels: ['bilibili', 'friends'],
  answers: { fiveMExperience: '没有接触过', emergencyRoleplayKnowledge: '了解紧急职业', emergencyProceduresKnowledge: '流程说明\n第二行', rpUnderstanding: '角色扮演', frpUnderstanding: '失败角色扮演' },
  commitments: { informationAccurate: true, obeyCommunityRules: true, acceptAcademyAttendanceConsequences: true },
}
const experiencedForm: components['schemas']['JoinExperiencedForm'] = {
  ...newForm, applicationType: 'experienced',
  answers: { previousServer: '以前服务器', leaveReason: '离开原因全文', previousDepartment: '以前巡逻部门', lawEnforcementExperience: '执法生涯全文', highestRank: '警长', punishmentHistory: '无处罚', deescalationEssay: '武力降级'.repeat(40), discretionEssay: '自由裁量'.repeat(40), transferReason: '调转原因全文' },
  commitments: { informationAccurate: true },
}
const attachment = { id: 'proof-id', originalName: '证明资料.svg', extension: 'svg', byteLength: 20, sha256: 'a'.repeat(64), ordinal: 0 }
it.each([newForm, experiencedForm])('shows every full $applicationType answer and only its commitments as text', async form => {
  const user = userEvent.setup()
  const detail = { ...detailOf(), application: { ...application, applicationType: form.applicationType }, formVersion: 1, form, attachments: Array.from({ length: 5 }, (_, index) => ({ ...attachment, id: `proof-${index}`, originalName: `附件${index}.txt`, ordinal: index })) }
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detail : listOf([detail.application])))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  expect(await screen.findByText('曾任其他服务器技术')).toBeTruthy()
  expect(screen.getByText('医疗和消防部门')).toBeTruthy()
  expect(screen.getByText('B站、朋友介绍')).toBeTruthy()
  expect(screen.getByText('周末晚上')).toBeTruthy()
  for (const answer of Object.values(form.answers)) expect(screen.getByText(answer, { exact: true, normalizer: value => value })).toBeTruthy()
  expect(screen.getAllByText('已确认')).toHaveLength(form.applicationType === 'new' ? 3 : 1)
  expect(screen.getAllByRole('button', { name: /^下载 附件/ })).toHaveLength(5)
  expect(document.querySelector('iframe, img, object, embed')).toBeNull()
})
it('marks legacy details without inventing answers or commitments', async () => {
  const user = userEvent.setup()
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{applicationId}') ? detailOf() : listOf()))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  expect(await screen.findByText('历史简版申请：仅保留当时提交的联系资料，没有完整回答、附件或承诺记录。')).toBeTruthy()
  expect(screen.queryByText('已确认')).toBeNull()
  expect(screen.queryByText('出生日期')).toBeNull()
})
it('downloads through the declared blob operation and releases the temporary URL without preview', async () => {
  const user = userEvent.setup(), create = vi.fn(() => 'blob:temporary-proof'), revoke = vi.fn(), click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke })
  const blob = new Blob(['<svg></svg>'], { type: 'application/octet-stream' })
  const detail = { ...detailOf(), application: { ...application, applicationType: 'experienced' as const }, formVersion: 1, form: experiencedForm, attachments: [attachment] }
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{attachmentId}') ? blob : path.endsWith('{applicationId}') ? detail : listOf([detail.application])))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '下载 证明资料.svg' }))
  expect(get).toHaveBeenLastCalledWith('/admin/join/applications/{applicationId}/attachments/{attachmentId}', { params: { path: { applicationId: 'a', attachmentId: 'proof-id' } }, responseType: 'blob', alert: false })
  expect(create).toHaveBeenCalledExactlyOnceWith(blob)
  expect(click).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:temporary-proof'))
  expect(document.querySelector('a[download], iframe, img, object, embed')).toBeNull()
})
it('keeps attachment failures retryable and ignores a response after closing detail', async () => {
  const user = userEvent.setup(), late = deferred<Blob>(), create = vi.fn(() => 'blob:late')
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = vi.fn() })
  const detail = { ...detailOf(), application: { ...application, applicationType: 'experienced' as const }, formVersion: 1, form: experiencedForm, attachments: [attachment] }
  get.mockImplementation((path: string) => path.endsWith('{attachmentId}') ? Promise.reject(new ExAxiosError('http', 'HTTP_ERROR', '请求失败', { status: 503 })) : Promise.resolve(path.endsWith('{applicationId}') ? detail : listOf([detail.application])))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  await user.click(await screen.findByRole('button', { name: '下载 证明资料.svg' }))
  expect(await screen.findByText('当前下载繁忙，请稍后重试')).toBeTruthy()
  get.mockImplementation((path: string) => path.endsWith('{attachmentId}') ? late.promise : Promise.resolve(path.endsWith('{applicationId}') ? detail : listOf([detail.application])))
  await user.click(screen.getByRole('button', { name: '下载 证明资料.svg' }))
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await act(async () => { late.resolve(new Blob(['late'])) })
  expect(create).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('renders list and detail request errors and permits explicit reloads', async () => {
  const user = userEvent.setup()
  get.mockRejectedValueOnce(new Error('internal detail')).mockResolvedValueOnce(listOf()).mockRejectedValueOnce(new Error('internal path')).mockResolvedValueOnce(detailOf())
  render(<JoinReviewPage />)
  expect(await screen.findByText('无法加载申请列表，请重试')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '重试加载' }))
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  expect(await screen.findByText('无法加载申请详情，请重试')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '刷新详情' }))
  expect(await screen.findByText('历史简版申请：仅保留当时提交的联系资料，没有完整回答、附件或承诺记录。')).toBeTruthy()
  expect(screen.queryByText('internal path')).toBeNull()
})
it('releases a scheduled download URL when the page unmounts before its cleanup timer', async () => {
  const user = userEvent.setup({ delay: null }), create = vi.fn(() => 'blob:unmount-proof'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static override createObjectURL = create; static override revokeObjectURL = revoke })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const detail = { ...detailOf(), application: { ...application, applicationType: 'experienced' as const }, formVersion: 1, form: experiencedForm, attachments: [attachment] }
  get.mockImplementation((path: string) => Promise.resolve(path.endsWith('{attachmentId}') ? new Blob(['proof']) : path.endsWith('{applicationId}') ? detail : listOf([detail.application])))
  render(<JoinReviewPage />)
  await user.click(await screen.findByRole('button', { name: '查看 成员' }))
  const button = await screen.findByRole('button', { name: '下载 证明资料.svg' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await act(async () => { fireEvent.click(button); await Promise.resolve() })
  expect(create).toHaveBeenCalledTimes(1)
  expect(revoke).not.toHaveBeenCalled()
  cleanup()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:unmount-proof')
  await act(async () => { vi.runAllTimers() })
  expect(revoke).toHaveBeenCalledTimes(1)
})
