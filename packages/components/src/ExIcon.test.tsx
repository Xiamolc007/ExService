import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExIcon } from '@components/src/ExIcon'

describe('ExIcon', () => {
  it('uses ExUI Glass and accepts a custom size and background', () => {
    const markup = renderToStaticMarkup(
      <ExIcon size="3rem" backgroundColor="rgb(255 0 0 / 0.4)" className="custom" />,
    )

    expect(markup).toContain('ex-glass')
    expect(markup).toContain('custom')
    expect(markup).toContain('width:3rem;height:3rem')
    expect(markup).toContain('--exui-glass-background:rgb(255 0 0 / 0.4)')
    expect(markup).toContain('aria-hidden="true"')
  })
})
