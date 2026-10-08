import { randomUUID } from 'node:crypto'
import type { AppDatabase, SqlExecutor } from '@server/src/db/client.js'
import { NotificationError } from './errors.js'
import {
  CLEAR_TOKEN_TTL_MS, DEFAULT_PREFERENCES, NECESSARY_CATEGORIES, READ_THROUGH_TOKEN_TTL_MS,
  isNotificationCategory, isNotificationScope, type NotificationCategory, type NotificationScope,
} from './catalog.js'
import { resolveActions, parseStoredActions } from './actions.js'
import { sanitizeNotificationHtml } from './html/sanitize.js'
import { normalizeDigest } from './producer.js'
import { signCursor, signToken, verifyCursor, verifyToken } from './tokens.js'
import type { NotificationRepository, ReceiptListRow } from './repository.js'

/**
 * 通知查询与个人状态命令。
 *
 * 所有方法都以 userId 为第一约束，不提供跨用户读取路径。
 * 批量命令按 `(userId, requestId)` 去重：同 key 同摘要返回原终态，
 * 异摘要返回 409；成功后丢响应时重放不会覆盖后来的未读/恢复。
 */

export interface NotificationServicesOptions {
  repository: NotificationRepository
  db: AppDatabase
  tokenKey: Buffer
  now: () => number
  createId?: () => string
}

export interface NotificationListResult {
  items: Array<{
    receiptId: string
    title: string
    summaryText: string
    scope: NotificationScope
    category: NotificationCategory
    necessity: 'optional' | 'necessary'
    sequence: number
    deliveredAt: number
    readAt: number | null
    expired: boolean
    stateRevision: number
  }>
  nextCursor: string | null
  unreadCount: number
  upperSequence: number
  readThroughToken: string
  serverTime: number
}

export interface NotificationSummaryResult {
  unreadCount: number
  stateVersion: number
  upperSequence: number
  readThroughToken: string
  serverTime: number
}

export interface NotificationDetailResult {
  receiptId: string
  title: string
  scope: NotificationScope
  category: NotificationCategory
  necessity: 'optional' | 'necessary'
  sequence: number
  deliveredAt: number
  readAt: number | null
  clearedAt: number | null
  lifecycle: 'active' | 'expired'
  stateRevision: number
  clearRevision: number
  contentAvailable: boolean
  content: { format: 'html'; schemaVersion: 1; policyVersion: string; html: string; text: string } | null
  contentFallbackText: string | null
  actions: Array<{
    actionId: string
    kind: 'navigate' | 'command'
    label: string
    emphasis: 'primary' | 'secondary'
    enabled: boolean
    unavailableReason: 'unsupported' | 'expired' | 'forbidden' | 'state_changed' | null
    navigationTarget: { kind: 'internal'; path: string } | null
  }>
  actionsAvailable: boolean
  serverTime: number
}

export interface NotificationStateResult {
  receiptId: string
  read: boolean
  stateRevision: number
  unreadCount: number
  serverTime: number
}

export interface ReadThroughResult {
  requestId: string
  affectedCount: number
  watermarkSequence: number
  unreadCount: number
  replayed: boolean
  serverTime: number
}

export interface ClearPreviewResult {
  batchId: string
  itemCount: number
  upperSequence: number
  clearSnapshotToken: string
  expiresAt: number
  serverTime: number
}

export interface ClearResult {
  requestId: string
  batchId: string
  affectedCount: number
  skippedCount: number
  unreadCount: number
  replayed: boolean
  serverTime: number
}

export interface ClearBatchListResult {
  items: Array<{
    batchId: string
    itemCount: number
    affectedCount: number
    skippedCount: number
    restorableCount: number
    status: 'applied' | 'restored' | 'partial'
    createdAt: number
    appliedAt: number | null
    restoredAt: number | null
  }>
  nextCursor: string | null
  serverTime: number
}

export interface PreferencesResult {
  revision: number
  optionalCategories: { announcement: boolean; personal_update: boolean }
  necessaryCategories: NotificationCategory[]
  serverTime: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const DEFAULT_BATCH_LIMIT = 20

export class NotificationService {
  constructor(private readonly options: NotificationServicesOptions) {}

  async list(params: {
    userId: string
    view: 'unread' | 'history'
    scope: string | null
    category: string | null
    limit: number | null
    cursor: string | null
  }): Promise<NotificationListResult> {
    const now = this.options.now()
    const limit = clampLimit(params.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const scope = parseScope(params.scope)
    const category = parseCategory(params.category)

    const upperSequence = await this.options.repository.upperSequence(params.userId)
    let afterSequence: number | null = null
    if (params.cursor !== null) {
      const claims = verifyCursor(this.options.tokenKey, params.cursor, params.userId, now)
      if (claims.v !== params.view || claims.s !== (scope ?? '') || claims.c !== (category ?? '') ||
        claims.up !== upperSequence) {
        throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
      }
      afterSequence = typeof claims.a === 'number' ? claims.a : null
      if (afterSequence === null) throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
    }

    // 比 limit 多读一条，用来判断是否还有下一页。
    const rows = await this.options.repository.listReceipts({
      userId: params.userId, now, view: params.view, scope, category,
      limit: limit + 1, afterSequence, upperSequence,
    })
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    const hasMore = rows.length > limit
    const nextCursor = hasMore && last !== undefined
      ? signCursor(this.options.tokenKey, params.userId, now, {
        v: params.view, s: scope ?? '', c: category ?? '', up: upperSequence, a: last.sequence,
      })
      : null

    const unreadCount = await this.options.repository.countUnread(params.userId, now)
    return {
      items: page.map(row => ({
        receiptId: row.receipt_id,
        title: row.title,
        summaryText: row.summary_text,
        scope: row.scope,
        category: row.category,
        necessity: row.necessity,
        sequence: row.sequence,
        deliveredAt: row.delivered_at,
        readAt: row.read_at,
        expired: isExpired(row, now),
        stateRevision: row.state_revision,
      })),
      nextCursor,
      unreadCount,
      upperSequence,
      readThroughToken: this.readThroughToken(params.userId, now, upperSequence),
      serverTime: now,
    }
  }

  async summary(userId: string): Promise<NotificationSummaryResult> {
    const now = this.options.now()
    const [unreadCount, upperSequence, stateVersion] = await Promise.all([
      this.options.repository.countUnread(userId, now),
      this.options.repository.upperSequence(userId),
      this.stateVersion(userId),
    ])
    return {
      unreadCount,
      stateVersion,
      upperSequence,
      readThroughToken: this.readThroughToken(userId, now, upperSequence),
      serverTime: now,
    }
  }

  async detail(userId: string, notificationId: string): Promise<NotificationDetailResult> {
    const now = this.options.now()
    const receipt = await this.options.repository.findReceipt(notificationId, userId, now)
    if (receipt === undefined) throw new NotificationError('NOTIFICATION_NOT_FOUND')
    return this.toDetail(receipt, now)
  }

  async updateState(userId: string, notificationId: string, read: boolean,
    expectedRevision: number): Promise<NotificationStateResult> {
    const now = this.options.now()
    return await this.options.db.transaction(async tx => {
      await this.options.repository.lockUser(userId, tx)
      const receipt = await this.options.repository.findReceiptForUpdate(notificationId, userId, now, tx)
      if (receipt === undefined) throw new NotificationError('NOTIFICATION_NOT_FOUND')
      if (receipt.state_revision !== expectedRevision) {
        throw new NotificationError('NOTIFICATION_STATE_CONFLICT')
      }
      // no-op 不递增 revision，也不报错。
      const already = read ? receipt.read_at !== null : receipt.read_at === null
      const revision = already
        ? receipt.state_revision
        : await this.options.repository.setStateRevision(
          notificationId, userId, read, expectedRevision, now, tx)
      if (revision === null) throw new NotificationError('NOTIFICATION_STATE_CONFLICT')
      const unreadCount = await this.options.repository.countUnread(userId, now, tx)
      return { receiptId: notificationId, read, stateRevision: revision, unreadCount, serverTime: now }
    })
  }

  async readThrough(userId: string, requestId: string, token: string): Promise<ReadThroughResult> {
    const now = this.options.now()
    const claims = verifyToken(this.options.tokenKey, token, 'read_through', userId, now)
    const upperSequence = typeof claims.s === 'number' ? claims.s : null
    if (upperSequence === null) throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
    const digest = normalizeDigest({ kind: 'read_through', upperSequence })

    return await this.options.db.transaction(async tx => {
      const replay = await this.claimMutation(userId, requestId, 'read_through', digest, tx)
      if (replay !== null) return { ...(JSON.parse(replay) as ReadThroughResult), replayed: true, serverTime: now }

      await this.options.repository.lockUser(userId, tx)
      await this.options.repository.lockStream(userId, tx)
      const affectedCount = await this.options.repository.markReadThrough(userId, now, upperSequence, tx)
      await this.options.repository.bumpStream(userId, tx)
      const unreadCount = await this.options.repository.countUnread(userId, now, tx)
      const result: ReadThroughResult = {
        requestId, affectedCount, watermarkSequence: upperSequence, unreadCount, replayed: false, serverTime: now,
      }
      await this.options.repository.insertMutation({
        userId, requestId, kind: 'read_through', digest, resultJson: JSON.stringify(result),
        clearBatchId: null, createdAt: now,
      }, tx)
      return result
    })
  }

  async previewClear(userId: string): Promise<ClearPreviewResult> {
    const now = this.options.now()
    return await this.options.db.transaction(async tx => {
      await this.options.repository.lockUser(userId, tx)
      const stream = await this.options.repository.lockStream(userId, tx)
      const snapshot = await this.options.repository.unclearedSnapshot(userId, now, tx)
      // 顺手扫掉已经过期、再也不可能提交的 preview 批次：反复点开「清除全部」不再线性累积。
      // 仍在有效期内的预览必须保留 —— 设计 9.2 要求旧预览仍能提交并对已变化的项记 skipped。
      await this.options.repository.discardExpiredPreviewBatches(userId, now, tx)
      const batchId = this.options.createId?.() ?? randomUUID()
      const snapshotId = this.options.createId?.() ?? randomUUID()
      const expiresAt = now + CLEAR_TOKEN_TTL_MS
      await this.options.repository.insertClearBatch({
        batch_id: batchId,
        user_id: userId,
        snapshot_id: snapshotId,
        upper_sequence: stream.lastSequence,
        preview_expires_at: expiresAt,
        status: 'preview',
        request_id: null,
        item_count: snapshot.length,
        affected_count: null,
        skipped_count: null,
        created_at: now,
        applied_at: null,
        restored_at: null,
      }, snapshot, tx)
      return {
        batchId,
        itemCount: snapshot.length,
        upperSequence: stream.lastSequence,
        clearSnapshotToken: signToken(this.options.tokenKey, 'clear_snapshot', userId, now, CLEAR_TOKEN_TTL_MS, {
          b: batchId, n: snapshot.length, s: stream.lastSequence,
        }),
        expiresAt,
        serverTime: now,
      }
    })
  }

  async clearSnapshot(userId: string, requestId: string, token: string): Promise<ClearResult> {
    const now = this.options.now()
    const claims = verifyToken(this.options.tokenKey, token, 'clear_snapshot', userId, now)
    const batchId = typeof claims.b === 'string' ? claims.b : null
    if (batchId === null) throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
    const digest = normalizeDigest({ kind: 'clear', batchId })

    return await this.options.db.transaction(async tx => {
      const replay = await this.claimMutation(userId, requestId, 'clear', digest, tx)
      if (replay !== null) return { ...(JSON.parse(replay) as ClearResult), replayed: true, serverTime: now }

      await this.options.repository.lockUser(userId, tx)
      await this.options.repository.lockStream(userId, tx)
      const batch = await this.options.repository.findClearBatchForUpdate(batchId, userId, tx)
      if (batch === undefined) throw new NotificationError('NOTIFICATION_BATCH_NOT_FOUND')
      if (batch.status !== 'preview') throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
      if (batch.preview_expires_at <= now) throw new NotificationError('NOTIFICATION_TOKEN_EXPIRED')

      const { affected, skipped } = await this.options.repository.applyClearBatch(batchId, userId, now, tx)
      await tx.query(`UPDATE notification_clear_batches SET status = 'applied', request_id = $3,
        affected_count = $4, skipped_count = $5, applied_at = $6 WHERE batch_id = $1 AND user_id = $2`,
      [batchId, userId, requestId, affected, skipped, now])
      await this.options.repository.bumpStream(userId, tx)
      const unreadCount = await this.options.repository.countUnread(userId, now, tx)
      const result: ClearResult = {
        requestId, batchId, affectedCount: affected, skippedCount: skipped, unreadCount,
        replayed: false, serverTime: now,
      }
      await this.options.repository.insertMutation({
        userId, requestId, kind: 'clear', digest, resultJson: JSON.stringify(result),
        clearBatchId: batchId, createdAt: now,
      }, tx)
      return result
    })
  }

  async listClearBatches(userId: string, limit: number | null,
    cursor: string | null): Promise<ClearBatchListResult> {
    const now = this.options.now()
    const size = clampLimit(limit, DEFAULT_BATCH_LIMIT, MAX_LIMIT)
    let afterCreatedAt: number | null = null
    let afterBatchId: string | null = null
    if (cursor !== null) {
      const claims = verifyCursor(this.options.tokenKey, cursor, userId, now)
      if (claims.v !== 'clear_batches') throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
      afterCreatedAt = typeof claims.c === 'number' ? claims.c : null
      afterBatchId = typeof claims.b === 'string' ? claims.b : null
      if (afterCreatedAt === null || afterBatchId === null) {
        throw new NotificationError('NOTIFICATION_TOKEN_INVALID')
      }
    }

    const rows = await this.options.repository.listClearBatches(userId, size + 1, afterCreatedAt, afterBatchId)
    const page = rows.slice(0, size)
    const last = page.at(-1)
    const nextCursor = rows.length > size && last !== undefined
      ? signCursor(this.options.tokenKey, userId, now, { v: 'clear_batches', c: last.created_at, b: last.batch_id })
      : null

    const items = []
    for (const batch of page) {
      const restorableCount = await this.options.repository.restorableCount(batch.batch_id, userId)
      const status: 'applied' | 'restored' | 'partial' =
        batch.status === 'restored' ? 'restored' : restorableCount === 0 ? 'applied' : 'partial'
      items.push({
        batchId: batch.batch_id,
        itemCount: batch.item_count,
        affectedCount: batch.affected_count ?? 0,
        skippedCount: batch.skipped_count ?? 0,
        restorableCount,
        status,
        createdAt: batch.created_at,
        appliedAt: batch.applied_at,
        restoredAt: batch.restored_at,
      })
    }
    return { items, nextCursor, serverTime: now }
  }

  async restoreBatch(userId: string, batchId: string, requestId: string): Promise<ClearResult> {
    const now = this.options.now()
    const digest = normalizeDigest({ kind: 'restore', batchId })
    return await this.options.db.transaction(async tx => {
      const replay = await this.claimMutation(userId, requestId, 'restore', digest, tx)
      if (replay !== null) return { ...(JSON.parse(replay) as ClearResult), replayed: true, serverTime: now }

      await this.options.repository.lockUser(userId, tx)
      await this.options.repository.lockStream(userId, tx)
      const batch = await this.options.repository.findClearBatchForUpdate(batchId, userId, tx)
      if (batch === undefined || batch.status === 'preview') {
        throw new NotificationError('NOTIFICATION_BATCH_NOT_FOUND')
      }
      const { affected, skipped } = await this.options.repository.restoreClearBatch(batchId, userId, tx)
      if (affected > 0) {
        await tx.query(`UPDATE notification_clear_batches SET status = 'restored', restored_at = $3
          WHERE batch_id = $1 AND user_id = $2`, [batchId, userId, now])
      }
      await this.options.repository.bumpStream(userId, tx)
      const unreadCount = await this.options.repository.countUnread(userId, now, tx)
      const result: ClearResult = {
        requestId, batchId, affectedCount: affected, skippedCount: skipped, unreadCount,
        replayed: false, serverTime: now,
      }
      await this.options.repository.insertMutation({
        userId, requestId, kind: 'restore', digest, resultJson: JSON.stringify(result),
        clearBatchId: batchId, createdAt: now,
      }, tx)
      return result
    })
  }

  async getPreferences(userId: string): Promise<PreferencesResult> {
    const stored = await this.options.repository.getPreferences(userId)
    return {
      revision: stored?.revision ?? 0,
      optionalCategories: {
        announcement: stored?.announcementEnabled ?? DEFAULT_PREFERENCES.announcement,
        personal_update: stored?.personalUpdateEnabled ?? DEFAULT_PREFERENCES.personal_update,
      },
      necessaryCategories: [...NECESSARY_CATEGORIES],
      serverTime: this.options.now(),
    }
  }

  async updatePreferences(userId: string, expectedRevision: number,
    optionalCategories: { announcement: boolean; personal_update: boolean }): Promise<PreferencesResult> {
    const now = this.options.now()
    return await this.options.db.transaction(async tx => {
      await this.options.repository.lockUser(userId, tx)
      const revision = await this.options.repository.savePreferences(userId, {
        announcementEnabled: optionalCategories.announcement,
        personalUpdateEnabled: optionalCategories.personal_update,
      }, expectedRevision, now, tx)
      if (revision === null) throw new NotificationError('NOTIFICATION_PREFERENCES_CONFLICT')
      return {
        revision,
        optionalCategories: {
          announcement: optionalCategories.announcement,
          personal_update: optionalCategories.personal_update,
        },
        necessaryCategories: [...NECESSARY_CATEGORIES],
        serverTime: now,
      }
    })
  }

  private readThroughToken(userId: string, now: number, upperSequence: number): string {
    return signToken(this.options.tokenKey, 'read_through', userId, now, READ_THROUGH_TOKEN_TTL_MS, {
      s: upperSequence,
    })
  }

  /** 同 key 同摘要返回原终态；异摘要冲突。 */
  private async claimMutation(userId: string, requestId: string, kind: 'read_through' | 'clear' | 'restore',
    digest: string, tx: SqlExecutor): Promise<string | null> {
    const existing = await this.options.repository.findMutation(userId, requestId, kind, tx)
    if (existing === undefined) return null
    if (existing.digest !== digest) throw new NotificationError('NOTIFICATION_REQUEST_CONFLICT')
    return existing.result_json
  }

  private async stateVersion(userId: string): Promise<number> {
    const result = await this.options.repository.db.query<{ state_version: number }>(
      'SELECT state_version FROM notification_user_streams WHERE user_id = $1', [userId])
    return result.rows[0]?.state_version ?? 0
  }

  private async toDetail(receipt: ReceiptListRow, now: number): Promise<NotificationDetailResult> {
    const expired = isExpired(receipt, now)
    const content = await this.options.repository.findContent(receipt.content_id)
    let contentPayload: NotificationDetailResult['content'] = null
    let fallbackText: string | null = null
    if (content === undefined) {
      fallbackText = null
    } else {
      // 普通读取必须重新满足当前策略；不复用可能已过期的安全判断。
      const outcome = sanitizeNotificationHtml(content.html)
      if (outcome.ok) {
        contentPayload = {
          format: 'html',
          schemaVersion: 1,
          policyVersion: 'notification-html-v1',
          html: outcome.result.html,
          text: outcome.result.text,
        }
      } else {
        fallbackText = content.text
      }
    }

    let actions: NotificationDetailResult['actions'] = []
    let actionsAvailable = false
    if (content !== undefined) {
      try {
        const stored = parseStoredActions(content.actions_json)
        const resolved = resolveActions(stored, { expired, visible: true })
        actions = resolved.actions
        actionsAvailable = resolved.available
      } catch {
        // Action 数据验证失败则禁用该区，不影响正文展示。
        actions = []
        actionsAvailable = false
      }
    }

    return {
      receiptId: receipt.receipt_id,
      title: receipt.title,
      scope: receipt.scope,
      category: receipt.category,
      necessity: receipt.necessity,
      sequence: receipt.sequence,
      deliveredAt: receipt.delivered_at,
      readAt: receipt.read_at,
      clearedAt: receipt.cleared_at,
      lifecycle: expired ? 'expired' : 'active',
      stateRevision: receipt.state_revision,
      clearRevision: receipt.clear_revision,
      contentAvailable: contentPayload !== null,
      content: contentPayload,
      contentFallbackText: fallbackText,
      actions,
      actionsAvailable,
      serverTime: now,
    }
  }
}

function clampLimit(value: number | null, fallback: number, max: number): number {
  if (value === null || !Number.isSafeInteger(value)) return fallback
  return Math.min(Math.max(value, 1), max)
}

function parseScope(value: string | null): NotificationScope | null {
  if (value === null || value === 'all') return null
  if (!isNotificationScope(value)) throw new NotificationError('CONTENT_UNSAFE')
  return value
}

function parseCategory(value: string | null): NotificationCategory | null {
  if (value === null) return null
  if (!isNotificationCategory(value)) throw new NotificationError('CONTENT_UNSAFE')
  return value
}

function isExpired(row: ReceiptListRow, now: number): boolean {
  return row.expires_at !== null && row.expires_at <= now
}
