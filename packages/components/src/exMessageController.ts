import { toast } from '@exre/exui'
import type { ReactNode } from 'react'

export type ExMessagePlacement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type ExMessageProps = {
  duration?: number
  placement?: ExMessagePlacement
  maxCount?: number
}

export type MessageOptions = { duration?: number }

export type LoadingHandle = {
  onSuccess(content: ReactNode, options?: MessageOptions): void
  onError(content: ReactNode, options?: MessageOptions): void
  dismiss(): void
}

type Phase = 'ordinary' | 'loading' | 'completed'
type Entry = { id: string | number; phase: Phase; timer?: ReturnType<typeof setTimeout> }
type MessageKind = 'info' | 'warning' | 'error'
type Config = { duration: number; maxCount: number }

const entries = new Map<string | number, Entry>()
let owner: symbol | undefined
let config: Config = { duration: 3000, maxCount: 3 }

function positiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('ExMessage duration must be a positive finite number of milliseconds.')
  }
  return value
}

function positiveCount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('ExMessage maxCount must be a positive integer.')
  }
  return value
}

export function resolveConfig(props: ExMessageProps): Config {
  return {
    duration: positiveDuration(props.duration ?? 3000),
    maxCount: positiveCount(props.maxCount ?? 3),
  }
}

function requireHost(): void {
  if (!owner) throw new Error('ExMessage requires a mounted host.')
}

function forget(id: string | number): boolean {
  const entry = entries.get(id)
  if (!entry) return false
  if (entry.timer) clearTimeout(entry.timer)
  entries.delete(id)
  return true
}

function dismiss(id: string | number): void {
  if (forget(id)) toast.dismiss(id)
}

function trimTo(limit: number): void {
  while (entries.size > limit) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    dismiss(oldest)
  }
}

function closeCallbacks() {
  return {
    onDismiss: (closed: { id: string | number }) => { forget(closed.id) },
    onAutoClose: (closed: { id: string | number }) => { forget(closed.id) },
  }
}

export function mountMessageHost(token: symbol, next: Config): void {
  if (owner && owner !== token) throw new Error('Only one ExMessage host may be mounted.')
  owner = token
  updateMessageHost(token, next)
}

export function updateMessageHost(token: symbol, next: Config): void {
  if (owner !== token) return
  config = next
  trimTo(config.maxCount)
}

export function unmountMessageHost(token: symbol): void {
  if (owner !== token) return
  for (const id of [...entries.keys()]) dismiss(id)
  owner = undefined
  config = { duration: 3000, maxCount: 3 }
}

export function showMessage(kind: MessageKind, content: ReactNode, options?: MessageOptions): string | number {
  requireHost()
  const duration = positiveDuration(options?.duration ?? config.duration)
  trimTo(config.maxCount - 1)
  const id = toast[kind](content, { duration, ...closeCallbacks() })
  entries.set(id, { id, phase: 'ordinary' })
  return id
}

export function showLoading(content: ReactNode, options?: MessageOptions): LoadingHandle {
  requireHost()
  const timeout = options?.duration === undefined ? undefined : positiveDuration(options.duration)
  trimTo(config.maxCount - 1)
  const id = toast.loading(content, { ...closeCallbacks() })
  const entry: Entry = { id, phase: 'loading' }
  entries.set(id, entry)
  if (timeout !== undefined) entry.timer = setTimeout(() => dismiss(id), timeout)

  function complete(kind: 'success' | 'error', nextContent: ReactNode, nextOptions?: MessageOptions): void {
    if (entries.get(id) !== entry || entry.phase !== 'loading') return
    const duration = positiveDuration(nextOptions?.duration ?? config.duration)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
    entry.phase = 'completed'
    toast[kind](nextContent, { id, duration, ...closeCallbacks() })
  }

  return {
    onSuccess: (nextContent, nextOptions) => complete('success', nextContent, nextOptions),
    onError: (nextContent, nextOptions) => complete('error', nextContent, nextOptions),
    dismiss: () => dismiss(id),
  }
}
