# ExUI Icon Usage

Use `lucide-react` as the default general-purpose icon source in consuming React projects. Declare it as a direct dependency of the consuming project; do not rely on `@exre/exui` exposing its transitive dependency.

```bash
pnpm add lucide-react
```

Import named icons directly:

```tsx
import { RefreshCwIcon } from "lucide-react"
import { Button } from "@exre/exui"

export function RefreshButton() {
  return (
    <Button size="icon" aria-label="Refresh">
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  )
}
```

## Accessibility

- Give every icon-only interactive control an accessible name, normally with `aria-label` on the control.
- Mark purely decorative icons with `aria-hidden="true"`.
- Add visible text when an icon's meaning is ambiguous without a label.

```tsx
import { DownloadIcon } from "lucide-react"
import { Button } from "@exre/exui"

<Button>
  <DownloadIcon aria-hidden="true" />
  Download report
</Button>
```

## Narrow exceptions

Use a non-Lucide asset only for a brand logo, product-specific artwork, or a concept that Lucide does not represent. An exception does not establish a second default general-purpose icon system and does not justify hand-authoring an SVG when Lucide already provides an equivalent icon.
