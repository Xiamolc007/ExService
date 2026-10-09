// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '@web/src/auth/storage'
import { bindNotificationsToken, notificationsConfig } from '@web/src/notifications/notificationsConfig'
import { SUMMARY_POLLING } from '@web/src/notifications/summaryPolling'
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

  /**
   * M5：轮询调度（设计 9.3）。
   *
   * 用**可控时钟**（`vi.useFakeTimers`）驱动，不靠真实等待：
   * 推进定时器就能观察间隔是否真的随失败拉长、随成功复位。
   */
  describe('M5 polling backoff', () => {
    const summaryCalls = () => get.mock.calls.filter(call => call[0] === '/notifications/summary').length

    function setupPolling() {
      const hook = renderHook(() => useNotificationsController())
      return hook
    }

    it('lengthens the interval while summaries keep failing and resets it after a success', async () => {
      vi.useFakeTimers()
      try {
        // 前 4 次持续失败，之后恢复。用假时钟记录每次读取的时刻。
        let attempts = 0
        const attemptedAt: number[] = []
        get.mockImplementation((path: string) => {
          if (path !== '/notifications/summary') return Promise.resolve(page)
          attempts += 1
          attemptedAt.push(Date.now())
          return attempts <= 4
            ? Promise.reject(new ExAxiosError('network', 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
            : Promise.resolve(summary)
        })
        const hook = setupPolling()
        await vi.advanceTimersByTimeAsync(0)
        expect(summaryCalls()).toBe(1)

        // 推进 25 分钟。排程是：a1@0 失败 → 60s → a2@60s 失败 → 240s → a3@300s 失败
        // → 480s → a4@780s 失败 → 960s 但被上限截到 600s → a5@1380s **成功** → 复位 60s
        // → a6@1440s → a7@1500s。
        await vi.advanceTimersByTimeAsync(25 * 60_000)
        expect(attempts).toBeGreaterThanOrEqual(6)

        const gaps = attemptedAt.slice(1).map((at, index) => at - attemptedAt[index]!)
        // 失败期间（gaps[0..3]）：间隔严格变大。固定 60 秒的话这里会全部相等。
        const failingGaps = gaps.slice(0, 4)
        for (let index = 1; index < failingGaps.length; index += 1) {
          expect(failingGaps[index]!).toBeGreaterThan(failingGaps[index - 1]!)
        }
        expect(failingGaps[0]).toBe(SUMMARY_POLLING.baseInterval)
        // 第 4 档本该是 16 分钟，被上限截到 10 分钟。
        expect(failingGaps[3]).toBe(SUMMARY_POLLING.maxInterval)

        // 成功之后：间隔立刻回到基准（退避只针对“正在失败”的那段时间）。
        expect(hook.result.current.countState).toEqual({ kind: 'ready', count: 2 })
        expect(gaps[4]).toBe(SUMMARY_POLLING.baseInterval)
        expect(gaps[5]).toBe(SUMMARY_POLLING.baseInterval)
        hook.unmount()
      } finally {
        vi.useRealTimers()
      }
    })

    it('stops polling while the page is hidden and resumes when it becomes visible', async () => {
      vi.useFakeTimers()
      const visibility = vi.spyOn(document, 'visibilityState', 'get')
      try {
        visibility.mockReturnValue('visible')
        const hook = setupPolling()
        await vi.advanceTimersByTimeAsync(0)
        const seen = summaryCalls()

        // 隐藏：轮询停掉，推进 10 分钟也不再发请求。
        visibility.mockReturnValue('hidden')
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        await vi.advanceTimersByTimeAsync(10 * 60_000)
        expect(summaryCalls()).toBe(seen)

        // 回到可见：立即按节流刷一次，并重新起轮询。
        visibility.mockReturnValue('visible')
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(summaryCalls()).toBe(seen + 1)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(summaryCalls()).toBe(seen + 2)
        hook.unmount()
      } finally {
        visibility.mockRestore()
        vi.useRealTimers()
      }
    })

    /**
     * 复位必须落到**已经 setTimeout 出去的档位**上，而不只是把计数器清零。
     *
     * 缺陷版本里 `onVisible` 是 `refreshNow(); schedule()` —— `schedule()` 在同一 tick
     * 读 `nextDelay()`，那时本次成败还不知道，于是新排的定时器仍是旧退避档位。
     */
    it('re-arms the timer on the base interval after a successful refresh on becoming visible', async () => {
      vi.useFakeTimers()
      const visibility = vi.spyOn(document, 'visibilityState', 'get')
      try {
        visibility.mockReturnValue('visible')
        // 前 3 次失败，之后成功。
        let attempts = 0
        get.mockImplementation((path: string) => {
          if (path !== '/notifications/summary') return Promise.resolve(page)
          attempts += 1
          return attempts <= 3
            ? Promise.reject(new ExAxiosError('network', 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
            : Promise.resolve(summary)
        })
        const hook = setupPolling()
        await vi.advanceTimersByTimeAsync(0)
        // a1@0 失败 → a2@60s 失败 → a3@300s 失败，退避被推到 480s。
        await vi.advanceTimersByTimeAsync(60_000)
        await vi.advanceTimersByTimeAsync(240_000)
        expect(summaryCalls()).toBe(3)

        // 隐藏：待触发的轮询撤掉，推进 30 分钟也不再发请求。
        visibility.mockReturnValue('hidden')
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        await vi.advanceTimersByTimeAsync(30 * 60_000)
        expect(summaryCalls()).toBe(3)

        // 回到可见：这次刷新成功 → 调度器复位 → 下一个间隔应为基准 60s。
        visibility.mockReturnValue('visible')
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(summaryCalls()).toBe(4)
        expect(hook.result.current.countState).toEqual({ kind: 'ready', count: 2 })

        // 一个基准间隔后就有下一次。旧退避是 480s，那时这里仍应是 4 次。
        await vi.advanceTimersByTimeAsync(60_000)
        expect(summaryCalls()).toBe(5)
        hook.unmount()
      } finally {
        visibility.mockRestore()
        vi.useRealTimers()
      }
    })

    it('collapses a burst of focus events into one request', async () => {
      vi.useFakeTimers()
      try {
        const hook = setupPolling()
        await vi.advanceTimersByTimeAsync(0)
        const seen = summaryCalls()
        // 密集聚焦：同一节流窗口内连发 10 次，不该变成 10 个请求。
        await act(async () => {
          for (let index = 0; index < 10; index += 1) {
            window.dispatchEvent(new Event('focus'))
            await vi.advanceTimersByTimeAsync(0)
          }
        })
        expect(summaryCalls()).toBe(seen + 1)
        // 出了节流窗口（10s）才再放行一次。
        await act(async () => {
          vi.advanceTimersByTime(10_000)
          window.dispatchEvent(new Event('focus'))
          await vi.advanceTimersByTimeAsync(0)
        })
        expect(summaryCalls()).toBe(seen + 2)
        hook.unmount()
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not stack a second request while one summary is already in flight', async () => {
      let release!: (value: unknown) => void
      get.mockImplementation((path: string) => {
        if (path !== '/notifications/summary') return Promise.resolve(page)
        // 第一次挂住，好在「在途」状态下再触发刷新。
        return new Promise(resolve => { release = resolve })
      })
      const hook = renderHook(() => useNotificationsController())
      await waitFor(() => expect(summaryCalls()).toBe(1))
      // 在途时再要求刷新若干次：在途去重应当把它们全部合并掉。
      await act(async () => {
        for (let index = 0; index < 5; index += 1) window.dispatchEvent(new Event('focus'))
      })
      expect(summaryCalls()).toBe(1)
      await act(async () => { release(summary) })
      hook.unmount()
    })

    it('clears the backoff and throttle window on logout so the next session starts fresh', async () => {
      vi.useFakeTimers()
      try {
        get.mockImplementation((path: string) => path === '/notifications/summary'
          ? Promise.reject(new ExAxiosError('network', 'NETWORK_ERROR', '网络连接失败，请稍后重试'))
          : Promise.resolve(page))
        const hook = setupPolling()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(60_000 + 120_000)
        expect(summaryCalls()).toBeGreaterThan(1)

        // 退出：监听与定时器一并撤掉，推进时间不再产生任何请求。
        hook.unmount()
        const seen = summaryCalls()
        await vi.advanceTimersByTimeAsync(30 * 60_000)
        expect(summaryCalls()).toBe(seen)
      } finally {
        vi.useRealTimers()
      }
    })
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
