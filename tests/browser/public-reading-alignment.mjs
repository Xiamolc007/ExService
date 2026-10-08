import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Uses Outline's existing Playwright installation and a fresh anonymous context.
// Default input has no headings; DOCS_READING_FIXTURE=1 supplies headings only
// in browser responses. Neither mode creates or edits persistent content.
const require = createRequire(new URL('../../apps/outline/package.json', import.meta.url));
const { chromium } = require('playwright');
const documentUrl = process.env.DOCS_PUBLIC_DOCUMENT_URL;
assert(documentUrl, 'Set DOCS_PUBLIC_DOCUMENT_URL to an existing local public document URL');
const target = new URL(documentUrl);
const fixtureHeadings = process.env.DOCS_READING_FIXTURE === '1';
assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'This acceptance check is local only');
const output = resolve('.notes/docs-integration/reports/reading-ui-alignment-evidence');
const allowed = /^(?:\/api\/health|\/docs\/api\/(?:auth\.(?:info|config)|public\.(?:collections\.list|documents\.(?:info|list|search))))$/;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 900 }, colorScheme });
    try {
      const page = await context.newPage();
      if (fixtureHeadings) {
        await page.route('**/api/public.documents.info', async route => {
          const response = await route.fetch();
          const payload = await response.json();
          assert(payload.data?.content, 'The underlying document must be publicly readable');
          payload.data.content = {
            type: 'doc', content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Overview' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Browser-only published body fixture.' }] },
              { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Details' }] },
            ],
          };
          await route.fulfill({ response, json: payload });
        });
      }
      const requests = [];
      const errors = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === target.origin && /^\/(?:docs\/)?api\//.test(url.pathname)) {
          requests.push(url.pathname);
        }
      });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(documentUrl);
      await page.locator('[data-public-reading-toolbar]').waitFor();
      const title = page.locator('article [data-docs-focus="true"]');
      await title.waitFor();
      await page.getByRole('textbox', { name: 'Editor content' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('[data-public-reading-toolbar]').count(), 1);
      assert.equal(await page.locator('article [contenteditable="true"]').count(), 0);
      assert.equal(await page.locator('#sidebar a[aria-current="page"]').count(), 1);
      const toggle = page.getByRole('button', { name: /^(Contents|目录)$/ });
      if (!fixtureHeadings) {
        await page.locator('article .ProseMirror > *').first().waitFor({ state: 'attached' });
        assert.equal(await page.locator('article .ProseMirror :is(h1,h2,h3,h4)').count(), 0, 'Default mode requires a document without headings');
        assert.equal(await toggle.count(), 0, 'A document without headings has no contents button');
        const currentRow = page.locator('#sidebar a[aria-current="page"]').locator('..');
        const disclosure = currentRow.getByRole('button');
        if (await disclosure.count() === 1) {
          const beforeLinks = await page.locator('#sidebar a').count();
          const location = page.url();
          await disclosure.click();
          await page.waitForFunction(before => document.querySelectorAll('#sidebar a').length > before, beforeLinks);
          assert.equal(page.url(), location, 'Disclosure does not navigate');
          await disclosure.click();
          await page.waitForFunction(before => document.querySelectorAll('#sidebar a').length === before, beforeLinks);
        }
        for (const width of [1920, 390]) {
          await page.setViewportSize({ width, height: 844 });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: resolve(output, `${colorScheme}-${width}-real.png`) });
        }
        assert(requests.every(path => allowed.test(path)), `Unexpected request: ${requests}`);
        assert.deepEqual(errors, []);
        results.push({ colorScheme, status: 'PASS', data: 'real public RPC, no headings', contentsAndPrint: 'NOT_EXECUTED', publicRequests: [...new Set(requests)] });
        continue;
      }
      await toggle.waitFor();
      assert.equal(await toggle.count(), 1, 'Use a public fixture with headings for contents acceptance');
      const before = await title.boundingBox();
      await page.locator('#docs-reading-contents').waitFor();
      await toggle.click();
      await page.locator('#docs-reading-contents').waitFor({ state: 'detached' });
      const after = await title.boundingBox();
      assert(Math.abs(before.x - after.x) < 0.5 && Math.abs(before.width - after.width) < 0.5);
      await toggle.click();
      await page.screenshot({ path: resolve(output, `${colorScheme}-desktop.png`) });

      for (const width of [1024, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: /^(Contents|目录)$/ });
        await dialog.waitFor();
        await dialog.evaluate(async element => {
          element.getBoundingClientRect();
          await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
        });
        const navigation = dialog.getByRole('navigation', { name: /^(Contents|目录)$/ });
        assert(await navigation.isVisible());
        assert.equal(await page.getByRole('navigation', { name: /^(Contents|目录)$/ }).count(), 1);
        await page.screenshot({ path: resolve(output, `${colorScheme}-${width}-contents.png`) });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert(await toggle.evaluate(element => document.activeElement === element));
        await toggle.click();
        await dialog.waitFor();
        await page.locator('[data-vaul-overlay]').click({ position: { x: 4, y: 4 } });
        await dialog.waitFor({ state: 'detached' });
        assert(await toggle.evaluate(element => document.activeElement === element));
        await toggle.click();
        await dialog.waitFor();
        await navigation.getByRole('link').first().click();
        await dialog.waitFor({ state: 'detached' });
        assert(new URL(page.url()).hash.length > 1);
        assert(await toggle.evaluate(element => document.activeElement === element));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }

      // Keep an open portal while switching media to verify print-only hiding,
      // including an overlay that has not yet completed its closing animation.
      await toggle.click();
      await page.getByRole('dialog', { name: /^(Contents|目录)$/ }).waitFor();
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('[data-vaul-drawer]').isVisible(), false);
      assert.equal(await page.locator('[data-vaul-overlay]').isVisible(), false);
      assert.equal(await page.locator('[data-public-reading-toolbar]').isVisible(), false);
      assert(await page.locator('article nav').first().isVisible(), 'Static print contents remain visible');
      await page.screenshot({ path: resolve(output, `${colorScheme}-print.png`) });
      await page.emulateMedia({ media: 'screen' });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });

      assert(requests.every(path => allowed.test(path)), `Unexpected member request: ${requests.filter(path => !allowed.test(path))}`);
      assert.deepEqual(errors, []);
      results.push({ colorScheme, status: 'PASS', data: 'browser response fixture with headings', publicRequests: [...new Set(requests)] });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ results, evidence: '.notes/docs-integration/reports/reading-ui-alignment-evidence' }, null, 2));
