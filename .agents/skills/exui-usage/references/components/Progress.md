# Progress

## Import

```tsx
import { Progress } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Progress`

## Usage

Pass a percentage from 0 to 100 to control the filled width.

```tsx
<Progress value={60} aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={60} />
```

The current wrapper uses `value` for its visual transform but does not forward it to the underlying progress root. Supply `aria-valuenow` explicitly for determinate progress; the primitive's own `data-state` still reflects its unset value. The fill calculation always uses a 100-point scale, so normalize other totals to a percentage. An omitted value leaves the fill empty.

For advanced props, use the TypeScript types exposed by the package-root import.
