# Sheet

## Import

```tsx
import { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Sheet`
- `SheetTrigger`
- `SheetClose`
- `SheetContent`
- `SheetHeader`
- `SheetFooter`
- `SheetTitle`
- `SheetDescription`

## Usage

```tsx
import { Button, Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@exre/exui"
import "@exre/exui/style.css"

export function SettingsSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Settings</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Adjust the workspace preferences.</SheetDescription>
        </SheetHeader>
        <div className="p-6">Settings controls go here</div>
        <SheetFooter>
          <SheetClose asChild>
            <Button>Done</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

`SheetContent` accepts `side`: `"right"` (default), `"left"`, `"top"`, or `"bottom"`, and `showCloseButton` (default `true`) for the built-in close button in the corner. `SheetTitle` is required for accessibility; add `SheetDescription` when the sheet needs explanation. Escape and focus handling come from the underlying primitive.

For a bottom sheet with drag-to-dismiss, see [Drawer](Drawer.md).

For advanced props, use the TypeScript types exposed by the package-root import.
