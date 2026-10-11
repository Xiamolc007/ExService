import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Real public RPCs in a fresh anonymous context; no persistent content changes.
const require = createRequire(new URL('../../apps/outline/package.json', import.meta.url));
const { chromium } = require('playwright');
const origin = process.env.DOCS_ORIGIN || 'http://127.0.0.1:8080';
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/docs/api/public.')) {
      requests.push(path);
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.sidebarLoading = 0;
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          const statuses = [
            ...(node.matches('[data-docs-state="loading"]') ? [node] : []),
            ...node.querySelectorAll('[data-docs-state="loading"]'),
          ];
          if (statuses.some(status => status.closest('#sidebar'))) {
            window.sidebarLoading += 1;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${origin}/docs/`);
  const collection = page.locator('#sidebar a[href*="/public/collection/"]').first();
  await collection.waitFor();
  const collectionPath = await collection.getAttribute('href');
  assert(collectionPath, 'Requires an existing public collection');
  await collection.click();
  const documentLink = page.locator('#sidebar a[href*="/doc/"]').first();
  await documentLink.waitFor();
  const documentPath = await documentLink.getAttribute('href');
  assert(documentPath, 'Requires an existing published document');
  await page.locator('#sidebar [data-docs-state="loading"]').waitFor({ state: 'detached' });
  const count = rpc => requests.filter(path => path.endsWith(rpc)).length;
  const baseline = {
    collections: count('public.collections.list'),
    trees: count('public.documents.list'),
  };
  await page.evaluate(() => { window.sidebarLoading = 0; });
  // Slow any redundant reads so a reintroduced loading flash is observable.
  await page.route('**/api/public.*.list', async route => {
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.continue();
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await page.locator(`#sidebar a[href="${documentPath}"]`).click();
    await page.locator('article [data-docs-focus="true"]').waitFor();
    await page.locator(`#sidebar a[href="${collectionPath}"]`).click();
    await page.waitForURL(url => url.pathname === collectionPath);
    await page.locator(`[role="main"] a[href="${documentPath}"]`).waitFor();
  }
  assert.equal(count('public.collections.list'), baseline.collections, 'Directory refetched on navigation');
  assert.equal(count('public.documents.list'), baseline.trees, 'Tree refetched on navigation');
  assert.equal(await page.evaluate(() => window.sidebarLoading), 0, 'Sidebar displayed loading on navigation');
  assert.equal(count('public.documents.info'), 3, 'Body must still be revalidated on each visit');
  assert.deepEqual(errors, []);
  await page.reload();
  await page.locator('#sidebar a[href*="/doc/"]').first().waitFor();
  assert(count('public.collections.list') > baseline.collections, 'Reload must refresh the directory');
  assert(count('public.documents.list') > baseline.trees, 'Reload must refresh the tree');
  console.log(JSON.stringify({
    status: 'PASS',
    data: 'real anonymous public RPC',
    navigations: 6,
    directoryRequestsDuringNavigation: 0,
    treeRequestsDuringNavigation: 0,
    sidebarLoadingDuringNavigation: 0,
    bodyRequestsDuringNavigation: 3,
    reloadRefreshesDirectoryAndTree: true,
  }, null, 2));
} finally {
  await browser.close();
}
