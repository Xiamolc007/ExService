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

vi.mock('./pages/JoinResultPage', () => ({ JoinResultPage: () => <main>Application result query</main> }))

import { App } from './App'

describe('App', () => {
  it('renders application result queries inside the site layout', () => {
    const markup = renderToStaticMarkup(<MemoryRouter initialEntries={['/join/result']}><App /></MemoryRouter>)
    expect(markup).toContain('Site header')
    expect(markup).toContain('Application result query')
    expect(markup).not.toContain('Page not found')
  })
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
