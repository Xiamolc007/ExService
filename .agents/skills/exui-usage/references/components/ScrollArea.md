# ScrollArea

## Import

```tsx
import { ScrollArea, ScrollBar } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `ScrollArea`
- `ScrollBar`

## Usage

Give the scroll area a bounded height so overflowing content can scroll. The wrapper includes the viewport and vertical scrollbar.

```tsx
<ScrollArea style={{ height: "12rem", width: "20rem" }}>
  <div style={{ padding: "1rem" }}>
    {Array.from({ length: 20 }, (_, index) => <p key={index}>Row {index + 1}</p>)}
  </div>
</ScrollArea>
```

Add `ScrollBar orientation="horizontal"` as a child when the content also overflows horizontally. `type` on the root controls scrollbar visibility, such as `"auto"` or `"always"`.

For advanced props, use the TypeScript types exposed by the package-root import.
