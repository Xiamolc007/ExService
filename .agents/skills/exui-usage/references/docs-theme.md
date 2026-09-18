# Fumadocs UI docs theme

Render a documentation site built with [Fumadocs UI](https://www.fumadocs.dev/docs/ui) in ExUI colours by importing one stylesheet. This is a colour contract only: it does not wrap, replace, or re-export any Fumadocs component.

## Install

ExUI names `fumadocs-ui` in no dependency field, so install it yourself — a Fumadocs site needs it anyway:

```bash
npm add fumadocs-ui
```

The sheet is verified against `fumadocs-ui@^16.15.0`.

## Import

```tsx
import "@exre/exui/docs/theme.css"
```

Import it once per docs surface, like any other stylesheet. It carries the ExUI Token sheet itself, so a Fumadocs-only site needs no separate Token import.

## What the sheet does

`docs/theme.css` is three `@import` rules in a pinned order:

1. `@exre/exui/tokens/style.css` — the ExUI Token variables.
2. `fumadocs-ui/css/shadcn.css` — Fumadocs' colour sheet.
3. `fumadocs-ui/css/preset.css` — Fumadocs' preset.

Fumadocs maps its `--color-fd-*` names onto shadcn's short variables (`--background`, `--primary`, `--sidebar`) **without fallbacks**. Load the sheet in an app that does not already carry the ExUI Token sheet and every docs colour computes to an unset custom property: the page renders unstyled and reports no error. That silent failure is why this entry exists rather than asking consumers to import the sheets themselves.

The sheet ships unprocessed, exactly like Fumadocs' own `css/*` sheets, so your Tailwind build resolves the three imports. If `fumadocs-ui` is missing, the imports fail loudly instead of yielding an unthemed page.

## Boundaries

- **Colour only.** Fumadocs keeps its own radii, spacing, and animations; they follow neither ExUI's `--radius` nor its density values.
- **No component wrapping.** Fumadocs ships its own `Tabs` and `Accordion` with APIs that differ from ExUI's (`<Tabs items={[...]}><Tab value="..." />` against ExUI's `<TabsList>` composition). Import those from `fumadocs-ui`; ExUI does not re-export Fumadocs components.
- **One theme driver per page.** Fumadocs' `RootProvider` (next-themes) and ExUI's `ThemeProvider` both read and write the `theme` `localStorage` key. In an SSR framework use Fumadocs' provider: it is hydration-safe, while ExUI's `ThemeProvider` is not. See [Theme usage](theme-usage.md).
- **Stylesheet subpath only.** There is no `@exre/exui/docs` JavaScript entry.
