# Badge

## Import

```tsx
import { Badge, badgeVariants } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Badge`
- `badgeVariants`

## Usage

Use a badge for a short status or category. `variant` accepts `"default"`, `"secondary"`, `"destructive"`, `"outline"`, `"ghost"`, or `"link"`.

```tsx
<Badge variant="secondary">Draft</Badge>
<Badge asChild variant="outline">
  <a href="/releases">Release notes</a>
</Badge>
```

The default element is a `span`. `asChild` applies the styling to one child element; `badgeVariants({ variant: "outline" })` exposes the same styles for custom composition.

For advanced props, use the TypeScript types exposed by the package-root import.
