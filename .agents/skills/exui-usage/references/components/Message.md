# Message

## Import

```tsx
import { MessageGroup, Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `MessageGroup`
- `Message`
- `MessageAvatar`
- `MessageContent`
- `MessageHeader`
- `MessageFooter`

## Usage

`Message` structures a chat row: avatar on one side, header and content in the middle, footer for metadata. `align` (`"start"` or `"end"`) flips the row for the other speaker.

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@exre/exui"
import { MessageGroup, Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter } from "@exre/exui"
import "@exre/exui/style.css"

export function ChatRow() {
  return (
    <MessageGroup>
      <Message>
        <MessageAvatar>
          <Avatar>
            <AvatarImage src="/peer.png" alt="Peer" />
            <AvatarFallback>P</AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>Peer · 14:02</MessageHeader>
          The review looks good from my side.
          <MessageFooter>Seen</MessageFooter>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <MessageHeader>You · 14:03</MessageHeader>
          Great, merging it now.
        </MessageContent>
      </Message>
    </MessageGroup>
  )
}
```

Use [Bubble](Bubble.md) inside the content for styled chat bubbles, and place the whole group in [MessageScroller](MessageScroller.md) items for scrollable history.

For advanced props, use the TypeScript types exposed by the package-root import.
