import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Dialog, DialogContent,
  DialogTitle, SelectContent, SelectField, SelectItem, SelectTrigger, SelectValue, Skeleton,
} from '@exre/exui'
import { NotificationBody, hasRenderableNotificationBody } from '@components/src/notifications/NotificationBody'
import { NotificationItemList } from '@components/src/notifications/NotificationItemList'
import {
  formatClearBatchTime,
  formatNotificationTime,
  isNotificationUnread,
  notificationActionReasonLabel,
  notificationCategoryLabel,
  notificationCopy,
  notificationStateLabel,
  type NotificationClearBatchView,
  type NotificationDetailView,
  type NotificationHistoryFilter,
  type NotificationItemView,
} from '@components/src/notifications/notificationsView'
import styles from '@components/src/notifications/NotificationHistoryModal.module.scss'

export type NotificationAsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface NotificationListSlice {
  status: NotificationAsyncStatus
  items: NotificationItemView[]
  hasMore: boolean
  nextPageStatus: 'idle' | 'loading' | 'error'
  filter: NotificationHistoryFilter
  onFilterChange: (filter: NotificationHistoryFilter) => void
  onLoadMore: () => void
  onRetry: () => void
}

export interface NotificationDetailSlice {
  status: NotificationAsyncStatus
  value: NotificationDetailView | null
  readPending: boolean
  readError: string | null
  onToggleRead: () => void
  onRetryRead: () => void
  onRetryDetail: () => void
  onNavigate: (path: string) => void
}

export interface NotificationBulkSlice {
  pending: 'read-all' | 'clear' | 'restore' | null
  message: string | null
  lastClearedBatchId: string | null
  onReadAll: () => void
  onClearAll: () => void
  onUndoClear: () => void
}

export interface NotificationRecordsSlice {
  open: boolean
  status: NotificationAsyncStatus
  items: NotificationClearBatchView[]
  onOpen: () => void
  onClose: () => void
  onRestore: (batchId: string) => void
}

export interface NotificationConfirmSlice {
  kind: 'clear' | 'read-all' | null
  count: number
  pending: boolean
  expired: boolean
  onCancel: () => void
  onSubmit: () => void
}

export interface NotificationHistoryModalProps {
  open: boolean
  onClose: () => void
  selectedId: string | null
  onSelect: (receiptId: string) => void
  list: NotificationListSlice
  detail: NotificationDetailSlice
  bulk: NotificationBulkSlice
  records: NotificationRecordsSlice
  confirm: NotificationConfirmSlice
  /** 关闭后焦点回到的元素（通常是铃铛）；由调用方决定，组件不假设顶栏结构。 */
  finalFocusRef?: React.RefObject<HTMLElement | null>
}

/**
 * 通知历史 Modal：左侧全部未清理历史，右侧选中通知正文。
 *
 * 移动端**不新增路由、不另开 Sheet**：仍是同一个 Modal，靠 `detailMode` 在列表与正文之间
 * 切换，返回时恢复列表滚动位置并把焦点还给原条目。桌面端两列同时可见。
 *
 * 两个列各自独立滚动，`DialogContent` 本身不滚动。
 */
export function NotificationHistoryModal(props: NotificationHistoryModalProps) {
  const narrow = useIsNarrow()
  const [detailMode, setDetailMode] = useState(false)
  const listScroll = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const filterId = `${useId()}-filter`

  const showDetailPane = detailMode || props.records.open

  useEffect(() => {
    if (!props.open) {
      setDetailMode(false)
      savedScrollTop.current = 0
    }
  }, [props.open])

  const select = (receiptId: string) => {
    if (narrow) {
      savedScrollTop.current = listScroll.current?.scrollTop ?? 0
      setDetailMode(true)
    }
    if (props.records.open) props.records.onClose()
    props.onSelect(receiptId)
  }

  const backToList = () => {
    setDetailMode(false)
    if (props.records.open) props.records.onClose()
    requestAnimationFrame(() => {
      if (listScroll.current) listScroll.current.scrollTop = savedScrollTop.current
      focusSelectedRow(listScroll.current, props.selectedId)
    })
  }

  const openRecords = () => {
    if (narrow) {
      savedScrollTop.current = listScroll.current?.scrollTop ?? 0
      setDetailMode(true)
    }
    props.records.onOpen()
  }

  const bulkPending = props.bulk.pending !== null

  return <Dialog open={props.open} onOpenChange={open => { if (!open && !bulkPending) props.onClose() }}>
    <DialogContent className={styles.dialog} closeLabel="关闭通知历史"
      aria-describedby={undefined}
      onOpenAutoFocus={event => {
        event.preventDefault()
        heading.current?.focus()
      }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        props.finalFocusRef?.current?.focus()
      }}>
      <div className={styles.head}>
        <DialogTitle ref={heading} tabIndex={-1} className={styles.title}>通知历史</DialogTitle>
      </div>

      <div className={`${styles.grid}${showDetailPane ? ` ${styles.detailMode}` : ''}`}>
        <section className={styles.listColumn} aria-label="通知列表">
          <div className={styles.listTools}>
            <div className={styles.actions}>
              <Button type="button" variant="outline" size="sm"
                disabled={props.list.status !== 'ready' || props.list.items.length === 0 || bulkPending}
                onClick={props.bulk.onClearAll}>清除全部</Button>
              <Button type="button" variant="outline" size="sm"
                disabled={props.list.status !== 'ready'
                  || !props.list.items.some(isNotificationUnread) || bulkPending}
                onClick={props.bulk.onReadAll}>全部已读</Button>
              <Button type="button" variant="ghost" size="sm"
                disabled={bulkPending} onClick={openRecords}>恢复清理记录</Button>
            </div>
            <div className={styles.filters}>
              <span className={styles.filterLabel} id={filterId}>显示</span>
              <SelectField value={props.list.filter}
                onValueChange={value => {
                  if (value === 'all' || value === 'unread') props.list.onFilterChange(value)
                }}>
                <SelectTrigger className={styles.filterTrigger} aria-labelledby={filterId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部历史</SelectItem>
                  <SelectItem value="unread">仅未读</SelectItem>
                </SelectContent>
              </SelectField>
              <span className={styles.count}>
                {notificationCopy.historyCount(props.list.items.length)}
              </span>
            </div>
          </div>

          <div ref={listScroll} className={styles.listScroll}>
            {props.list.status === 'error'
              ? <div className={styles.notice} role="alert">
                <p>通知暂时无法加载，计数未更新。</p>
                <Button type="button" variant="outline" size="sm"
                  onClick={props.list.onRetry}>重试加载</Button>
              </div>
              : props.list.status !== 'ready'
                ? <div role="status" aria-label="正在加载通知" className={styles.skeletons}>
                  <Skeleton className={styles.skeleton} />
                  <Skeleton className={styles.skeleton} />
                  <Skeleton className={styles.skeleton} />
                </div>
                : <>
                  <NotificationItemList items={props.list.items} selectedId={props.selectedId}
                    onSelect={select} empty={listEmptyState(props.list.filter)} />
                  {(props.list.hasMore || props.list.nextPageStatus !== 'idle') &&
                    <div className={styles.listFooter}>
                      {props.list.hasMore && <Button type="button" variant="outline" size="sm"
                        disabled={props.list.nextPageStatus === 'loading'}
                        onClick={props.list.onLoadMore}>
                        {props.list.nextPageStatus === 'loading' ? '正在加载' : '加载更多'}
                      </Button>}
                      {/*
                        分页失败后游标已被丢弃（`hasMore` 为 false），此时重试做的是
                        **从第一页重读**以换取一个新游标 —— 按钮文案必须照实说，
                        不能写成「重试下一页」却把整份列表重读一遍。
                      */}
                      {props.list.nextPageStatus === 'loading' && !props.list.hasMore &&
                        <p className={styles.pageRetrying} role="status">
                          {notificationCopy.pageRetrying}
                        </p>}
                      {props.list.nextPageStatus === 'error' &&
                        <div role="alert" className={styles.pageError}>
                          <p>{notificationCopy.nextPageError}</p>
                          <Button type="button" variant="ghost" size="sm"
                            onClick={props.list.onLoadMore}>{notificationCopy.retryNextPage}</Button>
                        </div>}
                    </div>}
                </>}
          </div>
        </section>

        <section className={styles.detailColumn} aria-label="通知正文">
          {showDetailPane &&
            <Button type="button" variant="ghost" size="sm" className={styles.backButton}
              onClick={backToList}>
              <ChevronLeft aria-hidden="true" />返回列表
            </Button>}
          {props.records.open
            ? <RecordsPanel records={props.records} pending={props.bulk.pending === 'restore'} />
            : <DetailPane {...props} narrow={narrow} />}
        </section>
      </div>

      {props.bulk.message &&
        <div className={styles.status} role="status">
          <span>{props.bulk.message}</span>
          {props.bulk.lastClearedBatchId && <Button type="button" variant="link" size="sm"
            className={styles.undo} disabled={bulkPending}
            onClick={props.bulk.onUndoClear}>撤销此次清理</Button>}
        </div>}

      <ConfirmDialog {...props.confirm} />
    </DialogContent>
  </Dialog>
}

function DetailPane(props: NotificationHistoryModalProps & { narrow: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const { detail, list, selectedId } = props
  const item = list.items.find(entry => entry.receiptId === selectedId) ?? null
  const value = detail.value !== null && detail.value.receiptId === selectedId ? detail.value : null

  useEffect(() => {
    if (selectedId !== null && props.narrow) heading.current?.focus()
  }, [selectedId, props.narrow])

  if (selectedId === null) {
    return <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>选择通知</h3>
      <p className={styles.emptyBody}>左侧是全部未清理历史。选择通知后，在这里查看正文与行动。</p>
    </div>
  }

  // 标题与元信息优先取列表条目：正文还在加载时右侧也已经可用，焦点目标因此稳定。
  const meta: NotificationItemView | null = item ?? (value === null ? null : {
    receiptId: value.receiptId,
    title: value.title,
    summaryText: '',
    scope: value.scope,
    category: value.category,
    necessity: value.necessity,
    sequence: value.sequence,
    deliveredAt: value.deliveredAt,
    readAt: value.readAt,
    expired: value.lifecycle === 'expired',
    stateRevision: value.stateRevision,
  })
  const retryDetail = (
    <div className={styles.notice} role="alert">
      <p>正文暂时无法加载。</p>
      <Button type="button" variant="outline" size="sm" onClick={detail.onRetryDetail}>重试正文</Button>
    </div>
  )

  return <article className={styles.detail}>
    {meta && <span className={styles.typeTag}>{notificationCategoryLabel(meta.category)}</span>}
    <h2 ref={heading} tabIndex={-1} className={styles.detailTitle}>{meta?.title ?? ''}</h2>
    {meta && <div className={styles.detailMeta}>
      <time dateTime={new Date(meta.deliveredAt).toISOString()}>
        {formatNotificationTime(meta.deliveredAt)}
      </time>
      <span>{notificationStateLabel(meta)}</span>
      {meta.necessity === 'necessary' && <Badge variant="secondary">必要通知</Badge>}
    </div>}

    {detail.status === 'loading' &&
      <div role="status" aria-label="正在加载正文"><Skeleton className={styles.bodySkeleton} /></div>}
    {detail.status === 'error' && retryDetail}
    {detail.status === 'ready' && value !== null && <>
      {value.lifecycle === 'expired' &&
        <p className={styles.expiredBanner}>这条通知已过期，保留正文供查阅。</p>}
      {hasRenderableNotificationBody(value.content, value.contentFallbackText)
        ? <NotificationBody content={value.content} fallbackText={value.contentFallbackText} />
        : retryDetail}
      <ActionRow detail={detail} disabled={props.bulk.pending !== null} />
      <div className={styles.readTools}>
        <Button type="button" variant="outline" size="sm"
          disabled={detail.readPending || props.bulk.pending !== null}
          onClick={detail.onToggleRead}>
          {value.readAt === null ? '标为已读' : '标为未读'}
        </Button>
        {value.lifecycle === 'expired' && <span className={styles.hint}>过期通知不计入未读。</span>}
      </div>
      {detail.readError &&
        <div className={styles.notice} role="alert">
          <p>{detail.readError}</p>
          <Button type="button" variant="ghost" size="sm" onClick={detail.onRetryRead}>重试标为已读</Button>
        </div>}
    </>}
  </article>
}

/**
 * Action 按钮只执行导航，不冒泡为「选中条目」「标已读」或「清理」。
 *
 * `enabled: false` 的按钮一律禁用并给出固定原因文案；当前没有真实业务 adapter，
 * 因此不存在任何会写业务状态的 Action。
 */
function ActionRow({ detail, disabled }: { detail: NotificationDetailSlice; disabled: boolean }) {
  const value = detail.value
  if (value === null || !value.actionsAvailable || value.actions.length === 0) return null
  return <div className={styles.actionRow}>
    <div className={styles.actionButtons}>
      {value.actions.map(action => {
        const reason = notificationActionReasonLabel(action.unavailableReason)
        return <Button key={action.actionId} type="button"
          variant={action.emphasis === 'primary' ? 'default' : 'outline'} size="sm"
          disabled={!action.enabled || disabled || action.navigationTarget === null}
          title={action.enabled ? undefined : reason || undefined}
          onClick={() => {
            if (action.navigationTarget !== null) detail.onNavigate(action.navigationTarget.path)
          }}>
          {action.label}
        </Button>
      })}
    </div>
    {value.actions.filter(action => !action.enabled).map(action =>
      <p key={`${action.actionId}-reason`} className={styles.actionReason}>
        {action.label}：{notificationActionReasonLabel(action.unavailableReason)}
      </p>)}
  </div>
}

function RecordsPanel({ records, pending }: {
  records: NotificationRecordsSlice
  pending: boolean
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <div className={styles.records}>
    <h2 ref={heading} tabIndex={-1} className={styles.recordsTitle}>恢复清理记录</h2>
    <p className={styles.recordsIntro}>仅显示你的清理批次。恢复保留原已读状态，过期通知不增加未读。</p>
    {records.status === 'error'
      ? <div className={styles.notice} role="alert"><p>清理记录暂时无法加载。</p></div>
      : records.status !== 'ready'
        ? <div role="status" aria-label="正在加载清理记录">
          <Skeleton className={styles.bodySkeleton} />
        </div>
        : records.items.length === 0
          ? <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>还没有清理记录</h3>
            <p className={styles.emptyBody}>执行清除全部后，可在这里恢复。</p>
          </div>
          : <div className={styles.batchList}>
            {records.items.map(batch => <article key={batch.batchId} className={styles.batch}>
              <h3 className={styles.batchDate}>{formatClearBatchTime(batch.createdAt)}</h3>
              <p className={styles.batchCounts}>
                <span>当时清理 {batch.affectedCount} 条</span>
                <span>当前可恢复 {batch.restorableCount} 条</span>
              </p>
              <Button type="button" variant="outline" size="sm"
                disabled={batch.restorableCount === 0 || pending}
                onClick={() => records.onRestore(batch.batchId)}>恢复此次清理</Button>
            </article>)}
          </div>}
  </div>
}

function ConfirmDialog(props: NotificationConfirmSlice) {
  if (props.kind === null) return null
  const clear = props.kind === 'clear'
  return <AlertDialog open onOpenChange={open => { if (!open && !props.pending) props.onCancel() }}>
    <AlertDialogContent className={styles.confirm} aria-describedby={undefined}>
      <AlertDialogHeader>
        <AlertDialogTitle>{clear ? '清除全部通知？' : '全部标为已读？'}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className={styles.confirmBody}>
            <p>{clear
              ? `将清理预览时的 ${props.count} 条通知，包括未读、已读和过期历史，覆盖所有分页。`
              : `将预览上界内的 ${props.count} 条未读通知标为已读，包含未加载的分页。新到通知保留未读。`}</p>
            {clear && <>
              <p>之后到达的通知会保留。可以撤销，也可在历史中的“恢复清理记录”中恢复。</p>
              <p className={styles.confirmNote}>清理消息不会取消活动参与。</p>
            </>}
            {props.expired && <p className={styles.confirmExpired} role="alert">预览已过期，请重新预览。</p>}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={props.pending} onClick={props.onCancel}>取消</AlertDialogCancel>
        <AlertDialogAction disabled={props.pending || props.expired} onClick={event => {
          event.preventDefault()
          props.onSubmit()
        }}>{props.pending ? '正在提交' : clear ? '确认清理' : '确认全部已读'}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

function listEmptyState(filter: NotificationHistoryFilter): ReactNode {
  if (filter === 'unread') {
    return <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>暂时没有未读通知</h3>
      <p className={styles.emptyBody}>当前历史均已读或已过期。可以切回全部历史。</p>
    </div>
  }
  return <div className={styles.empty}>
    <h3 className={styles.emptyTitle}>还没有通知历史</h3>
    <p className={styles.emptyBody}>收到的公告与个人通知会显示在这里。</p>
  </div>
}

function focusSelectedRow(container: HTMLDivElement | null, receiptId: string | null) {
  if (!container || receiptId === null) return
  const selector = `[data-notification-select="${escapeAttribute(receiptId)}"]`
  container.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
}

function escapeAttribute(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

/**
 * 与样式表同一断点：≤ 42rem 时列表与正文切换显示。
 *
 * 用 `matchMedia` 而不是宽度 state，避免在 resize 时把整个 Modal 重挂一遍。
 */
function useIsNarrow(query = '(max-width: 42rem)'): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const sync = () => setNarrow(list.matches)
    sync()
    list.addEventListener('change', sync)
    return () => list.removeEventListener('change', sync)
  }, [query])
  return narrow
}
