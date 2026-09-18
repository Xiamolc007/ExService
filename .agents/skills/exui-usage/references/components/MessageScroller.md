# MessageScroller

## Import

```tsx
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
} from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `MessageScrollerProvider`
- `MessageScroller`
- `MessageScrollerViewport`
- `MessageScrollerContent`
- `MessageScrollerItem`
- `MessageScrollerButton`
- `useMessageScroller`
- `useMessageScrollerScrollable`
- `useMessageScrollerVisibility`

## Usage

`MessageScroller` structures a scrollable message list that keeps your place when older messages are prepended and can auto-scroll to new messages. The parts nest in this order:

```tsx
<MessageScrollerProvider autoScroll defaultScrollPosition="end">
  <MessageScroller>
    <MessageScrollerViewport>
      <MessageScrollerContent>
        <MessageScrollerItem messageId="1" scrollAnchor>
          Message text
        </MessageScrollerItem>
      </MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton />
  </MessageScroller>
</MessageScrollerProvider>
```

[完整示例：消息滚动](../../examples/message-scroller-usage.tsx) appends messages live and exercises the auto-scroll pause and the jump-back button in one runnable file.

## Provider behavior

`MessageScrollerProvider` controls the scrolling policy:

- `autoScroll`: follow new messages automatically while the user is at the scroll anchor. When the user scrolls away from the bottom, auto-scrolling pauses; `MessageScrollerButton` becomes active and jumps back.
- `defaultScrollPosition`: `"start"`, `"end"`, or `"last-anchor"` — where the list scrolls on mount.
- `scrollEdgeThreshold`: how close to an edge counts as "at the edge" for button visibility.
- `scrollPreviousItemPeek` and `scrollMargin`: tune how much content stays visible when navigating to older anchors.

## Parts and props

- `MessageScrollerItem`: give each message a `messageId` and mark the anchor message with `scrollAnchor`. Anchor messages are the targets that auto-scroll and `scrollToMessage` navigate to.
- `MessageScrollerViewport`: the scroll container. `preserveScrollOnPrepend` keeps the visible position when older items are added above.
- `MessageScrollerButton`: the jump button. `direction` selects `"end"` (default, scroll to latest) or `"start"` (scroll to oldest); it is hidden while inactive and renders its own icon and screen-reader label.

## Hooks

Call these inside `MessageScrollerProvider`:

- `useMessageScroller()` returns `{ scrollToEnd, scrollToMessage, scrollToStart }` for programmatic scrolling.
- `useMessageScrollerScrollable()` returns `{ start, end }` booleans for whether more content exists in each direction.
- `useMessageScrollerVisibility()` returns `{ currentAnchorId, visibleMessageIds }` for tracking which messages are rendered.

For chat bubbles inside the items, combine with [Bubble](Bubble.md) or [Message](Message.md).
