# Empty

## Import

```tsx
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Empty`
- `EmptyHeader`
- `EmptyTitle`
- `EmptyDescription`
- `EmptyContent`
- `EmptyMedia`

## Usage

```tsx
import { InboxIcon } from "lucide-react"
import { Button, Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia, EmptyContent } from "@exre/exui"
import "@exre/exui/style.css"

export function EmptyInbox() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No messages</EmptyTitle>
        <EmptyDescription>
          When you receive messages, they will show up here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline">Compose a message</Button>
      </EmptyContent>
    </Empty>
  )
}
```

`EmptyMedia` accepts `variant`: `"icon"` renders the rounded icon tile shown above; `"default"` (the default) renders plain content. `EmptyContent` holds optional actions below the header.

For advanced props, use the TypeScript types exposed by the package-root import.
