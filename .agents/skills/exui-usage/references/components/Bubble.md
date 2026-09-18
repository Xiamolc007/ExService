# Bubble

## Import

```tsx
import { BubbleGroup, Bubble, BubbleContent, BubbleReactions } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `BubbleGroup`
- `Bubble`
- `BubbleContent`
- `BubbleReactions`

## Usage

`Bubble` is a chat bubble container: `variant` selects the surface (`"default"`, `"secondary"`, `"muted"`, `"tinted"`, `"outline"`, `"ghost"`, or `"destructive"`) and `align` (`"start"` or `"end"`) places it on the speaker's side. The text goes in `BubbleContent`.

```tsx
import { BubbleGroup, Bubble, BubbleContent, BubbleReactions } from "@exre/exui"
import "@exre/exui/style.css"

export function ChatExchange() {
  return (
    <BubbleGroup>
      <Bubble>
        <BubbleContent>Are you free for a review at three?</BubbleContent>
        <BubbleReactions>👍 2</BubbleReactions>
      </Bubble>
      <Bubble variant="secondary" align="end">
        <BubbleContent>Yes, see you then.</BubbleContent>
      </Bubble>
    </BubbleGroup>
  )
}
```

`BubbleReactions` renders reaction chips under a bubble; `side` (`"top"` or `"bottom"`) and `align` control its placement. `BubbleContent` accepts `asChild` to render the bubble as a link or button.

Combine bubbles with [Message](Message.md) for full chat rows with avatars, or place them in [MessageScroller](MessageScroller.md) items for scrolling history.

For advanced props, use the TypeScript types exposed by the package-root import.
