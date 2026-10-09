import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSnapshot } from 'valtio'
import { api } from '@web/src/api/client'
import { useAuth } from '@web/src/auth/AuthContext'
import { readToken, subscribeSessionChanges } from '@web/src/auth/storage'
import { ExAxiosError } from '@workspace/sdk/http/browser'
import {
  applyUnreadCount, bindNotificationsToken, captureNotificationRead, captureNotificationWrite,
  isCurrentNotificationGeneration, mergeNotificationPage, notificationsConfig,
  type NotificationDetail, type NotificationItem,
} from '@web/src/notifications/notificationsConfig'
import { createSummaryScheduler } from '@web/src/notifications/summaryPolling'
import type {
  NotificationBulkSlice, NotificationConfirmSlice, NotificationCountState, NotificationDetailSlice,
  NotificationHistoryFilter, NotificationListSlice, NotificationRecordsSlice,
} from '@workspace/components'

/** 列表页大小；Contract 上界为 50。 */
const PAGE_LIMIT = 20

interface ClearPreview {
  token: string
  itemCount: number
  /** 服务端返回的绝对过期时刻，单位是**服务端时钟**（设计 9.2：不按客户端时间推断）。 */
  expiresAt: number
  /**
   * 收到响应那一刻的「服务端时钟 − 本机时钟」。
   *
   * 本机时钟可能与服务端相差很多（用户改过系统时间、NTP 未同步、虚拟机挂起恢复等），
   * 所以不能拿 `Date.now()` 直接和 `expiresAt` 比；一律先换算到服务端时钟。
   * 偏移只在这里采样一次，之后不再漂移。
   *
   * 残余误差是**最多一个往返时延**（`serverTime` 是服务端生成响应的时刻，本机会稍晚收到），
   * 方向是「判定略晚于服务端」。服务端仍会在 `clear-all` 上返回 410 作为权威闸门，
   * 客户端这一层只是提前提示，不是安全边界。
   */
  clockOffset: number
  requestId: string
}

/**
 * 通知收件箱控制器：拥有 API、轮询与请求代次。
 *
 * 共享组件只收到值与回调；这里负责：
 *
 * - **身份绑定**：换号、退出、明确会话失效清空整片私人状态；
 * - **代次保护**：迟到的读/写响应不覆盖之后的任何操作；
 * - **幂等键**：同一意图（一次预览、一次确认）复用同一个 `requestId`，因此重试是重放
 *   而不是新意图；新的意图才生成新 key。
 */
export function useNotificationsController() {
  const auth = useAuth()
  const navigate = useNavigate()
  const snapshot = useSnapshot(notificationsConfig)

  const [popupOpen, setPopupOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<NotificationHistoryFilter>('all')
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [detail, setDetail] = useState<NotificationDetail | null>(null)
  const [readPending, setReadPending] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [bulkPending, setBulkPending] = useState<'read-all' | 'clear' | 'restore' | null>(null)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [lastClearedBatchId, setLastClearedBatchId] = useState<string | null>(null)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'clear' | 'read-all'; count: number } | null>(null)
  const [previewClock, setPreviewClock] = useState(0)

  const clearPreview = useRef<ClearPreview | null>(null)
  /** 未读计数轮询：失败退避、成功复位、聚焦节流。 */
  const scheduler = useMemo(() => createSummaryScheduler(), [])
  /** 未读计数在途请求，用于去重。 */
  const summaryInFlight = useRef<Promise<void> | null>(null)
  const readAllIntent = useRef<string | null>(null)
  const restoreIntent = useRef(new Map<string, string>())
  /**
   * 自动标已读被抑制的条目。
   *
   * 写失败后不能靠「重新读详情 → 又触发自动标已读」自动重试：409 要求用户核对后再操作，
   * 普通失败也要由用户点重试。只有用户**再次主动选中**该条目才算新的意图。
   */
  const autoReadSuppressed = useRef<string | null>(null)
  /** 顶栏铃铛按钮：历史 Modal 关闭后焦点回到同一个元素。 */
  const bellRef = useRef<HTMLButtonElement | null>(null)

  const authenticated = auth.state.status === 'authenticated'
  const invalidate = auth.invalidateSession

  const sessionInvalid = useCallback((error: unknown) => {
    if (!(error instanceof ExAxiosError) || error.code !== 'SESSION_INVALID') return false
    const token = currentToken()
    if (token !== null) invalidate(token)
    bindNotificationsToken(null)
    return true
  }, [invalidate])

  // ---- 身份绑定 ----------------------------------------------------------
  useEffect(() => {
    const sync = () => {
      try { bindNotificationsToken(readToken(window.localStorage)) }
      catch { bindNotificationsToken(null) }
    }
    sync()
    return subscribeSessionChanges(sync)
  }, [])
  useEffect(() => {
    if (auth.state.status === 'anonymous') bindNotificationsToken(null)
    if (!authenticated) {
      setPopupOpen(false)
      setModalOpen(false)
      setSelectedId(null)
      setConfirm(null)
      setRecordsOpen(false)
    }
  }, [auth.state.status, authenticated])

  // ---- 未读计数 ----------------------------------------------------------
  const loadSummary = useCallback(async () => {
    if (!authenticated) return
    const generation = captureNotificationRead()
    notificationsConfig.summary.status = 'loading'
    notificationsConfig.summary.error = null
    try {
      const result = await api.GET('/notifications/summary', { alert: false })
      if (!isCurrentNotificationGeneration(generation)) return
      // 一次成功就把退避拉回基准：退避只针对「正在失败」的那段时间（设计 9.3）。
      scheduler.recordSuccess()
      applyUnreadCount(result.unreadCount, result.readThroughToken)
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      scheduler.recordFailure()
      notificationsConfig.summary.status = 'error'
      notificationsConfig.summary.error = error instanceof ExAxiosError
        ? error.message : '未读计数暂时无法读取'
    }
  }, [authenticated, sessionInvalid, scheduler])

  /**
   * 在途去重：挂载、定时器、聚焦、可见性可能同时要求刷新，同一时刻只发一次。
   * 返回这一次读取的 promise，好让调用方等它落地再排下一次（退避要用本次结果）。
   *
   * 显式重试（`refreshSummary` / 列表重试）**不**走这里 —— 用户点了就该真的发一次请求，
   * 不能被一个在途请求吞掉。
   */
  const runSummaryIfIdle = useCallback((): Promise<void> => {
    if (summaryInFlight.current !== null) return summaryInFlight.current
    const task = loadSummary()
    summaryInFlight.current = task
    void task.finally(() => {
      if (summaryInFlight.current === task) summaryInFlight.current = null
    })
    return task
  }, [loadSummary])

  useEffect(() => {
    if (authenticated) void runSummaryIfIdle()
  }, [authenticated, runSummaryIfIdle])

  // 聚焦与可见性刷新 + 可见时的轮询；隐藏或匿名时停止，不做实时承诺（设计 9.3）。
  useEffect(() => {
    if (!authenticated) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const clearTimer = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    }
    /** 只排下一次，间隔由当前退避决定：失败会越排越远，成功后回到基准。 */
    const schedule = () => {
      clearTimer()
      if (stopped || document.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        timer = undefined
        if (stopped) return
        // 定时器这条路径不过节流窗口：它本身就是按间隔来的。
        // 等这一次读取**落地**再排下一次 —— 否则退避用的是上一次的失败数，慢一个周期。
        void runSummaryIfIdle().finally(schedule)
      }, scheduler.nextDelay())
    }
    /**
     * 确保有一个待触发的轮询：已有倒计时就**不动**。
     * 否则密集 focus 会不断把倒计时推后，反而永远等不到下一次轮询。
     */
    const ensureScheduled = () => {
      if (timer !== undefined) return
      schedule()
    }
    /**
     * 聚焦/可见性刷新：节流 + 在途去重，密集 focus 不该变成请求风暴。
     *
     * 两条分支都必须保证最后**有一个待触发的轮询**：
     * - 真发了请求 → 排程挂在 `.finally` 上，等本次落地再排。否则新排的定时器用的还是
     *   本次之前的失败数，复位就只落到了计数器上、落不到已经 `setTimeout` 出去的档位；
     * - 被节流挡掉 → 只补排（`ensureScheduled` 本来就只在没有倒计时时才排），按当前档位续。
     */
    const refreshNow = () => {
      if (stopped || document.visibilityState !== 'visible') return
      if (!scheduler.allowRefresh()) {
        ensureScheduled()
        return
      }
      void runSummaryIfIdle().finally(schedule)
    }

    const onFocus = () => refreshNow()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // 隐藏：撤掉待触发的轮询，否则它会在隐藏期间再发一次；回到可见时重新起。
        clearTimer()
        return
      }
      refreshNow()
    }

    if (document.visibilityState === 'visible') schedule()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearTimer()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      // 退出/换号：清掉退避、节流窗口与在途标记，下次登录从基准间隔重新开始。
      scheduler.reset()
      summaryInFlight.current = null
    }
  }, [authenticated, runSummaryIfIdle, scheduler])

  // ---- 列表 --------------------------------------------------------------
  /**
   * @param options.keepItems 重读第一页时也保留已加载的通知，不把列表换成骨架。
   *   用于「分页失败后重读第一页拿新游标」：请求期间与失败时都要看得见已有内容。
   */
  const loadPage = useCallback(async (
    view: NotificationHistoryFilter,
    cursor: string | null,
    options: { keepItems?: boolean } = {},
  ) => {
    if (!authenticated) return
    const slice = view === 'unread' ? notificationsConfig.unread : notificationsConfig.history
    const generation = captureNotificationRead()
    const nextPage = cursor !== null
    if (nextPage || options.keepItems) slice.nextPageStatus = 'loading'
    if (!nextPage && !options.keepItems) {
      slice.status = 'loading'
      slice.error = null
    }
    try {
      const result = await api.GET('/notifications', {
        alert: false,
        params: {
          query: {
            view: view === 'unread' ? 'unread' : 'history',
            limit: PAGE_LIMIT,
            ...(cursor === null ? {} : { cursor }),
          },
        },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      slice.items = nextPage ? mergeNotificationPage(slice, result) : dedupe(result.items)
      slice.nextCursor = result.nextCursor
      slice.upperSequence = result.upperSequence
      slice.readThroughToken = result.readThroughToken
      slice.status = 'ready'
      slice.nextPageStatus = 'idle'
      slice.error = null
      applyUnreadCount(result.unreadCount, result.readThroughToken)
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      if (nextPage || options.keepItems) {
        // 两种情况都保留已加载的通知，只在列表尾部给重试：
        // - 分页失败（设计 9.3）；
        // - 带着 `keepItems` 的重读失败，同样不能把整份列表换成错误面板。
        slice.nextPageStatus = 'error'
        if (nextPage) {
          /*
           * 丢弃这个游标。
           *
           * 游标绑的是**读取时的上界**：分页途中来了新通知（`upperSequence` 一变）、
           * 或游标过期，服务端就恒 400/410（Tester 的 A02/A04 已实测）。重放它只会
           * 再报一次同样的错，用户永远卡在「重试 → 还是失败」的死循环里。
           * 清掉之后 `hasMore` 变 false，「加载更多」收起，重试退成「重读第一页」，
           * 那才是唯一能拿到新游标的路径。
           */
          slice.nextCursor = null
        }
      } else {
        slice.status = 'error'
        slice.error = error instanceof ExAxiosError ? error.message : '通知暂时无法加载'
      }
    }
  }, [authenticated, sessionInvalid])

  const loadUnread = useCallback(() => loadPage('unread', null), [loadPage])
  const loadHistory = useCallback(() => loadPage(filter, null), [loadPage, filter])
  const loadNextPage = useCallback(() => {
    const slice = filter === 'unread' ? notificationsConfig.unread : notificationsConfig.history
    // 分页失败后 `nextCursor` 已被清空，这里会退成「重读第一页拿新游标」；
    // `keepItems` 让已加载的通知在整段过程中保持可见，不会被换成骨架。
    return loadPage(filter, slice.nextCursor, { keepItems: true })
  }, [loadPage, filter])

  useEffect(() => {
    if (popupOpen) void loadUnread()
  }, [popupOpen, loadUnread])

  useEffect(() => {
    if (modalOpen) {
      void loadHistory()
      return
    }
    setSelectedId(null)
    setDetail(null)
    setDetailStatus('idle')
    setReadError(null)
    setRecordsOpen(false)
  }, [modalOpen, loadHistory])

  // ---- 详情 --------------------------------------------------------------
  const loadDetail = useCallback(async (receiptId: string) => {
    if (!authenticated) return
    const generation = captureNotificationRead()
    setDetailStatus('loading')
    setReadError(null)
    try {
      const result = await api.GET('/notifications/{notificationId}', {
        alert: false, params: { path: { notificationId: receiptId } },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      setDetail(result)
      setDetailStatus('ready')
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      setDetail(null)
      setDetailStatus('error')
    }
  }, [authenticated, sessionInvalid])

  const select = useCallback((receiptId: string) => {
    // 用户再次主动选中即视为新意图，解除上一次写失败留下的抑制。
    autoReadSuppressed.current = null
    setSelectedId(receiptId)
    setReadError(null)
    void loadDetail(receiptId)
  }, [loadDetail])

  // ---- 单项已读 / 未读 ----------------------------------------------------
  const markRead = useCallback(async (receiptId: string, read: boolean, expectedRevision: number) => {
    if (!authenticated) return
    const generation = captureNotificationWrite()
    setReadPending(true)
    setReadError(null)
    try {
      const result = await api.PATCH('/notifications/{notificationId}/state', {
        alert: false,
        params: { path: { notificationId: receiptId } },
        body: { read, expectedRevision },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      applyUnreadCount(result.unreadCount)
      patchLocalItem(receiptId, result.stateRevision, result.read)
      setDetail(current => current === null || current.receiptId !== receiptId ? current : {
        ...current,
        readAt: result.read ? current.deliveredAt : null,
        stateRevision: result.stateRevision,
      })
      // 写改变了列表的已读状态：重新读取当前页，跳过项与新到项由服务端裁决。
      void loadPage(filter, null)
      void loadUnread()
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      // 写失败后不再自动重试：正文与未读状态都保留，由用户显式重试。
      autoReadSuppressed.current = receiptId
      if (error instanceof ExAxiosError && error.status === 409) {
        // 先重新读取当前状态，再落地错误：`loadDetail` 会清掉上一次的读取错误。
        void loadDetail(receiptId)
        void loadPage(filter, null)
        setReadError('状态已变化（409），已刷新。请核对后再操作。')
        return
      }
      setReadError(error instanceof ExAxiosError
        ? error.message : '状态保存失败，正文和未读状态已保留。')
    } finally {
      setReadPending(false)
    }
  }, [authenticated, sessionInvalid, filter, loadPage, loadUnread, loadDetail])

  const toggleRead = useCallback(() => {
    if (selectedId === null) return
    const revision = detail?.receiptId === selectedId
      ? detail.stateRevision
      : (findItem(notificationsConfig.history.items, selectedId)
        ?? findItem(notificationsConfig.unread.items, selectedId))?.stateRevision
    if (revision === undefined) return
    const read = detail?.receiptId === selectedId ? detail.readAt === null : true
    void markRead(selectedId, read, revision)
  }, [selectedId, detail, markRead])

  /**
   * 详情 GET 不写状态。只有用户**主动选中**且正文/纯文本回退成功呈现之后才标已读；
   * 打开 Modal、自动选首项、hover 与 Action 都不触发。
   */
  useEffect(() => {
    if (!modalOpen || selectedId === null) return
    if (detailStatus !== 'ready' || detail === null || detail.receiptId !== selectedId) return
    if (detail.readAt !== null) return
    if (autoReadSuppressed.current === selectedId) return
    void markRead(selectedId, true, detail.stateRevision)
  }, [modalOpen, selectedId, detailStatus, detail, markRead])

  // ---- 批量：全部已读 -----------------------------------------------------
  const requestReadAll = useCallback(async () => {
    if (notificationsConfig.summary.readThroughToken === null) await loadSummary()
    const summary = notificationsConfig.summary
    if (summary.status !== 'ready' || summary.readThroughToken === null) {
      setBulkMessage('操作失败，原状态已保留。请重试。')
      return
    }
    readAllIntent.current = newRequestId()
    setConfirm({ kind: 'read-all', count: summary.unreadCount })
  }, [loadSummary])

  const submitReadAll = useCallback(async () => {
    const requestId = readAllIntent.current
    const token = notificationsConfig.summary.readThroughToken
    if (requestId === null || token === null) return
    const generation = captureNotificationWrite()
    setBulkPending('read-all')
    setBulkMessage('正在提交，请稍候。')
    try {
      const result = await api.POST('/notifications/read-all', {
        alert: false, body: { requestId, readThroughToken: token },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      // 重放只给原命令反馈；当前状态一律重新读取，不把旧结果当成现在。
      applyUnreadCount(result.unreadCount)
      setBulkMessage('已标记本次选定通知，新到通知仍未读。')
      setConfirm(null)
      readAllIntent.current = null
      void loadSummary()
      void loadPage(filter, null)
      void loadUnread()
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      setBulkMessage(failureMessage(error))
    } finally {
      setBulkPending(null)
    }
  }, [filter, loadPage, loadSummary, loadUnread])

  // ---- 清理批次 -----------------------------------------------------------
  const loadBatches = useCallback(async () => {
    if (!authenticated) return
    const generation = captureNotificationRead()
    notificationsConfig.batches.status = 'loading'
    notificationsConfig.batches.error = null
    try {
      const result = await api.GET('/notifications/clear-batches', {
        alert: false, params: { query: { limit: PAGE_LIMIT } },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      notificationsConfig.batches.items = result.items
      notificationsConfig.batches.status = 'ready'
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      notificationsConfig.batches.status = 'error'
      notificationsConfig.batches.error = error instanceof ExAxiosError
        ? error.message : '清理记录暂时无法加载'
    }
  }, [authenticated, sessionInvalid])

  // ---- 批量：清理 ---------------------------------------------------------
  const requestClearPreview = useCallback(async () => {
    if (!authenticated) return
    const generation = captureNotificationRead()
    setBulkMessage(null)
    try {
      const preview = await api.POST('/notifications/clear-preview', { alert: false, body: {} })
      if (!isCurrentNotificationGeneration(generation)) return
      // 过期时刻用服务端给的 `expiresAt`，同时用 `serverTime` 记下时钟偏移；
      // 不能用 `Date.now() + 一个本机常量` 去猜服务端什么时候判它过期。
      const receivedAt = Date.now()
      clearPreview.current = {
        token: preview.clearSnapshotToken,
        itemCount: preview.itemCount,
        expiresAt: preview.expiresAt,
        clockOffset: preview.serverTime - receivedAt,
        requestId: newRequestId(),
      }
      setPreviewClock(receivedAt)
      setConfirm({ kind: 'clear', count: preview.itemCount })
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      setBulkMessage(failureMessage(error, '清理预览失败，请重试。'))
    }
  }, [authenticated, sessionInvalid])

  const submitClear = useCallback(async () => {
    const preview = clearPreview.current
    if (preview === null) return
    const generation = captureNotificationWrite()
    setBulkPending('clear')
    setBulkMessage('正在提交，请稍候。')
    try {
      const result = await api.POST('/notifications/clear-all', {
        alert: false,
        body: { requestId: preview.requestId, clearSnapshotToken: preview.token },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      applyUnreadCount(result.unreadCount)
      setBulkMessage(`已清理 ${result.affectedCount} 条，跳过 ${result.skippedCount} 条；新到通知仍保留。`)
      // 零项清理保留幂等事实，但不生成恢复入口。
      setLastClearedBatchId(result.affectedCount > 0 ? result.batchId : null)
      setConfirm(null)
      setSelectedId(null)
      setDetail(null)
      setDetailStatus('idle')
      clearPreview.current = null
      void loadSummary()
      void loadPage(filter, null)
      void loadUnread()
      if (recordsOpen) void loadBatches()
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      setBulkMessage(failureMessage(error))
    } finally {
      setBulkPending(null)
    }
  }, [authenticated, sessionInvalid, filter, loadPage, loadSummary, loadUnread, recordsOpen, loadBatches])

  // ---- 批量：恢复 ---------------------------------------------------------
  const restoreBatch = useCallback(async (batchId: string) => {
    if (!authenticated) return
    // 同一恢复意图复用同一个 key；新的恢复意图才生成新 key。
    const existing = restoreIntent.current.get(batchId)
    const requestId = existing ?? newRequestId()
    if (existing === undefined) restoreIntent.current.set(batchId, requestId)
    const generation = captureNotificationWrite()
    setBulkPending('restore')
    setBulkMessage('正在提交，请稍候。')
    try {
      const result = await api.POST('/notifications/clear-batches/{batchId}/restore', {
        alert: false, params: { path: { batchId } }, body: { requestId },
      })
      if (!isCurrentNotificationGeneration(generation)) return
      applyUnreadCount(result.unreadCount)
      setBulkMessage(`已恢复 ${result.affectedCount} 条仍符合条件的通知；过期项只回到历史。`)
      restoreIntent.current.delete(batchId)
      setLastClearedBatchId(current => current === batchId ? null : current)
      void loadSummary()
      void loadPage(filter, null)
      void loadUnread()
      void loadBatches()
    } catch (error) {
      if (!isCurrentNotificationGeneration(generation)) return
      if (sessionInvalid(error)) return
      setBulkMessage(failureMessage(error))
    } finally {
      setBulkPending(null)
    }
  }, [authenticated, sessionInvalid, filter, loadBatches, loadPage, loadSummary, loadUnread])

  const undoClear = useCallback(() => {
    if (lastClearedBatchId !== null) void restoreBatch(lastClearedBatchId)
  }, [lastClearedBatchId, restoreBatch])

  const openRecords = useCallback(() => {
    setRecordsOpen(true)
    void loadBatches()
  }, [loadBatches])

  const closeRecords = useCallback(() => setRecordsOpen(false), [])

  // ---- 组装共享组件所需的切片 ---------------------------------------------
  const activePage = filter === 'unread' ? snapshot.unread : snapshot.history
  const preview = clearPreview.current

  const list: NotificationListSlice = {
    status: activePage.status,
    items: activePage.items as NotificationItem[],
    hasMore: activePage.nextCursor !== null,
    nextPageStatus: activePage.nextPageStatus,
    filter,
    onFilterChange: next => {
      setFilter(next)
      setSelectedId(null)
    },
    onLoadMore: () => void loadNextPage(),
    onRetry: () => void loadHistory(),
  }

  const detailSlice: NotificationDetailSlice = {
    status: detailStatus,
    value: detail,
    readPending,
    readError,
    onToggleRead: toggleRead,
    onRetryRead: toggleRead,
    onRetryDetail: () => { if (selectedId !== null) void loadDetail(selectedId) },
    onNavigate: path => navigate(path),
  }

  const bulkSlice: NotificationBulkSlice = {
    pending: bulkPending,
    message: bulkMessage,
    lastClearedBatchId,
    onReadAll: () => void requestReadAll(),
    onClearAll: () => void requestClearPreview(),
    onUndoClear: undoClear,
  }

  const recordsSlice: NotificationRecordsSlice = {
    open: recordsOpen,
    status: snapshot.batches.status,
    items: snapshot.batches.items as NotificationRecordsSlice['items'],
    onOpen: openRecords,
    onClose: closeRecords,
    onRestore: batchId => void restoreBatch(batchId),
  }

  /*
   * 过期判定一律在**服务端时钟**上做：把本机读数加上响应里采到的偏移。
   * 直接拿 `Date.now()` 比服务端 `expiresAt` 等于假定两台机器时钟一致 ——
   * 本机快一小时就会把还有 59 分钟有效的预览判成过期，慢一小时则反过来。
   * `previewClock` 只负责让这个判定在提交前重新算一次，不停留在打开确认框的那一刻。
   */
  const expired = preview !== null && preview.expiresAt <= Date.now() + preview.clockOffset
  const confirmSlice: NotificationConfirmSlice = {
    kind: confirm === null ? null : confirm.kind,
    count: confirm?.count ?? 0,
    pending: bulkPending !== null,
    expired,
    onCancel: () => setConfirm(null),
    onSubmit: () => {
      if (confirm?.kind === 'clear') void submitClear()
      else if (confirm?.kind === 'read-all') void submitReadAll()
    },
  }

  const countState: NotificationCountState = !authenticated
    ? { kind: 'hidden' }
    : snapshot.summary.status === 'error' ? { kind: 'error' }
      : snapshot.summary.status !== 'ready' ? { kind: 'loading' }
        : { kind: 'ready', count: snapshot.summary.unreadCount }

  return {
    snapshot,
    countState,
    authenticated,
    popupOpen,
    setPopupOpen,
    modalOpen,
    selectedId,
    bellRef,
    unreadStatus: snapshot.unread.status,
    unreadItems: snapshot.unread.items as NotificationItem[],
    list,
    detail: detailSlice,
    bulk: bulkSlice,
    records: recordsSlice,
    confirm: confirmSlice,
    previewClock,
    onSelect: select,
    onOpenModal: () => {
      setPopupOpen(false)
      setModalOpen(true)
    },
    onCloseModal: () => setModalOpen(false),
    onRetryUnread: () => void loadUnread(),
    refreshSummary: () => void loadSummary(),
  }
}

// ---- 工具 ----------------------------------------------------------------

function dedupe(items: NotificationItem[]): NotificationItem[] {
  const seen = new Set<string>()
  const output: NotificationItem[] = []
  for (const item of items) {
    if (seen.has(item.receiptId)) continue
    seen.add(item.receiptId)
    output.push(item)
  }
  return output
}

function findItem(items: readonly NotificationItem[], receiptId: string): NotificationItem | undefined {
  return items.find(item => item.receiptId === receiptId)
}

/**
 * 就地更新一行的已读状态。
 *
 * 只改 `readAt` 与 `stateRevision`：清理状态、过期与正文仍由服务端裁决，
 * 所以紧接着会重新读取当前页。
 */
function patchLocalItem(receiptId: string, stateRevision: number, read: boolean) {
  for (const slice of [notificationsConfig.unread, notificationsConfig.history]) {
    const index = slice.items.findIndex(item => item.receiptId === receiptId)
    if (index === -1) continue
    const current = slice.items[index]!
    slice.items[index] = { ...current, readAt: read ? current.deliveredAt : null, stateRevision }
  }
}

function currentToken(): string | null {
  try { return readToken(window.localStorage) }
  catch { return null }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 退化路径只保证形状合法；服务端仍按 (userId, requestId) 唯一裁决。
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function failureMessage(error: unknown, fallback = '操作失败，原状态已保留。请重试。') {
  if (error instanceof ExAxiosError) {
    if (error.code === 'SESSION_INVALID') return '登录状态已失效，请重新登录'
    if (error.status === 409) return '操作与当前状态冲突（409），已保留原状态。请核对后重试。'
    if (error.status === 410) return '预览或游标已过期，请重新预览。'
    return error.message
  }
  return fallback
}
