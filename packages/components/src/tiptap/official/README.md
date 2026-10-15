# Official Tiptap UI source

The editor uses the free MIT UI Components from [Tiptap's public repository](https://github.com/ueberdosis/tiptap-ui-components/tree/799929bea4804c73767562b69f8acc2acdb8ac86/apps/web/src).

- Upstream revision: `799929bea4804c73767562b69f8acc2acdb8ac86`.
- Imported: 2026-10-14, from `apps/web/src` and its required source dependency closure.
- License: `packages/components/src/tiptap/official/LICENSE`, preserved from upstream.
- Included controls: history, headings, lists, blockquote, code block, marks, alignment, highlight, link and image upload.

## Host adaptations

`components/tiptap-ui/` retains the official components and command hooks. Relative paths replace the demo's aliases. `components/tiptap-icons/` preserves the upstream React SVG icon files unchanged. The user explicitly exempted this toolbar from the repository's Lucide rule on 2026-10-14. The custom text-color panel uses `TextColorSmallIcon` and the upstream ban icon. `components/tiptap-ui-primitive/` uses public ExUI exports through `primitives.tsx`; the toolbar retains the upstream primitive. No additional Radix, Cloud or paid components are installed.

`text-color-small-icon.tsx` is an additional official asset retrieved on 2026-10-14 from [the public registry](https://template.tiptap.dev/api/registry/components/text-color-small-icon), as referenced by the [Color Text Popover documentation](https://tiptap.dev/docs/ui-components/components/color-text-popover). Its registry metadata lists `light` and `open-source` plans. It is preserved from that response and is separate from the 33 icons in the pinned Git revision; only the icon is used with the existing custom panel.

`theme.module.scss` scopes the UI layout and colors to the editor and its portal panels. The toolbar and combined color panel use ExUI surface tokens. The Link popup restores the pinned upstream's compact input and three icon-only actions, original light/dark colors, geometry and shadow through `components/tiptap-ui/link-popover/link-popover.module.scss`; ExUI still provides popup positioning and dismiss behavior. No upstream global stylesheet is imported. The business wrapper owns toolbar background, border, shadow and positioning. The existing content stylesheet owns document rendering.

`integration.tsx` connects popup selection to the host's `ToolbarSession`. Explicit document replacement remounts the toolbar for its new generation; failed replacement keeps the current controls. Each popup owns its selection session and disposes it on close/unmount. Link fields use RHF/Zod and the existing safe-URL policy, retain rejected input and close only after an accepted transaction. Highlighter presets receive resolved hexadecimal colors and execute synchronously. Image upload uses the existing lifecycle and mapped positions rather than the upstream demo's temporary `imageUpload` node.

Capability checks reject discarded Editor instances. `use-tiptap-editor.ts` returns the current provided instance while keeping official transaction subscriptions; a cached snapshot can still refer to a prior StrictMode instance. Command focus is synchronous through `focusEditor` so a delayed focus cannot steal focus from a newly opened panel. Toolbar navigation tracks the actual focused control, observes disabled controls and lets Tab leave. Optional shortcut listeners are scoped to this editor and ignore forms, composition and already handled events.

For heading, list, blockquote and code block commands, text selections keep their entire range and use native Tiptap commands. The upstream node-targeting path is reserved for actual NodeSelections; converting every text selection to the anchor paragraph would silently format only the first selected block. The highlighter does not consume its optional shortcut without a concrete highlight color.

The user-requested combined text/highlight palette extends `ColorHighlightPopover`; there is no separate text-color toolbar button. Each section has a default option and nine colors in a five-column grid. `toolbar/formatting-colors.ts` contains literal sRGB presets derived from the pinned upstream palette, including dark presets; theme changes never rewrite document colors. Both groups share one mapped selection session, support independent clearing and remain open after applying a color. Grid arrows move from real focus, with vertical arrows moving five cells. Commands briefly focus the editor, so the panel suppresses that command's focus-out dismissal and returns focus to the chosen button on the next animation frame. At the default root size, headings are 14px and the A SVG viewport is 18px; its original glyph retains the upstream proportions. The panel is 194px wide with 24px circular buttons, with 12px column gaps, 8px row gaps and 16px between sections.

## Updating and checking

Review a new upstream revision and its dependency closure, retain the license, then reapply the host adaptations above. Do not run the CLI against this monorepo without reviewing its dependency and global stylesheet mutations.

Run `pnpm exec vitest run packages/components/src/tiptap` and `pnpm typecheck`. Verify light/dark portal colors, first-load StrictMode availability, keyboard navigation, literal color export and narrow layouts in a consuming application before updating this source.
