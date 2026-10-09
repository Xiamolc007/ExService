// Run against an authenticated document page with its normal toolbar visible.
// Usage: await assertDocsToolbarGeometry(tab)
// Collection page: await assertDocsToolbarGeometry(tab, 'data-collection-toolbar')
// Real browser geometry is required; jsdom does not lay out button contents.
export async function assertDocsToolbarGeometry(tab, attribute = 'data-document-toolbar') {
  const rows = await tab.playwright.evaluate(async (attribute) => {
    await document.fonts.ready;
    return Array.from(document.querySelectorAll(`[${attribute}]`)).map(panel => {
      const shadow = getComputedStyle(panel).boxShadow;
      const shadowLayers = shadow.split(/,(?![^(]*\))/);
      let visible = true;
      for (let element = panel; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          visible = false;
        }
      }
      return {
        kind: panel.getAttribute(attribute),
        visible,
        outerShadow: shadowLayers.some(layer =>
          layer.trim() !== 'none' &&
          !layer.includes('inset') &&
          !/rgba\([^)]*,\s*0\)/.test(layer)),
        controls: Array.from(panel.querySelectorAll('button,a')).flatMap(control => {
          const bounds = control.getBoundingClientRect();
          if (!bounds.width || !bounds.height) {
            return [];
          }
          const center = bounds.top + bounds.height / 2;
          return Array.from(control.querySelectorAll('svg,span'))
            .filter(content => content.tagName.toLowerCase() === 'svg' ||
              (!content.children.length && content.textContent.trim()))
            .map(content => {
              const rect = content.getBoundingClientRect();
              return {
                label: control.getAttribute('aria-label') || control.textContent.trim(),
                content: content.tagName.toLowerCase(),
                offset: Math.round((rect.top + rect.height / 2 - center) * 100) / 100,
              };
            });
        }),
      };
    });
  }, attribute);
  const failures = [];
  if (!rows.some(row => row.kind === 'navigation') || !rows.some(row => row.kind === 'actions')) {
    failures.push('Both document toolbars must be present');
  }
  for (const row of rows) {
    if (!row.visible || !row.controls.length) {
      failures.push(`${row.kind}: toolbar must be visible with controls`);
    }
    if (!row.outerShadow) {
      failures.push(`${row.kind}: no visible outer box shadow`);
    }
    for (const control of row.controls) {
      if (Math.abs(control.offset) > 0.75) {
        failures.push(`${row.kind}/${control.label}/${control.content}: center offset ${control.offset}px`);
      }
    }
  }
  if (failures.length) {
    throw new Error(failures.join('\n'));
  }
  return rows;
}

/** Checks the collapsed-sidebar header control against the adjacent Glass toolbar. */
export async function assertDocsHeaderToggleGlass(tab, attribute = 'data-document-toolbar') {
  const geometry = await tab.playwright.evaluate(async (attribute) => {
    await document.fonts.ready;
    const button = Array.from(document.querySelectorAll(
      'button[aria-controls="sidebar"][aria-expanded="false"]'
    )).find(element => !element.closest('[inert],[aria-hidden="true"]'));
    const surface = button?.closest('[data-sidebar-toggle-toolbar]') || button;
    const reference = document.querySelector(`[${attribute}="navigation"]`) ||
      document.querySelector(`[${attribute}="actions"]`);
    if (!surface || !reference) {
      throw new Error('Collapse the sidebar and display a Glass toolbar before checking');
    }
    const measure = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: rect.height,
        top: rect.top,
        shadow: style.boxShadow,
        background: style.backgroundColor,
        radius: style.borderRadius,
        filter: style.backdropFilter,
      };
    };
    return { toggle: measure(surface), toolbar: measure(reference) };
  }, attribute);
  const failures = [];
  for (const property of ['height', 'top']) {
    if (Math.abs(geometry.toggle[property] - geometry.toolbar[property]) > 0.5) {
      failures.push(`${property}: toggle=${geometry.toggle[property]} toolbar=${geometry.toolbar[property]}`);
    }
  }
  for (const property of ['shadow', 'background', 'radius', 'filter']) {
    if (geometry.toggle[property] !== geometry.toolbar[property]) {
      failures.push(`${property}: toggle=${geometry.toggle[property]} toolbar=${geometry.toolbar[property]}`);
    }
  }
  if (failures.length) {
    throw new Error(failures.join('\n'));
  }
  return geometry;
}
