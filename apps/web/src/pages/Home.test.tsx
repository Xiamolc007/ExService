import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AuthArea } from '../../../../packages/components/src/AuthArea'
import { Home } from './Home'

describe('Home', () => {
  it('renders the GrainGradient mount with an action card', () => {
    const markup = renderToStaticMarkup(<Home />)

    expect(markup).toContain('style="width:1280px;height:720px"')
    expect(markup).toContain('data-slot="card"')
    expect(markup).toContain('ex-glass')
    expect(markup).toContain('data-slot="action-button"')
    expect(markup).toContain('data-size="lg"')
    expect(markup).toContain('FiveM打开')
    expect(markup).toContain('玩家社区')
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
