# Marker

## Import

```tsx
import { Marker, MarkerIcon, MarkerContent, markerVariants } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Marker`
- `MarkerIcon`
- `MarkerContent`
- `markerVariants`

## Usage

`Marker` labels a point in a list or timeline. `variant` selects the presentation: `"default"` (plain), `"separator"` (rules on both sides), or `"border"` (bottom rule).

```tsx
import { CalendarIcon } from "lucide-react"
import { Marker, MarkerIcon, MarkerContent } from "@exre/exui"
import "@exre/exui/style.css"

export function TimelineMarker() {
  return (
    <Marker variant="separator">
      <MarkerIcon>
        <CalendarIcon />
      </MarkerIcon>
      <MarkerContent>September 2026</MarkerContent>
    </Marker>
  )
}
```

`MarkerContent` renders text or links, and `Marker` accepts `asChild` to render the marker itself as another element.

For advanced props, use the TypeScript types exposed by the package-root import.
