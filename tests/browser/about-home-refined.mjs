// Pass this file to playwright-cli run-code --filename from the repository root.
// The supplied page must already be at the Website origin; no Server/database mutation is used.
async (page) => {
  const origin = await page.evaluate(() => location.origin)
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const requests = []
  const record = request => requests.push(request.url())
  page.on('request', record)
  await page.context().addInitScript(() => {
    window.__aboutWebglCalls = []
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/webgl/i.test(type)) window.__aboutWebglCalls.push(type)
      return original.call(this, type, ...args)
    }
  })
  const ready = async () => {
    await page.getByText('持续整理中的介绍', { exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
  }
  const rows = []
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${origin}/aboutus`)
    await ready()
    assert(await page.locator('main h1').count() === 1, 'Home must have one h1')
    assert(await page.getByRole('navigation', { name: 'About 栏目' }).count() === 0, 'Home section navigation was mounted')
    assert(await page.locator('main canvas').count() === 0, 'Home mounted a Canvas')
    assert((await page.evaluate(() => window.__aboutWebglCalls)).length === 0, 'Home created a WebGL context')
    assert(!requests.some(url => /\/AboutHero\.|\/hero\/(renderer|shape|bloom|light)|\/renderer-/.test(url)), 'Home requested the old renderer')
    const targets = await page.locator('#about-content > article a').evaluateAll(links => links.map(link => link.getAttribute('href')))
    assert(JSON.stringify(targets) === JSON.stringify(['/aboutus/communities', '/aboutus/projects', '/aboutus/team', '/aboutus/media', '/aboutus/story']), 'Section targets or order changed')
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme) }, theme)
        const geometry = await page.evaluate(() => {
          const grid = document.getElementById('about-content')
          const boxes = [...grid.children].map(element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
          return { overflow: document.documentElement.scrollWidth > window.innerWidth, boxes }
        })
        assert(!geometry.overflow, `Horizontal overflow at ${width}px/${theme}`)
        if (width < 640) assert(geometry.boxes.every((box, index) => !index || box.top >= geometry.boxes[index - 1].bottom - 1), 'Mobile reading order differs from DOM')
        rows.push({ width, theme, overflow: geometry.overflow })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
      const heading = document.querySelector('main h1')
      heading.dataset.original = heading.textContent
      heading.textContent = '因为相遇，所以创造。让每一个正在发生的想法，都拥有更多可以分享的可能。'.repeat(3)
    })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Long copy/root-font scaling overflowed')
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; const heading = document.querySelector('main h1'); heading.textContent = heading.dataset.original })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert(await page.locator('#about-content a span').first().evaluate(element => getComputedStyle(element).transitionDuration) === '0s', 'Reduced motion did not disable link transition')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const projectLink = page.getByRole('article', { name: '项目与创作', exact: true }).getByRole('link')
    await projectLink.scrollIntoViewIfNeeded()
    const savedY = await page.evaluate(() => window.scrollY)
    await projectLink.click()
    await page.getByRole('navigation', { name: 'About 栏目' }).waitFor()
    await page.goBack()
    await ready()
    await page.waitForFunction(y => Math.abs(window.scrollY - y) <= 2, savedY)
    await page.getByRole('article', { name: '项目与创作', exact: true }).getByRole('link').click()
    await page.getByRole('navigation', { name: 'About 面包屑' }).getByRole('link', { name: '关于 Exre' }).click()
    await ready()
    assert(await page.locator('main h1').evaluate(element => element === document.activeElement), 'Home PUSH did not focus h1')
    await page.keyboard.press('Tab')
    assert(await page.evaluate(() => document.activeElement?.getAttribute('href') === '/aboutus/communities'), 'First home keyboard entry is incorrect')
    await page.goto(`${origin}/aboutus#about-content`)
    await ready()
    assert(await page.evaluate(() => window.scrollY > 0 && document.getElementById('about-content').getBoundingClientRect().top >= 60), 'Legacy hash did not clear the site header')
    await page.getByRole('article', { name: '团队与贡献者', exact: true }).getByRole('link').click()
    await page.locator('main button').first().click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', { name: '关闭成员简介' }).click()
    assert(await page.getByRole('dialog').count() === 0, 'Member modal remained open')
    await page.goto(`${origin}/aboutus/media`)
    await page.getByRole('button', { name: '视频', exact: true }).click()
    assert(await page.getByText('来源待补充').count() > 0, 'Media missing-source state disappeared')
    await page.goto(`${origin}/aboutus`)
    await ready()
    return { status: 'PASS', rows, rendererRequested: false, webglCalls: 0, navigation: 'PASS', rootFontScaleAndLongCopy: 'PASS', reducedMotion: 'PASS', memberModal: 'PASS', mediaFilter: 'PASS', note: 'Root-font scaling is checked; native browser toolbar zoom is not automated.' }
  } finally {
    page.off('request', record)
  }
}
