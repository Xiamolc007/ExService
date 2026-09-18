# Separator

## Import

```tsx
import { Separator } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Separator`

## Usage

The default separator is horizontal and decorative. Use `orientation="vertical"` inside a row with a defined height for a vertical divider.

```tsx
<div style={{ display: "flex", alignItems: "center", gap: "1rem", height: "2rem" }}>
  <span>Editor</span>
  <Separator orientation="vertical" />
  <span>Preview</span>
</div>
```

Pass `decorative={false}` when the separator conveys a semantic division that assistive technology should expose.

For advanced props, use the TypeScript types exposed by the package-root import.
