# HoverCard

## Import

```tsx
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `HoverCard`
- `HoverCardTrigger`
- `HoverCardContent`

## Usage

```tsx
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@exre/exui"
import "@exre/exui/style.css"

export function ProfileHover() {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <a href="/users/someone">@someone</a>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="font-medium">Someone</div>
        <p className="text-sm text-muted-foreground">
          Frontend engineer. Hovers over cards.
        </p>
      </HoverCardContent>
    </HoverCard>
  )
}
```

`HoverCardTrigger` renders a link by default; pass `asChild` to attach the card to your own element. `HoverCardContent` portals to the body and accepts the usual placement props (`side`, `align`, `sideOffset`). Open state can be controlled with `open`/`onOpenChange` on the root, and `openDelay`/`closeDelay` tune the hover timing.

For advanced props, use the TypeScript types exposed by the package-root import.
