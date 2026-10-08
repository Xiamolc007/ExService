// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '@web/src/auth/storage'
import { bindNotificationsToken, notificationsConfig } from '@web/src/notifications/notificationsConfig'
import { ExAxiosError } from '@workspace/sdk/http/browser'

const get = vi.hoisted(() => vi.fn())
const post = vi.hoisted(() => vi.fn())
const patch = vi.hoisted(() => vi.fn())
const put = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
const invalidateSession = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ status: 'authenticated' as 'authenticated' | 'anonymous' }))
vi.mock('@web/src/api/client', () => ({ api: { GET: get, POST: post, PATCH: patch, PUT: put } }))
vi.mock('@web/src/auth/AuthContext', () => ({ useAuth: () => ({
  state: { status: authState.status }, invalidateSession, refreshProfile: vi.fn(),
  retrySession: vi.fn(), logout: vi.fn(),
}) }))
vi.mock('react-router', () => ({ useNavigate: () => navigate }))

import { useNotificationsController } from '@web/src/notifications/useNotificationsController'

const summary = {
  unreadCount: 2, stateVersion: 1, upperSequence: 9,
  readThroughToken: 'read.through.token', serverTime: 0,
}
const page = {
  items: [{
    receiptId: 'receipt-1', title: '社区公告', summaryText: '摘要', scope: 'community',
    category: 'announcement', necessity: 'optional', sequence: 3, deliveredAt: 1_767_225_600_000,
    readAt: null, expired: false, stateRevision: 4,
  }],
  nextCursor: null, unreadCount: 2, upperSequence: 9,
  readThroughToken: 'read.through.token', serverTime: 0,
}
const detail = {
  receiptId: 'receipt-1', title: '社区公告', scope: 'community', category: 'announcement',
  necessity: 'optional', sequence: 3, deliveredAt: 1_767_225_600_000, readAt: null, clearedAt: null,
  lifecycle: 'active', stateRevision: 4, clearRevision: 0, contentAvailable: true,
  content: { format: 'html', schemaVersion: 1, policyVersion: 'notification-html-v1',
    html: '<p>正文</p>', text: '正文' },
  contentFallbackText: '正文', actions: [], actionsAvailable: false, serverTime: 0,
}
const readAllResult = {
  requestId: 'ignored', affectedCount: 2, watermarkSequence: 9, unreadCount: 0,
  replayed: false, serverTime: 0,
}
const clearPreview = {
  batchId: 'batch-1', itemCount: 3, upperSequence: 9, clearSnapshotToken: 'clear.snapshot.token',
  expiresAt: 0, serverTime: 0,
}

/**
 * 一份「刚刚生成、还有 10 分钟」的预览，时间戳相对**调用时刻**计算。
 *
 * `serverTime` 与 `expiresAt` 都用 `Date.now()` 起算，即默认服务端时钟与本机一致；
 * 需要构造时钟偏移的用例通过 `overrides` 改写两者。
 */
/** 指定标题与游标的列表页：`nextCursor` 为 null 即没有下一页。 */
function pageOf(titles: string[], nextCursor: string | null) {
  return {
    ...page,
    items: titles.map((title, index) => ({
      ...page.items[0]!, receiptId: `receipt-${title}`, title, sequence: 100 - index,
    })),
    nextCursor,
  }
}

function livePreview(overrides: Partial<typeof clearPreview> = {}) {
  const serverTime = Date.now()
  return { ...clearPreview, serverTime, expiresAt: serverTime + 10 * 60 * 1000, ...overrides }
}
const clearResult = {
  requestId: 'ignored', batchId: 'batch-1', affectedCount: 2, skippedCount: 1, unreadCount: 0,
  replayed: false, serverTime: 0,
}

let deferred: { promise: Promise<unknown>; release: (value: unknown) => void } | null = null

function routeGet() {
  get.mockImplementation((path: string) => {
    if (path === '/notifications/summary') return Promise.resolve(summary)
    if (path === '/notifications') return Promise.resolve(page)
    if (path === '/notifications/clear-batches') return Promise.resolve({ items: [], nextCursor: null, serverTime: 0 })
    if (deferred !== null) return deferred.promise
    return Promise.resolve(detail)
  })
}

beforeEach(() => {
  writeToken(window.localStorage, 'session-token')
  bindNotificationsToken('session-token')
  routeGet()
})

afterEach(() => {
  cleanup()
  get.mockReset(); post.mockReset(); patch.mockReset(); put.mockReset()
  navigate.mockClear(); invalidateSession.mockClear()
  deferred = null
  authState.status = 'authenticated'
  bindNotificationsToken(null)
  window.localStorage.clear()
})

describe('notifications controller', () => {
  it('reads the global count on its own endpoint and never derives it from a page', async () => {
    const hook = renderHook(() => useNotificationsController())
    await waitFor(() => expect(get).toHaveBeenCalledWith('/notifications/summary', { alert: false }))
    await waitFor(() => expect(hook.result.current.countState).toEqual({ kind: 'ready', count: 2 }))
    hook.unmount()
  })

  it('shows the count as stale rather than zero when the summary request fails', async () => {
    get.mockImplementation((path: string) => path === '/notifications/summary'
      ? Promise.reject(new ExAxiosError('network', 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
      : Promise.resolve(page))
    const hook = renderHook(() => useNotificationsController())
    await waitFor(() => expect(hook.result.current.countState).toEqual({ kind: 'error' }))
    expect(notificationsConfig.summary.unreadCount).toBe(0)
    hook.unmount()
  })

  it('loads history when the modal opens and does not mark anything read by opening', async () => {
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(get).toHaveBeenCalledWith('/notifications', {
      alert: false,
      params: { query: { view: 'history', limit: 20 } },
    }))
    expect(hook.result.current.selectedId).toBeNull()
    expect(patch).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('marks read only after the user selects and the body is present', async () => {
    patch.mockResolvedValue({ receiptId: 'receipt-1', read: true, stateRevision: 5, unreadCount: 1, serverTime: 0 })
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { hook.result.current.onSelect('receipt-1') })
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications/{notificationId}/state', {
      alert: false,
      params: { path: { notificationId: 'receipt-1' } },
      body: { read: true, expectedRevision: 4 },
    }))
    hook.unmount()
  })

  it('keeps a failed read-write unread and offers a retry', async () => {
    patch.mockRejectedValue(new ExAxiosError('http', 'HTTP_ERROR', '写入失败', { status: 500 }))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { hook.result.current.onSelect('receipt-1') })
    await waitFor(() => expect(hook.result.current.detail.readError).toBe('写入失败'))
    expect(patch).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('refreshes and asks the user to re-check after a 409 read conflict', async () => {
    patch.mockRejectedValue(new ExAxiosError('http', 'ACTION_STATE_CONFLICT', '状态已变化', { status: 409 }))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { hook.result.current.onSelect('receipt-1') })
    await waitFor(() =>
      expect(hook.result.current.detail.readError).toBe('状态已变化（409），已刷新。请核对后再操作。'))
    // 409 之后重新读取详情，而不是自动重试同一个写。
    await waitFor(() => expect(get).toHaveBeenCalledWith('/notifications/{notificationId}', {
      alert: false, params: { path: { notificationId: 'receipt-1' } },
    }))
    expect(patch).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('discards a late list response once the account token changes', async () => {
    let release!: (value: unknown) => void
    get.mockImplementation((path: string) => {
      if (path !== '/notifications') return routeGetCalls(path)
      return new Promise(resolve => { release = resolve })
    })
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    writeToken(window.localStorage, 'other-token')
    await act(async () => { bindNotificationsToken('other-token') })
    await act(async () => { release(page); await Promise.resolve() })
    await waitFor(() => expect(notificationsConfig.history.items).toHaveLength(0))
    expect(notificationsConfig.history.status).toBe('idle')
    hook.unmount()
  })

  it('discards a late detail response once a later write has superseded it', async () => {
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))

    let releaseDetail!: (value: unknown) => void
    deferred = { promise: new Promise(resolve => { releaseDetail = resolve }), release: releaseDetail }
    let pendingDetail!: Promise<void>
    await act(async () => { pendingDetail = Promise.resolve(hook.result.current.onSelect('receipt-1')) })

    post.mockResolvedValue(readAllResult)
    await act(async () => { await hook.result.current.bulk.onReadAll() })
    await act(async () => { await hook.result.current.confirm.onSubmit() })

    await act(async () => { releaseDetail(detail); await pendingDetail })
    // 写已经开始，读到的是写之前的快照，因此被丢弃。
    expect(hook.result.current.detail.value).toBeNull()
    hook.unmount()
  })

  it('sends the previewed scope and reuses one request id for the clear intent', async () => {
    post.mockImplementation((path: string) => path === '/notifications/clear-preview'
      ? Promise.resolve(livePreview())
      : Promise.resolve(clearResult))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { await hook.result.current.bulk.onClearAll() })
    expect(post).toHaveBeenCalledWith('/notifications/clear-preview', { alert: false, body: {} })
    expect(hook.result.current.confirm).toMatchObject({ kind: 'clear', count: 3 })

    await act(async () => { await hook.result.current.confirm.onSubmit() })
    const submit = post.mock.calls.find(call => call[0] === '/notifications/clear-all')
    expect(submit).toBeTruthy()
    expect(submit![1]).toMatchObject({ body: { clearSnapshotToken: 'clear.snapshot.token' } })
    expect(typeof (submit![1] as { body: { requestId: string } }).body.requestId).toBe('string')
    await waitFor(() => expect(hook.result.current.bulk.message)
      .toBe('已清理 2 条，跳过 1 条；新到通知仍保留。'))
    expect(hook.result.current.bulk.lastClearedBatchId).toBe('batch-1')
    hook.unmount()
  })

  /**
   * N1-T2：分页失败后不能重放失效游标。
   *
   * 游标绑的是读取时的上界；分页途中来了新通知（`upperSequence` 一变）或游标过期，
   * 服务端就恒 400/410。重放它只会再报一次同样的错，用户永远卡在
   * 「重试 → 还是失败」的死循环里 —— Tester 的 U02 实测过。
   */
  it('drops the failed cursor and recovers by re-reading the first page', async () => {
    const requestedCursors: (string | undefined)[] = []
    get.mockImplementation((path: string, init?: { params?: { query?: { cursor?: string } } }) => {
      if (path === '/notifications/summary') return Promise.resolve(summary)
      if (path !== '/notifications') return Promise.resolve(detail)
      const cursor = init?.params?.query?.cursor
      requestedCursors.push(cursor)
      if (cursor !== undefined) {
        // 带游标翻页一律失败：模拟「分页途中来了新通知，旧游标恒 400」。
        return Promise.reject(new ExAxiosError('http', 'NOTIFICATION_TOKEN_INVALID',
          '游标已失效', { status: 400 }))
      }
      // 重读第一页成功，并带回一个新游标。
      return Promise.resolve(pageOf(['N046', 'A'], 'cursor-fresh'))
    })

    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    expect(hook.result.current.list.items.map(item => item.title)).toEqual(['N046', 'A'])
    expect(hook.result.current.list.hasMore).toBe(true)

    // 翻下一页失败：已加载的通知保留，游标被丢弃（不再给出「加载更多」）。
    await act(async () => { hook.result.current.list.onLoadMore() })
    await waitFor(() => expect(hook.result.current.list.nextPageStatus).toBe('error'))
    expect(hook.result.current.list.items.map(item => item.title)).toEqual(['N046', 'A'])
    expect(hook.result.current.list.hasMore).toBe(false)

    // 重试：必须重读第一页换新游标，而不是把失效游标再发一次。
    await act(async () => { hook.result.current.list.onLoadMore() })
    await waitFor(() => expect(hook.result.current.list.nextPageStatus).toBe('idle'))
    expect(requestedCursors).toEqual([undefined, 'cursor-fresh', undefined])
    expect(hook.result.current.list.hasMore).toBe(true)
    hook.unmount()
  })

  it('keeps the loaded rows visible while a failed page is being re-read', async () => {
    // 重读第一页期间不能把列表换成骨架：那等于把「已显示的通知保留」抹掉。
    let secondPageFailed = false
    let firstPageRead = false
    let releaseReload!: (value: unknown) => void
    get.mockImplementation((path: string, init?: { params?: { query?: { cursor?: string } } }) => {
      if (path === '/notifications/summary') return Promise.resolve(summary)
      if (path !== '/notifications') return Promise.resolve(detail)
      const cursor = init?.params?.query?.cursor
      if (cursor !== undefined && !secondPageFailed) {
        secondPageFailed = true
        return Promise.reject(new ExAxiosError('http', 'NOTIFICATION_TOKEN_INVALID',
          '游标已失效', { status: 400 }))
      }
      if (cursor === undefined && firstPageRead) {
        // 第二次读第一页（即重试）挂住，好在「请求在途」时断言列表没被换成骨架。
        return new Promise(resolve => { releaseReload = resolve })
      }
      // 第一页带一个游标，这样第一次 onLoadMore 才是真正的「翻下一页」。
      firstPageRead = true
      return Promise.resolve(pageOf(['A'], 'cursor-1'))
    })
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { hook.result.current.list.onLoadMore() })
    await waitFor(() => expect(hook.result.current.list.nextPageStatus).toBe('error'))

    // 重读在途：状态仍是 ready（行还在），进度只体现在 nextPageStatus 上。
    await act(async () => { void hook.result.current.list.onLoadMore() })
    await waitFor(() => expect(hook.result.current.list.nextPageStatus).toBe('loading'))
    expect(hook.result.current.list.status).toBe('ready')
    expect(hook.result.current.list.items).toHaveLength(1)

    await act(async () => { releaseReload(pageOf(['N046', 'A'], 'cursor-fresh')) })
    await waitFor(() => expect(hook.result.current.list.nextPageStatus).toBe('idle'))
    expect(hook.result.current.list.status).toBe('ready')
    expect(hook.result.current.list.items.map(item => item.title)).toEqual(['N046', 'A'])
    hook.unmount()
  })

  /**
   * 设计 9.2：预览是否过期由**服务端**决定，客户端不能拿本机时钟去推。
   *
   * 判据是 `expiresAt <= Date.now() + (serverTime − 收到响应的本机时刻)`。
   * 直接拿 `Date.now()` 比 `expiresAt` 等于假定两台机器时钟一致，两条例分别让两种
   * 方向的偏移走向相反的错误结论。
   */
  it('treats the preview as expired when the server clock is ahead of this machine', async () => {
    // 服务端快 1 小时。`expiresAt` 在本机看还有 30 分钟，但在服务端时钟上已经过期 30 分钟。
    const localNow = Date.now()
    post.mockImplementation((path: string) => path === '/notifications/clear-preview'
      ? Promise.resolve(livePreview({
        serverTime: localNow + 3_600_000,
        expiresAt: localNow + 1_800_000,
      }))
      : Promise.resolve(clearResult))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { await hook.result.current.bulk.onClearAll() })
    // 跟随服务端判定：过期。本机时钟会误判成「还有 30 分钟」。
    expect(hook.result.current.confirm).toMatchObject({ kind: 'clear', expired: true })
    hook.unmount()
  })

  it('keeps the preview valid when this machine clock is ahead of the server', async () => {
    // 反过来：本机快 1 小时。`expiresAt` 在本机看已过期 30 分钟，但服务端还剩 30 分钟。
    const localNow = Date.now()
    post.mockImplementation((path: string) => path === '/notifications/clear-preview'
      ? Promise.resolve(livePreview({
        serverTime: localNow - 3_600_000,
        expiresAt: localNow - 1_800_000,
      }))
      : Promise.resolve(clearResult))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { await hook.result.current.bulk.onClearAll() })
    // 跟随服务端判定：未过期。本机时钟会误判成「已过期」。
    expect(hook.result.current.confirm).toMatchObject({ kind: 'clear', expired: false })
    hook.unmount()
  })

  it('never offers an undo entry for a zero-item clear', async () => {
    post.mockImplementation((path: string) => path === '/notifications/clear-preview'
      ? Promise.resolve(livePreview())
      : Promise.resolve({ ...clearResult, affectedCount: 0, skippedCount: 3 }))
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { await hook.result.current.bulk.onClearAll() })
    await act(async () => { await hook.result.current.confirm.onSubmit() })
    await waitFor(() => expect(hook.result.current.bulk.message)
      .toBe('已清理 0 条，跳过 3 条；新到通知仍保留。'))
    expect(hook.result.current.bulk.lastClearedBatchId).toBeNull()
    hook.unmount()
  })

  it('replays the same request id when a restore has to be retried', async () => {
    post.mockRejectedValueOnce(new ExAxiosError('network', 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
      .mockResolvedValueOnce({
        requestId: 'ignored', batchId: 'batch-1', affectedCount: 3, skippedCount: 1,
        unreadCount: 1, replayed: false, serverTime: 0,
      })
    const hook = renderHook(() => useNotificationsController())
    await act(async () => { hook.result.current.onOpenModal() })
    await waitFor(() => expect(hook.result.current.list.status).toBe('ready'))
    await act(async () => { await hook.result.current.records.onRestore('batch-1') })
    await act(async () => { await hook.result.current.records.onRestore('batch-1') })
    const calls = post.mock.calls.filter(call => call[0] === '/notifications/clear-batches/{batchId}/restore')
    expect(calls).toHaveLength(2)
    // 结果未知的重试是重放同一个意图，不是新意图：换 key 会绕过服务端的幂等裁决。
    expect(getRequestId(calls[0]!)).toBe(getRequestId(calls[1]!))
    await waitFor(() => expect(hook.result.current.bulk.message)
      .toBe('已恢复 3 条仍符合条件的通知；过期项只回到历史。'))
    hook.unmount()
  })

  it('submits read-all with the signed read-through token and keeps new arrivals unread', async () => {
    post.mockResolvedValue(readAllResult)
    const hook = renderHook(() => useNotificationsController())
    await waitFor(() => expect(hook.result.current.countState).toEqual({ kind: 'ready', count: 2 }))
    await act(async () => { await hook.result.current.bulk.onReadAll() })
    expect(hook.result.current.confirm).toMatchObject({ kind: 'read-all', count: 2 })
    await act(async () => { await hook.result.current.confirm.onSubmit() })
    expect(post).toHaveBeenCalledWith('/notifications/read-all', {
      alert: false,
      body: { requestId: expect.any(String), readThroughToken: 'read.through.token' },
    })
    await waitFor(() => expect(hook.result.current.bulk.message)
      .toBe('已标记本次选定通知，新到通知仍未读。'))
    hook.unmount()
  })

  it('clears private state and hands the session back on SESSION_INVALID', async () => {
    get.mockRejectedValue(new ExAxiosError('http', 'SESSION_INVALID', '会话已失效', { status: 401 }))
    const hook = renderHook(() => useNotificationsController())
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledWith('session-token'))
    expect(notificationsConfig.summary.unreadCount).toBe(0)
    expect(notificationsConfig.history.items).toHaveLength(0)
    hook.unmount()
  })

  it('hides the bell and stops reading for an anonymous visitor', async () => {
    authState.status = 'anonymous'
    const hook = renderHook(() => useNotificationsController())
    expect(hook.result.current.countState).toEqual({ kind: 'hidden' })
    expect(hook.result.current.authenticated).toBe(false)
    expect(get).not.toHaveBeenCalled()
    hook.unmount()
  })
})

function routeGetCalls(path: string) {
  if (path === '/notifications/summary') return Promise.resolve(summary)
  return Promise.resolve(page)
}

function getRequestId(call: unknown[]): unknown {
  return (call[1] as { body: { requestId: string } }).body.requestId
}
