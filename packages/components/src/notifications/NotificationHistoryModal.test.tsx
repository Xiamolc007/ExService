// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationHistoryModal, type NotificationHistoryModalProps } from '@components/src/notifications/NotificationHistoryModal'
import type {
  NotificationItemView, NotificationDetailView, NotificationClearBatchView,
} from '@components/src/notifications/notificationsView'

afterEach(() => { cleanup(); restoreScrollIntoView() })

const originalScrollIntoView = Element.prototype.scrollIntoView
function restoreScrollIntoView() {
  if (originalScrollIntoView) Element.prototype.scrollIntoView = originalScrollIntoView
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
}

const item: NotificationItemView = {
  receiptId: 'receipt-1', title: '社区公告标题', summaryText: '这是摘要',
  scope: 'community', category: 'announcement', necessity: 'optional',
  sequence: 3, deliveredAt: Date.UTC(2026, 9, 8), readAt: null, expired: false, stateRevision: 1,
}
const readItem: NotificationItemView = { ...item, receiptId: 'receipt-2', title: '已读公告',
  readAt: Date.UTC(2026, 9, 8) }
const expiredItem: NotificationItemView = { ...item, receiptId: 'receipt-3', title: '过期公告',
  expired: true }

const detail: NotificationDetailView = {
  receiptId: 'receipt-1', title: '社区公告标题', scope: 'community', category: 'announcement',
  necessity: 'optional', sequence: 3, deliveredAt: Date.UTC(2026, 9, 8), readAt: null,
  clearedAt: null, lifecycle: 'active', stateRevision: 1, clearRevision: 0,
  contentAvailable: true,
  content: {
    format: 'html', schemaVersion: 1, policyVersion: 'notification-html-v1',
    html: '<p>正文段落</p>', text: '正文段落',
  },
  contentFallbackText: '正文段落',
  actions: [
    { actionId: 'open', label: '查看社区', emphasis: 'primary', enabled: true,
      unavailableReason: null, navigationTarget: { kind: 'internal', path: '/communities/rifling-911' } },
    { actionId: 'join', label: '加入', emphasis: 'secondary', enabled: false,
      unavailableReason: 'unsupported', navigationTarget: null },
  ],
  actionsAvailable: true,
}

const batch: NotificationClearBatchView = {
  batchId: 'batch-1', itemCount: 5, affectedCount: 4, skippedCount: 1, restorableCount: 4,
  status: 'applied', createdAt: Date.UTC(2026, 9, 8, 2, 12, 33), appliedAt: Date.UTC(2026, 9, 8),
  restoredAt: null,
}

function props(overrides: Partial<NotificationHistoryModalProps> = {}): NotificationHistoryModalProps {
  return {
    open: true,
    onClose: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    list: {
      status: 'ready', items: [item, readItem, expiredItem], hasMore: false,
      nextPageStatus: 'idle', filter: 'all', onFilterChange: vi.fn(),
      onLoadMore: vi.fn(), onRetry: vi.fn(),
    },
    detail: {
      status: 'idle', value: null, readPending: false, readError: null,
      onToggleRead: vi.fn(), onRetryRead: vi.fn(), onRetryDetail: vi.fn(), onNavigate: vi.fn(),
    },
    bulk: {
      pending: null, message: null, lastClearedBatchId: null,
      onReadAll: vi.fn(), onClearAll: vi.fn(), onUndoClear: vi.fn(),
    },
    records: { open: false, status: 'idle', items: [], onOpen: vi.fn(), onClose: vi.fn(), onRestore: vi.fn() },
    confirm: { kind: null, count: 0, pending: false, expired: false, onCancel: vi.fn(), onSubmit: vi.fn() },
    ...overrides,
  }
}

describe('NotificationHistoryModal', () => {
  it('opens with no selection and never auto-selects or reads the first row', () => {
    render(<NotificationHistoryModal {...props()} />)
    expect(screen.getByRole('heading', { name: '选择通知' })).toBeTruthy()
    expect(screen.getByText('左侧是全部未清理历史。选择通知后，在这里查看正文与行动。')).toBeTruthy()
    const titles = screen.getAllByRole('button').map(button => button.textContent)
    expect(titles).toContain('社区公告标题')
    expect(screen.queryByRole('button', { name: '标为已读' })).toBeNull()
  })

  it('shows every state in the list with a readable label instead of colour alone', () => {
    render(<NotificationHistoryModal {...props()} />)
    expect(screen.getAllByText('未读').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已读').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已过期').length).toBeGreaterThan(0)
  })

  /**
   * 计数措辞：Contract 不返回总数，所以只能说**已加载**多少条。
   * 说成「共 N 条」或「N 条历史」会被读成总数，而翻页还没到底时它并不是总数。
   */
  it('counts the loaded rows and never implies a total', () => {
    const { rerender } = render(<NotificationHistoryModal {...props({
      list: { ...props().list, items: [item, { ...item, receiptId: 'r-2' }] },
    })} />)
    expect(screen.getByText('已加载 2 条')).toBeTruthy()
    expect(screen.queryByText(/共 \d+ 条/)).toBeNull()
    expect(screen.queryByText(/\d+ 条历史/)).toBeNull()
    // 翻页后跟着变（仍是已加载量，不是总量）。
    rerender(<NotificationHistoryModal {...props({
      list: { ...props().list, hasMore: true, items: [item, { ...item, receiptId: 'r-2' },
        { ...item, receiptId: 'r-3' }] },
    })} />)
    expect(screen.getByText('已加载 3 条')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy()
  })

  it('selects a row through the shared list without writing state itself', async () => {
    const onSelect = vi.fn()
    render(<NotificationHistoryModal {...props({ onSelect })} />)
    await userEvent.click(screen.getByRole('button', { name: '社区公告标题' }))
    expect(onSelect).toHaveBeenCalledWith('receipt-1')
  })

  it('renders the selected body, marks the active action navigable and disables unsupported ones', async () => {
    const onNavigate = vi.fn()
    render(<NotificationHistoryModal {...props({
      selectedId: 'receipt-1',
      detail: { ...props().detail, status: 'ready', value: detail, onNavigate },
    })} />)
    expect(screen.getByRole('heading', { name: '社区公告标题' })).toBeTruthy()
    expect(screen.getByText('正文段落')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '查看社区' }))
    expect(onNavigate).toHaveBeenCalledWith('/communities/rifling-911')

    const disabled = screen.getByRole('button', { name: '加入' }) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    expect(disabled.title).toBe('此操作尚未接入。')
    expect(screen.getByText('加入：此操作尚未接入。')).toBeTruthy()
  })

  it('keeps the body readable after expiry and says expiry is not counted as unread', () => {
    render(<NotificationHistoryModal {...props({
      selectedId: 'receipt-1',
      detail: { ...props().detail, status: 'ready', value: { ...detail, lifecycle: 'expired' } },
    })} />)
    expect(screen.getByText('这条通知已过期，保留正文供查阅。')).toBeTruthy()
    expect(screen.getByText('过期通知不计入未读。')).toBeTruthy()
    expect(screen.getByText('正文段落')).toBeTruthy()
  })

  it('offers retry inside the detail pane when the body cannot be read', async () => {
    const onRetryDetail = vi.fn()
    render(<NotificationHistoryModal {...props({
      selectedId: 'receipt-1',
      detail: { ...props().detail, status: 'error', onRetryDetail },
    })} />)
    await userEvent.click(screen.getByRole('button', { name: '重试正文' }))
    expect(onRetryDetail).toHaveBeenCalledOnce()
  })

  it('asks for confirmation before a global clear and reports the previewed scope', async () => {
    const onSubmit = vi.fn()
    render(<NotificationHistoryModal {...props({
      confirm: { kind: 'clear', count: 12, pending: false, expired: false, onCancel: vi.fn(), onSubmit },
    })} />)
    expect(screen.getByRole('heading', { name: '清除全部通知？' })).toBeTruthy()
    expect(screen.getByText(/将清理预览时的 12 条通知/)).toBeTruthy()
    expect(screen.getByText('清理消息不会取消活动参与。')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '确认清理' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('blocks submission once the preview token has expired', () => {
    render(<NotificationHistoryModal {...props({
      confirm: { kind: 'clear', count: 12, pending: false, expired: true, onCancel: vi.fn(), onSubmit: vi.fn() },
    })} />)
    expect(screen.getByText('预览已过期，请重新预览。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '确认清理' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the affected and skipped counts plus a durable undo affordance', () => {
    render(<NotificationHistoryModal {...props({
      bulk: { pending: null, message: '已清理 4 条，跳过 1 条；新到通知仍保留。',
        lastClearedBatchId: 'batch-1', onReadAll: vi.fn(), onClearAll: vi.fn(), onUndoClear: vi.fn() },
    })} />)
    expect(screen.getByText('已清理 4 条，跳过 1 条；新到通知仍保留。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '撤销此次清理' })).toBeTruthy()
  })

  it('lists clear batches with the currently restorable count', () => {
    render(<NotificationHistoryModal {...props({
      records: { open: true, status: 'ready', items: [batch],
        onOpen: vi.fn(), onClose: vi.fn(), onRestore: vi.fn() },
    })} />)
    expect(screen.getByRole('heading', { name: '恢复清理记录' })).toBeTruthy()
    expect(screen.getByText('当时清理 4 条')).toBeTruthy()
    expect(screen.getByText('当前可恢复 4 条')).toBeTruthy()
  })

  it('never offers a restore entry for a batch with nothing left to restore', () => {
    render(<NotificationHistoryModal {...props({
      records: { open: true, status: 'ready',
        items: [{ ...batch, restorableCount: 0 }],
        onOpen: vi.fn(), onClose: vi.fn(), onRestore: vi.fn() },
    })} />)
    expect((screen.getByRole('button', { name: '恢复此次清理' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the empty state for cleared-out batches', () => {
    render(<NotificationHistoryModal {...props({
      records: { open: true, status: 'ready', items: [], onOpen: vi.fn(), onClose: vi.fn(), onRestore: vi.fn() },
    })} />)
    expect(screen.getByRole('heading', { name: '还没有清理记录' })).toBeTruthy()
  })

  it('keeps the unread-only filter empty state distinguishable from an empty history', () => {
    const view = render(<NotificationHistoryModal {...props({
      list: { ...props().list, items: [], filter: 'unread' },
    })} />)
    expect(screen.getByRole('heading', { name: '暂时没有未读通知' })).toBeTruthy()
    expect(screen.getByText('当前历史均已读或已过期。可以切回全部历史。')).toBeTruthy()
    view.unmount()

    render(<NotificationHistoryModal {...props({ list: { ...props().list, items: [] } })} />)
    expect(screen.getByRole('heading', { name: '还没有通知历史' })).toBeTruthy()
  })

  /**
   * 分页失败：保留已加载的行，只在这一页尾部给重试（设计 9.3）。
   *
   * 控制器此时已经把失效游标丢掉了（`hasMore` 为 false），所以重试做的是
   * **从第一页重读**换取新游标。按钮文案必须照实写「重新加载列表」——
   * 写「重试下一页」却重读整份列表，就是 B2 里「保留草稿」那样文案与行为互相矛盾。
   */
  it('retries a failed next page without discarding the loaded rows', async () => {
    const onLoadMore = vi.fn()
    render(<NotificationHistoryModal {...props({
      list: { ...props().list, hasMore: false, nextPageStatus: 'error', onLoadMore },
    })} />)
    expect(screen.getByText('下一页加载失败，已显示的通知保留。')).toBeTruthy()
    // 已加载的行仍然在，不能被错误面板顶掉。
    expect(screen.getAllByText('社区公告标题').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '重试下一页' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '重新加载列表' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('shows a reloading state instead of blanking the list while the retry is in flight', async () => {
    // 重读期间 `hasMore` 为 false 且 `nextPageStatus` 为 loading：列表必须留着，
    // 只给一个「正在重新加载…」，不能退回骨架（那等于把已加载内容抹掉）。
    render(<NotificationHistoryModal {...props({
      list: { ...props().list, hasMore: false, nextPageStatus: 'loading' },
    })} />)
    expect(screen.getByRole('status').textContent).toBe('正在重新加载…')
    expect(screen.getAllByText('社区公告标题').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
  })

  it('offers a list-level retry when the first page fails', async () => {
    const onRetry = vi.fn()
    render(<NotificationHistoryModal {...props({
      list: { ...props().list, status: 'error', items: [], onRetry },
    })} />)
    await userEvent.click(screen.getByRole('button', { name: '重试加载' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps both scroll containers so the list and the body scroll independently', () => {
    render(<NotificationHistoryModal {...props({ selectedId: 'receipt-1',
      detail: { ...props().detail, status: 'ready', value: detail } })} />)
    const list = screen.getByRole('region', { name: '通知列表' })
    const body = screen.getByRole('region', { name: '通知正文' })
    expect(list).toBeTruthy()
    expect(body).toBeTruthy()
    expect(list.contains(body)).toBe(false)
  })

  it('closes through the explicit header control', async () => {
    const onClose = vi.fn()
    render(<NotificationHistoryModal {...props({ onClose })} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭通知历史' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})
