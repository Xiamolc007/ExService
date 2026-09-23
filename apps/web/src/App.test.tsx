import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@workspace/components', () => ({
  SiteHeader: () => <header>Site header</header>,
}))

vi.mock('./pages/Home', () => ({
  Home: () => <main>Home</main>,
}))

vi.mock('./pages/NotFound', () => ({
  NotFound: () => <main>Page not found</main>,
}))

import { App } from './App'

describe('App', () => {
  it('keeps the site header around an unmatched route', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/not-found']}>
        <App />
      </MemoryRouter>,
    )

    expect(markup).toContain('<header')
    expect(markup).toContain('Page not found')
  })
})
