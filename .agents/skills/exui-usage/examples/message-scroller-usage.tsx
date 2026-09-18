import * as React from "react"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@exre/exui"
import "@exre/exui/style.css"

export default function MessageScrollerUsage() {
  const [messages, setMessages] = React.useState([
    { id: "1", text: "You: The deploy finished." },
    { id: "2", text: "Peer: Nice, I'll take a look." },
  ])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller style={{ height: "24rem" }}>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {messages.map((message, index) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={index === messages.length - 1}
              >
                {message.text}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        <button
          className="absolute top-4"
          onClick={() =>
            setMessages((current) => [
              ...current,
              {
                id: String(current.length + 1),
                text: `Message ${current.length + 1}`,
              },
            ])
          }
        >
          Add message
        </button>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
