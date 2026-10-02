import type { AppDatabase } from '@server/src/db/client.js'
import { withSidSerial } from './sid-serial.js'

type Target = { clientId: string; hydraSid: string; sessionId?: string; deliveryEventId?: string }
type Delivery = { eventId: string; sessionId: string }
type OutboxRow = {
  event_id: string; kind: 'session' | 'user'; session_id: string | null; user_id: string
  target_bindings: string; delivered_targets: string; attempts: number
}

const delays = [1000, 2000, 4000, 8000, 16000, 30000]

export class IdentityOutboxWorker {
  constructor(
    private readonly db: AppDatabase,
    private readonly revokeHydraSid: (sid: string) => Promise<void>,
    private readonly deliverOutline: (message: Delivery) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly reportError: (code: string) => void = () => undefined,
  ) {}

  /** Returns whether a due event was claimed, including a failed retry. */
  async drainOne(): Promise<boolean> {
    return this.db.transaction(async tx => {
      const row = (await tx.query<OutboxRow>(`SELECT event_id, kind, session_id, user_id,
        target_bindings, delivered_targets, attempts FROM auth_identity_outbox
        WHERE completed_at IS NULL AND next_attempt_at <= $1
        ORDER BY created_at, event_id FOR UPDATE SKIP LOCKED LIMIT 1`, [this.now()])).rows[0]
      if (!row) return false
      const targets = JSON.parse(row.target_bindings) as Target[]
      const delivered = new Set(JSON.parse(row.delivered_targets) as string[])
      let failed = false
      for (const target of targets) {
        // A legacy user event without a captured session cannot safely be
        // delivered after the account is re-enabled. Keep it pending instead
        // of broad-revoking every current Outline session for that user.
        if (row.kind === 'user' && (!target.sessionId || !target.deliveryEventId)) {
          this.reportError('INVALID_USER_TARGET_SNAPSHOT')
          failed = true
          break
        }
        const hydraKey = `hydra:${target.clientId}:${target.hydraSid}`
        if (!delivered.has(hydraKey)) {
          try {
            await withSidSerial(target.hydraSid, () => this.revokeHydraSid(target.hydraSid))
            delivered.add(hydraKey)
          }
          catch { failed = true; break }
        }
        if (target.clientId === 'ex-outline') {
          const outlineKey = `outline:${target.clientId}:${target.hydraSid}`
          if (!delivered.has(outlineKey)) {
            try {
              const sessionId = row.kind === 'session' ? row.session_id : target.sessionId
              if (!sessionId) throw new Error('Outbox target session is missing')
              await this.deliverOutline({ eventId: row.kind === 'session' ? row.event_id : target.deliveryEventId!,
                sessionId })
              delivered.add(outlineKey)
            } catch { failed = true; break }
          }
        }
      }
      const now = this.now()
      const attempts = row.attempts + 1
      await tx.query(`UPDATE auth_identity_outbox SET delivered_targets = $1, attempts = $2,
        next_attempt_at = $3, completed_at = $4 WHERE event_id = $5`,
      [JSON.stringify([...delivered]), attempts,
        failed ? now + delays[Math.min(attempts - 1, delays.length - 1)]! : now,
        failed ? null : now, row.event_id])
      return true
    })
  }
}

function rootUrl(value: string, name: string): URL {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' ||
    url.username || url.password || url.search || url.hash) throw new Error(`${name} must be a root URL`)
  return url
}

/** External destinations use dedicated internal URLs and one-second calls. */
export function configuredIdentityOutboxWorker(db: AppDatabase): IdentityOutboxWorker {
  const hydra = rootUrl(process.env.HYDRA_ADMIN_URL ?? '', 'HYDRA_ADMIN_URL')
  const outline = rootUrl(process.env.OUTLINE_INTERNAL_URL ?? '', 'OUTLINE_INTERNAL_URL')
  const key = process.env.IDENTITY_DELIVERY_KEY
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('IDENTITY_DELIVERY_KEY is invalid')
  return new IdentityOutboxWorker(db, async sid => {
    const url = new URL('/admin/oauth2/auth/sessions/login', hydra)
    url.searchParams.set('sid', sid)
    const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(1000) })
    if (!response.ok && response.status !== 404) throw new Error('Hydra sid revocation failed')
  }, async message => {
    const response = await fetch(new URL('/internal/identity/revoke', outline), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Identity-Delivery-Key': key },
      body: JSON.stringify(message), signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) throw new Error('Outline revocation delivery failed')
  }, Date.now, code => { console.error(`[identity-outbox] ${code}`) })
}

export function startIdentityOutboxWorker(worker: IdentityOutboxWorker): () => void {
  let busy = false
  const run = async () => {
    if (busy) return
    busy = true
    try { while (await worker.drainOne()) { /* claim all due work */ } }
    catch { /* durable rows remain due; retry on next tick */ }
    finally { busy = false }
  }
  const timer = setInterval(() => void run(), 500)
  void run()
  return () => clearInterval(timer)
}
