# Resizable

## Import

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `ResizableHandle`
- `ResizablePanel`
- `ResizablePanelGroup`

## Usage

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@exre/exui"
import "@exre/exui/style.css"

export function SplitEditor() {
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-72 rounded-xl border">
      <ResizablePanel defaultSize="50%">
        <div className="flex h-full items-center justify-center">Editor</div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="50%">
        <div className="flex h-full items-center justify-center">Preview</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

`ResizablePanelGroup` takes `orientation` (`"horizontal"` by default, or `"vertical"`); each `ResizablePanel` accepts `defaultSize` (a number in pixels or a string with units, such as `"50%"` or `"12rem"`) and the underlying panel props, such as `minSize` and `maxSize`. `ResizableHandle` renders the drag divider between panels — pass `withHandle` to show its visual grip.

For advanced props, use the TypeScript types exposed by the package-root import.
