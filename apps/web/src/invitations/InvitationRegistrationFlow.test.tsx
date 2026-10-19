// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { ExMessage } from '@exre/exui'
import { InvitationRegistrationFlow } from '@web/src/invitations/InvitationRegistrationFlow'
import { ExAxiosError } from '@workspace/sdk/http/browser'

const { post, captchaPost } = vi.hoisted(() => ({ post: vi.fn(), captchaPost: vi.fn() }))
vi.mock('@web/src/api/client', async importOriginal => {
  const original = await importOriginal<typeof import('@web/src/api/client')>()
  return { ...original, api: { POST: (path: string, options: unknown) =>
    path === '/auth/captcha/challenges' ? captchaPost(options) : post(path, options) } }
})
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', TestResizeObserver)
Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })

afterEach(() => { cleanup(); post.mockReset(); captchaPost.mockReset(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })
beforeEach(() => {
  vi.spyOn(ExMessage, 'info').mockReturnValue('info'); vi.spyOn(ExMessage, 'error').mockReturnValue('error')
  captchaPost.mockRejectedValue(new Error('captcha unavailable'))
})

const sent = { status: 'accepted', serverTime: 1792368000, resendAvailableAt: 1792368000 }
const verified = { status: 'verified', email: 'member@example.com', nickname: '成员', completionToken: 't'.repeat(43), serverTime: 1792368000, completionExpiresAt: 1792368600 }
const envelope = <T,>(data: T) => ({ msg: 'ok', data })
function failure(status: number, retryAfter?: string) { return new ExAxiosError('http', 'HTTP_ERROR', 'private stack', { status, retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined }) }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
async function enterCode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  return screen.findByLabelText('6 位验证码') as Promise<HTMLInputElement>
}
function Location() { const location = useLocation(); return <output aria-label="导航结果">{location.pathname}:{(location.state as { email?: string } | null)?.email ?? ''}</output> }

it.each(['modal', 'page'] as const)('sends a normalized email without checking invitation eligibility for %s', async presentation => {
  const user = userEvent.setup(), next = deferred<ReturnType<typeof envelope<typeof sent>>>()
  post.mockReturnValueOnce(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="MEMBER@EXAMPLE.COM" /></MemoryRouter>)
  expect(post).not.toHaveBeenCalled()
  expect(screen.queryByText(/申请获批/)).toBeNull()
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(post).toHaveBeenCalledExactlyOnceWith('/auth/invitations/code', { body: { email: 'member@example.com' }, alert: false })
  expect(screen.queryByLabelText('6 位验证码')).toBeNull()
  await act(async () => { next.resolve(envelope({ ...sent, resendAvailableAt: sent.serverTime + 60 })) })
  expect((await screen.findByLabelText('6 位验证码') as HTMLInputElement).value).toBe('')
  expect(screen.getByText('member@example.com')).toBeTruthy()
  expect((screen.getByRole('button', { name: '60 秒后重发' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByLabelText('密码')).toBeNull()
})

it.each(['', 'not-an-email'])('does not request a code for invalid email %s', async initialEmail => {
  const user = userEvent.setup()
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail={initialEmail} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findByText('请输入有效的邮箱地址')).toBeTruthy()
  expect(post).not.toHaveBeenCalled()
})

it('sanitizes the URL code and verifies it directly once under StrictMode', async () => {
  const next = deferred<ReturnType<typeof envelope<typeof verified>>>()
  window.history.replaceState({ key: 'keep', usr: { other: true } }, '', '/register?email=member%40example.com&code=001234')
  post.mockReturnValueOnce(next.promise)
  render(<StrictMode><MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter></StrictMode>)
  expect(window.location.search).toBe('?email=member%40example.com')
  expect(window.history.state).toEqual({ key: 'keep', usr: { other: true } })
  expect(post).toHaveBeenCalledExactlyOnceWith('/auth/invitations/verify', { body: { email: 'member@example.com', code: '001234' }, alert: false })
  await act(async () => { next.resolve(envelope(verified)) })
  expect(await screen.findByRole('heading', { name: '完善账号' })).toBeTruthy()
  expect(post).toHaveBeenCalledTimes(1)
})

it.each([
  '?code=001234', '?email=bad&code=001234', '?email=member@example.com&email=other@example.com&code=001234', '?email=member@example.com&code=001234&code=654321', '?email=member@example.com&code=bad',
])('clears malformed entry %s without requesting', search => {
  window.history.replaceState({ key: 'keep' }, '', `/register${search}`)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter>)
  expect(new URLSearchParams(window.location.search).has('code')).toBe(false)
  expect(screen.getByText('注册入口参数无效，请重新填写邮箱')).toBeTruthy()
  expect(post).not.toHaveBeenCalled()
})

it('prefills a legal URL email and waits for an explicit send', () => {
  window.history.replaceState(null, '', '/register?email=member@example.com')
  render(<MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter>)
  expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('member@example.com')
  expect(post).not.toHaveBeenCalled()
})

const sendCases = [
  { status: 400, message: '请输入有效的邮箱地址', panel: false },
  { status: 409, message: '该邮箱已注册，请直接登录', panel: false },
  { status: 429, retryAfter: '2', message: '发送失败，请在 2 秒后重试', panel: true },
  { status: 500, message: '发送失败，请重试', panel: true },
  { status: undefined, message: '发送失败，请重试', panel: true },
]
for (const presentation of ['page', 'modal'] as const) {
  it.each(sendCases)(`shows a ${presentation} send failure for $status in the email form`, async ({ status, retryAfter, message, panel }) => {
    const user = userEvent.setup()
    post.mockRejectedValue(status === undefined ? new Error('private stack') : failure(status, retryAfter))
    render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="member@example.com" /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findAllByText(message)).toHaveLength(1)
    expect(screen.queryAllByRole('region')).toHaveLength(panel ? 1 : 0)
    expect(screen.queryByLabelText('6 位验证码')).toBeNull()
    expect(screen.queryByText('private stack')).toBeNull()
    expect(screen.getByLabelText('邮箱').getAttribute('aria-invalid')).toBe(panel ? 'false' : 'true')
    await user.type(screen.getByLabelText('邮箱'), 'x')
    expect(screen.queryByText(message)).toBeNull()
    expect(ExMessage.error).not.toHaveBeenCalled()
  })
}

it.each(['page', 'modal'] as const)('keeps a registered email in the %s email step and allows correcting it', async presentation => {
  const user = userEvent.setup()
  post.mockRejectedValueOnce(failure(409)).mockResolvedValueOnce(envelope(sent))
  render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="member@example.com" /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findByText('该邮箱已注册，请直接登录')).toBeTruthy()
  expect(screen.queryByLabelText('6 位验证码')).toBeNull()
  expect(captchaPost).not.toHaveBeenCalled()
  const email = screen.getByLabelText('邮箱') as HTMLInputElement
  expect(email.value).toBe('member@example.com')
  await user.clear(email)
  await user.type(email, 'new@example.com')
  expect(screen.queryByText('该邮箱已注册，请直接登录')).toBeNull()
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findByLabelText('6 位验证码')).toBeTruthy()
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/code', { body: { email: 'new@example.com' }, alert: false })
})

it('shows the registered-email message if the email becomes occupied before resending', async () => {
  const user = userEvent.setup()
  post.mockResolvedValueOnce(envelope(sent)).mockRejectedValueOnce(failure(409))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  const code = await enterCode(user)
  await user.type(code, '001')
  await user.click(screen.getByRole('button', { name: '重新发送验证码' }))
  expect(await screen.findByText('该邮箱已注册，请直接登录')).toBeTruthy()
  expect(code.value).toBe('001')
  expect(screen.queryByLabelText('密码')).toBeNull()
  expect(ExMessage.info).not.toHaveBeenCalled()
})

it.each([undefined, '0', '-1', 'NaN', 'Infinity'])('uses a safe rate-limit message for wait %s', async retryAfter => {
  const user = userEvent.setup()
  post.mockRejectedValue(failure(429, retryAfter))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findAllByText('发送失败，请稍后重试')).toHaveLength(1)
})

it('clears a failed send panel before retrying', async () => {
  const user = userEvent.setup(), next = deferred<typeof sent>()
  post.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(await screen.findByRole('region')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(screen.queryByRole('region')).toBeNull()
  await act(async () => { next.resolve(sent) })
  expect(await screen.findByLabelText('6 位验证码')).toBeTruthy()
})

it('passes the same email, leading-zero code and image challenge to webman', async () => {
  const user = userEvent.setup()
  captchaPost.mockResolvedValue(envelope({ challengeId: 'challenge-id', imageBase64: 'image' }))
  post.mockResolvedValueOnce(envelope(sent)).mockResolvedValueOnce(envelope(verified))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  expect(post).toHaveBeenCalledTimes(1)
  await user.type(await screen.findByLabelText('图片验证码'), ' abcd ')
  await user.click(screen.getByRole('button', { name: '验证邮箱' }))
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/verify', { body: { email: 'member@example.com', code: '001234', captcha: { challengeId: 'challenge-id', answer: 'abcd' } }, alert: false })
  expect(await screen.findByLabelText('密码')).toBeTruthy()
})

it.each(['page', 'modal'] as const)('keeps registration inputs and the error while refreshing only the captcha image for %s', async presentation => {
  const user = userEvent.setup(), next = deferred<{ data: { challengeId: string; imageBase64: string } }>()
  captchaPost.mockResolvedValueOnce(envelope({ challengeId: 'first-challenge', imageBase64: 'first-image' })).mockReturnValueOnce(next.promise)
  post.mockResolvedValueOnce(envelope(sent)).mockRejectedValueOnce(failure(422)).mockResolvedValueOnce(envelope(verified))
  render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="member@example.com" /></MemoryRouter>)
  const code = await enterCode(user), form = code.closest('form')
  await user.type(code, '001234')
  const answer = await screen.findByLabelText('图片验证码') as HTMLInputElement
  await user.type(answer, 'wrong')
  await user.click(screen.getByRole('button', { name: '验证邮箱' }))
  const message = '图片验证码不正确，已换新图请重输'
  expect(await screen.findAllByText(message)).toHaveLength(1)
  await act(async () => { next.resolve(envelope({ challengeId: 'next-challenge', imageBase64: 'next-image' })) })
  expect(screen.getByLabelText('6 位验证码')).toBe(code)
  expect(screen.getByLabelText('图片验证码')).toBe(answer)
  expect(code.closest('form')).toBe(form)
  expect(code.value).toBe('001234')
  expect(answer.value).toBe('')
  expect(screen.getAllByText(message)).toHaveLength(1)
  await user.type(answer, 'next')
  await user.click(screen.getByRole('button', { name: '验证邮箱' }))
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/verify', { body: { email: 'member@example.com', code: '001234', captcha: { challengeId: 'next-challenge', answer: 'next' } }, alert: false })
  expect(await screen.findByLabelText('密码')).toBeTruthy()
})

it('retains a leading-zero code after a network error and retries only explicitly', async () => {
  const user = userEvent.setup()
  post.mockResolvedValueOnce(sent).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(verified)
  const rendered = render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  const code = await enterCode(user)
  await user.click(code); await user.paste('001234')
  expect(await screen.findByRole('button', { name: '重试验证' })).toBeTruthy()
  expect(code.value).toBe('001234')
  rendered.rerender(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  expect(post).toHaveBeenCalledTimes(2)
  await user.click(screen.getByRole('button', { name: '重试验证' }))
  expect(await screen.findByRole('heading', { name: '完善账号' })).toBeTruthy()
  expect(post).toHaveBeenCalledTimes(3)
})

it.each([400, 429])('delivers automatic verification error %s once to the code field', async status => {
  window.history.replaceState(null, '', '/register?email=member@example.com&code=001234')
  post.mockRejectedValueOnce(failure(status, status === 429 ? '2' : undefined))
  render(<StrictMode><MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter></StrictMode>)
  const code = await screen.findByLabelText('6 位验证码') as HTMLInputElement
  await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'))
  expect(code.value).toBe('')
  expect(screen.getAllByText(status === 429 ? '验证暂时锁定，请稍后重试' : '验证码无效或已过期，请重新获取')).toHaveLength(1)
  expect(screen.queryByRole('region')).toBeNull()
  expect((screen.getByRole('button', { name: '重试验证' }) as HTMLButtonElement).disabled).toBe(status === 429)
  expect(post).toHaveBeenCalledTimes(1)
})

it('preserves a code after failed resend and clears it after success with a 60-second cooldown', async () => {
  const user = userEvent.setup()
  post.mockResolvedValueOnce(sent).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(envelope({ ...sent, resendAvailableAt: sent.serverTime + 60 }))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  const code = await enterCode(user); await user.type(code, '001')
  await user.click(screen.getByRole('button', { name: '重新发送验证码' }))
  expect(code.value).toBe('001')
  expect(await screen.findAllByText('发送失败，请重试')).toHaveLength(1)
  expect(code.getAttribute('aria-invalid')).toBe('false')
  await user.click(screen.getByRole('button', { name: '重新发送验证码' }))
  expect(screen.queryByRole('region')).toBeNull()
  expect(code.value).toBe('')
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/code', { body: { email: 'member@example.com' }, alert: false })
  expect((screen.getByRole('button', { name: '60 秒后重发' }) as HTMLButtonElement).disabled).toBe(true)
  expect(ExMessage.info).toHaveBeenCalledExactlyOnceWith('验证码已发送，请查收邮箱')
})

it('uses Retry-After to prevent immediate resend after 429', async () => {
  const user = userEvent.setup()
  post.mockResolvedValueOnce(sent).mockRejectedValueOnce(failure(429, '30'))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await enterCode(user)
  await user.click(screen.getByRole('button', { name: '重新发送验证码' }))
  expect(await screen.findByText('发送失败，请在 30 秒后重试')).toBeTruthy()
  expect((screen.getByRole('button', { name: '30 秒后重发' }) as HTMLButtonElement).disabled).toBe(true)
  expect(post).toHaveBeenCalledTimes(2)
})

it('prevents resend from bypassing a verification lock and enables retry when it expires', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const user = userEvent.setup()
  post.mockResolvedValueOnce(sent).mockRejectedValueOnce(failure(429, '2'))
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  expect((screen.getByRole('button', { name: '重试验证' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: '重新发送验证码' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { vi.advanceTimersByTime(3000) })
  expect((screen.getByRole('button', { name: '重试验证' }) as HTMLButtonElement).disabled).toBe(false)
  expect((screen.getByRole('button', { name: '重新发送验证码' }) as HTMLButtonElement).disabled).toBe(false)
  expect(post).toHaveBeenCalledTimes(2)
})

it('rejects a late send response after editing the email', async () => {
  const user = userEvent.setup(), next = deferred<typeof sent>()
  post.mockReturnValue(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  await user.clear(screen.getByLabelText('邮箱')); await user.type(screen.getByLabelText('邮箱'), 'other@example.com')
  await act(async () => { next.resolve(sent) })
  expect(screen.queryByLabelText('6 位验证码')).toBeNull()
  expect(ExMessage.info).not.toHaveBeenCalled()
})

it('back cancels late verification and sends a code for the changed email', async () => {
  const user = userEvent.setup(), next = deferred<typeof verified>()
  post.mockResolvedValueOnce(sent).mockReturnValueOnce(next.promise).mockResolvedValueOnce(sent)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  await user.click(screen.getByRole('button', { name: '返回修改邮箱' }))
  await act(async () => { next.resolve(verified) })
  expect(screen.queryByRole('heading', { name: '完善账号' })).toBeNull()
  await user.clear(screen.getByLabelText('邮箱')); await user.type(screen.getByLabelText('邮箱'), 'other@example.com')
  await user.click(screen.getByRole('button', { name: '发送验证码' }))
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/code', { body: { email: 'other@example.com' }, alert: false })
})

it('ignores automatic verification after unmount', async () => {
  const next = deferred<typeof verified>()
  window.history.replaceState(null, '', '/register?email=member@example.com&code=001234')
  post.mockReturnValue(next.promise)
  const rendered = render(<MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter>)
  rendered.unmount()
  await act(async () => { next.resolve(verified) })
  expect(post).toHaveBeenCalledTimes(1)
  expect(ExMessage.info).not.toHaveBeenCalled()
})

it.each(['modal', 'page'] as const)('completes %s with backend token and profile fields and enters ordinary login', async presentation => {
  const user = userEvent.setup(), onLogin = vi.fn()
  post.mockResolvedValueOnce(envelope(sent)).mockResolvedValueOnce(envelope(verified)).mockResolvedValueOnce(envelope({ status: 'registered', email: 'member@example.com' }))
  render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="member@example.com" onLogin={onLogin} /><Location /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  await user.type(await screen.findByLabelText('密码'), ' password-one ')
  await user.click(screen.getByRole('button', { name: '完成注册' }))
  expect(post).toHaveBeenLastCalledWith('/auth/invitations/complete', { body: { completionToken: verified.completionToken, nickname: '成员', password: ' password-one ' }, alert: false })
  expect(screen.queryByLabelText('密码')).toBeNull()
  expect(ExMessage.info).toHaveBeenCalledExactlyOnceWith('注册成功，请前往登录')
  await user.click(screen.getByRole('button', { name: '前往登录' }))
  if (presentation === 'modal') expect(onLogin).toHaveBeenCalledExactlyOnceWith('member@example.com')
  else expect(screen.getByLabelText('导航结果').textContent).toBe('/login:member@example.com')
  expect(post).toHaveBeenCalledTimes(3)
})

it.each([401, 400])('shows profile failure %s once and rejects errors after returning to email', async status => {
  const user = userEvent.setup(), next = deferred<unknown>()
  post.mockResolvedValueOnce(sent).mockResolvedValueOnce(verified).mockRejectedValueOnce(failure(status)).mockReturnValueOnce(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  await user.type(await screen.findByLabelText('密码'), 'password-one')
  await user.click(screen.getByRole('button', { name: '完成注册' }))
  const message = status === 401 ? '验证已过期，请返回邮箱重新验证' : '注册失败，请重试'
  expect(await screen.findAllByText(message)).toHaveLength(1)
  expect(screen.getByLabelText('密码').getAttribute('aria-invalid')).toBe('false')
  await user.click(screen.getByRole('button', { name: '完成注册' }))
  expect(screen.queryByRole('region')).toBeNull()
  await user.click(screen.getByRole('button', { name: '返回修改邮箱' }))
  await act(async () => { next.reject(failure(status)) })
  expect(screen.queryByRole('region')).toBeNull()
})

it.each(['modal', 'page'] as const)('automatically enters ordinary login after 1.5 seconds once for %s', async presentation => {
  const user = userEvent.setup(), onLogin = vi.fn()
  post.mockResolvedValueOnce(sent).mockResolvedValueOnce(verified).mockResolvedValueOnce({ status: 'registered', email: 'member@example.com' })
  render(<MemoryRouter><InvitationRegistrationFlow presentation={presentation} initialEmail="member@example.com" onLogin={onLogin} /><Location /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  await user.type(await screen.findByLabelText('密码'), 'password-one')
  const start = Date.now()
  await user.click(screen.getByRole('button', { name: '完成注册' }))
  expect(onLogin).not.toHaveBeenCalled()
  await waitFor(() => {
    if (presentation === 'modal') expect(onLogin).toHaveBeenCalledExactlyOnceWith('member@example.com')
    else expect(screen.getByLabelText('导航结果').textContent).toBe('/login:member@example.com')
  }, { timeout: 2200 })
  expect(Date.now() - start).toBeGreaterThanOrEqual(1450)
  await user.click(screen.getByRole('button', { name: '前往登录' }))
  if (presentation === 'modal') expect(onLogin).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledTimes(3)
})

it('clears the success timer on close', async () => {
  const user = userEvent.setup(), onLogin = vi.fn()
  post.mockResolvedValueOnce(sent).mockResolvedValueOnce(verified).mockResolvedValueOnce({ status: 'registered', email: 'member@example.com' })
  const rendered = render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" onLogin={onLogin} /></MemoryRouter>)
  await user.type(await enterCode(user), '001234')
  await user.type(await screen.findByLabelText('密码'), 'password-one')
  await user.click(screen.getByRole('button', { name: '完成注册' }))
  rendered.unmount()
  await new Promise(resolve => setTimeout(resolve, 1600))
  expect(onLogin).not.toHaveBeenCalled()
})

it('rejects late automatic verification errors after editing the email', async () => {
  const user = userEvent.setup(), next = deferred<typeof verified>()
  window.history.replaceState(null, '', '/register?email=member@example.com&code=001234')
  post.mockReturnValueOnce(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter>)
  await user.type(screen.getByLabelText('邮箱'), 'x')
  await act(async () => { next.reject(failure(400)) })
  expect(screen.queryByLabelText('6 位验证码')).toBeNull()
  expect(screen.queryByText('验证码无效或已过期，请重新获取')).toBeNull()
})

it('refreshes an invalid automatic image challenge once', async () => {
  window.history.replaceState(null, '', '/register?email=member@example.com&code=001234')
  captchaPost.mockResolvedValue(envelope({ challengeId: 'new-challenge', imageBase64: 'new-image' }))
  post.mockRejectedValueOnce(failure(422))
  render(<StrictMode><MemoryRouter><InvitationRegistrationFlow presentation="page" /></MemoryRouter></StrictMode>)
  expect(await screen.findByText('图片验证码不正确，已换新图请重输')).toBeTruthy()
  expect(await screen.findByLabelText('图片验证码')).toBeTruthy()
  expect(captchaPost).toHaveBeenCalledTimes(1)
})

it('rejects a late resend error after returning to email', async () => {
  const user = userEvent.setup(), next = deferred<typeof sent>()
  post.mockResolvedValueOnce(sent).mockReturnValueOnce(next.promise)
  render(<MemoryRouter><InvitationRegistrationFlow presentation="modal" initialEmail="member@example.com" /></MemoryRouter>)
  await enterCode(user)
  await user.click(screen.getByRole('button', { name: '重新发送验证码' }))
  await user.click(screen.getByRole('button', { name: '返回修改邮箱' }))
  await act(async () => { next.reject(new Error('offline')) })
  expect(screen.queryByText('发送失败，请重试')).toBeNull()
  expect(screen.queryByRole('region')).toBeNull()
})
