// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, toast, useTheme } from '@exre/exui'
import { StrictMode, useEffect, useLayoutEffect } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ExMessage } from './ExMessage'
import type { ExMessageProps } from './ExMessage'

function host(props: ExMessageProps = {}) {
  return render(<ThemeProvider><ExMessage {...props} /></ThemeProvider>)
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ExMessage', () => {
  it('requires one mounted host and renders through the ExUI toaster', async () => {
    expect(() => ExMessage.info('too early')).toThrow('mounted host')
    const view = host()
    act(() => { ExMessage.info('hello') })
    expect(await screen.findByText('hello')).toBeTruthy()
    expect(document.querySelector('[data-sonner-toaster]')?.getAttribute('data-y-position')).toBe('top')
    expect(document.querySelector('[data-sonner-toaster]')?.getAttribute('data-x-position')).toBe('right')
    view.unmount()
    expect(() => ExMessage.info('too late')).toThrow('mounted host')
  })

  it.each([
    'top-left', 'top-center', 'top-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ] as const)('supports %s placement', async (placement) => {
    host({ placement })
    act(() => { ExMessage.info('placed') })
    await screen.findByText('placed')
    const toaster = document.querySelector('[data-sonner-toaster]')
    expect(toaster?.getAttribute('data-y-position')).toBe(placement.split('-')[0])
    expect(toaster?.getAttribute('data-x-position')).toBe(placement.split('-')[1])
  })

  it('uses the configured duration and each ordinary message override', async () => {
    host({ duration: 4000 })
    let first: string | number = ''
    let second: string | number = ''
    act(() => {
      first = ExMessage.info('first')
      second = ExMessage.warn('second', { duration: 6000 })
    })
    const active = toast.getToasts().filter((item) => !('dismiss' in item))
    expect(active.find((item) => item.id === first)).toMatchObject({ duration: 4000 })
    expect(active.find((item) => item.id === second)).toMatchObject({ duration: 6000 })
    expect(await screen.findByText('second')).toBeTruthy()
  })

  it('evicts the oldest active message and trims immediately when maxCount falls', async () => {
    const view = host({ maxCount: 3 })
    let ids: Array<string | number> = []
    act(() => {
      ids = [ExMessage.info('one'), ExMessage.warn('two'), ExMessage.error('three')]
      ExMessage.info('four')
    })
    expect(toast.getToasts().some((item) => item.id === ids[0])).toBe(false)
    expect(await screen.findByText('four')).toBeTruthy()
    view.rerender(<ThemeProvider><ExMessage maxCount={1} /></ThemeProvider>)
    expect(toast.getToasts().some((item) => item.id === ids[1] || item.id === ids[2])).toBe(false)
    expect(toast.getToasts().length).toBe(1)
  })

  it('keeps loading active until completion and updates its original ID', () => {
    vi.useFakeTimers()
    host({ duration: 4000 })
    let handle!: ReturnType<typeof ExMessage.loading>
    act(() => { handle = ExMessage.loading('saving') })
    const id = toast.getToasts().find((item) => !('dismiss' in item) && item.title === 'saving')?.id
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('saving')).toBeTruthy()
    act(() => { handle.onSuccess('saved', { duration: 7000 }) })
    const completed = toast.getToasts().find((item) => !('dismiss' in item) && item.id === id)
    expect(completed).toMatchObject({ id, type: 'success', duration: 7000 })
    act(() => { handle.onError('late failure') })
    expect(screen.queryByText('late failure')).toBeNull()
    handle.dismiss()
    act(() => { handle.onSuccess('late success') })
    expect(screen.queryByText('late success')).toBeNull()
  })

  it('applies the default duration when loading completes after a host update', () => {
    const view = host({ duration: 3000 })
    let handle!: ReturnType<typeof ExMessage.loading>
    act(() => { handle = ExMessage.loading('updating') })
    const id = toast.getToasts().find((item) => !('dismiss' in item) && item.title === 'updating')?.id
    view.rerender(<ThemeProvider><ExMessage duration={5000} /></ThemeProvider>)
    act(() => { handle.onError('failed') })
    expect(toast.getToasts().find((item) => item.id === id)).toMatchObject({
      id, type: 'error', duration: 5000,
    })
  })

  it('auto closes an ordinary message after the default 3000ms', () => {
    vi.useFakeTimers()
    host()
    let id: string | number = ''
    act(() => { id = ExMessage.info('temporary') })
    expect(toast.getToasts().find((item) => item.id === id)).toMatchObject({ duration: 3000 })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(toast.getToasts().some((item) => item.id === id)).toBe(false)
  })

  it('closes loading at its explicit deadline and ignores later completion', () => {
    vi.useFakeTimers()
    host()
    let handle!: ReturnType<typeof ExMessage.loading>
    act(() => { handle = ExMessage.loading('syncing', { duration: 1000 }) })
    const id = toast.getToasts().find((item) => !('dismiss' in item) && item.title === 'syncing')?.id
    act(() => { vi.advanceTimersByTime(1000) })
    expect(toast.getToasts().some((item) => item.id === id)).toBe(false)
    act(() => { handle.onError('late error') })
    expect(screen.queryByText('late error')).toBeNull()
  })

  it('does not revive an evicted loading message', () => {
    host({ maxCount: 1 })
    let handle!: ReturnType<typeof ExMessage.loading>
    act(() => {
      handle = ExMessage.loading('work')
      ExMessage.info('replacement')
    })
    act(() => { handle.onSuccess('late result') })
    expect(screen.queryByText('late result')).toBeNull()
  })

  it('rejects invalid configuration and duration', () => {
    expect(() => host({ maxCount: 0 })).toThrow('maxCount')
    expect(() => host({ duration: Number.NaN })).toThrow('duration')
    host()
    expect(() => ExMessage.error('bad', { duration: 0 })).toThrow('duration')
    expect(() => ExMessage.loading('bad', { duration: Infinity })).toThrow('duration')
  })

  it('cleans up in StrictMode and rejects a second host', () => {
    const view = render(<StrictMode><ThemeProvider><ExMessage /></ThemeProvider></StrictMode>)
    act(() => { ExMessage.info('strict') })
    view.unmount()
    expect(() => ExMessage.info('gone')).toThrow('mounted host')
    host()
    expect(() => render(<ThemeProvider><ExMessage /></ThemeProvider>)).toThrow('Only one ExMessage host')
  })

  it('subscribes the toaster before a page passive effect sends its first message', async () => {
    function Page() {
      useEffect(() => { ExMessage.info('first page effect') }, [])
      return null
    }
    render(<ThemeProvider><ExMessage /><Page /></ThemeProvider>)
    expect(await screen.findByText('first page effect')).toBeTruthy()
  })

  it('rejects calls from a layout effect before the toaster subscribes', () => {
    function EarlyPage() {
      useLayoutEffect(() => { ExMessage.info('too early') }, [])
      return null
    }
    expect(() => render(<ThemeProvider><ExMessage /><EarlyPage /></ThemeProvider>))
      .toThrow('mounted host')
  })

  it('follows the existing ThemeProvider when its theme changes', async () => {
    function ThemeButton() {
      const { setTheme } = useTheme()
      return <button onClick={() => setTheme('dark')}>dark theme</button>
    }
    render(<ThemeProvider><ExMessage /><ThemeButton /></ThemeProvider>)
    act(() => { ExMessage.info('themed message') })
    await screen.findByText('themed message')
    fireEvent.click(screen.getByRole('button', { name: 'dark theme' }))
    expect(document.querySelector('[data-sonner-toaster]')?.getAttribute('data-sonner-theme')).toBe('dark')
  })
})
