// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AuthArea } from '../../../../packages/components/src/AuthArea'
import { Home } from './Home'

const themeState = vi.hoisted(() => ({ theme: 'light' }))

vi.mock('@exre/exui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@exre/exui')>(),
  useTheme: () => ({ theme: themeState.theme }),
}))

vi.mock('@paper-design/shaders-react', () => ({
  GrainGradient: ({ width, height, colors, colorBack }: {
    width: number
    height: number
    colors: string[]
    colorBack: string
  }) => <div style={{ width, height }} data-colors={colors.join(',')} data-color-back={colorBack} />,
}))

describe('Home', () => {
  it('renders the GrainGradient mount with an action card', () => {
    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('style="width:1280px;height:720px"')
    expect(markup).toContain('data-colors="#7300ff,#eba8ff,#00bfff,#2b00ff"')
    expect(markup).toContain('data-color-back="#ffffff"')
    expect(markup).toContain('data-slot="card"')
    expect(markup).toContain('ex-glass')
    expect(markup).toContain('data-slot="action-button"')
    expect(markup).toContain('data-size="lg"')
    expect(markup).toContain('FiveM打开')
    expect(markup).toContain('玩家社区')
  })

  it('uses a dark backdrop in dark theme', () => {
    themeState.theme = 'dark'
    try {
      expect(renderToStaticMarkup(<Home />)).toContain('data-color-back="#000000"')
    } finally {
      themeState.theme = 'light'
    }
  })

  it('follows system theme changes', () => {
    let dark = false
    let onChange: (() => void) | undefined
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return dark },
      addEventListener: (_event: string, listener: () => void) => { onChange = listener },
      removeEventListener: () => { onChange = undefined },
    }))
    themeState.theme = 'system'

    try {
      const view = render(<Home />)
      expect(view.container.querySelector('[data-color-back]')?.getAttribute('data-color-back')).toBe('#ffffff')

      act(() => {
        dark = true
        onChange?.()
      })
      expect(view.container.querySelector('[data-color-back]')?.getAttribute('data-color-back')).toBe('#000000')
      view.unmount()
    } finally {
      themeState.theme = 'light'
      vi.unstubAllGlobals()
    }
  })

  it('renders login and register as separate buttons', () => {
    const markup = renderToStaticMarkup(
      <AuthArea
        state={{ status: 'anonymous' }}
        onLogin={() => undefined}
        onRegister={() => undefined}
        onRetry={() => undefined}
        onLogout={() => undefined}
      />,
    )

    expect(markup).not.toContain('data-slot="button-group"')
    expect(markup).toContain('data-slot="action-button"')
  })
})
