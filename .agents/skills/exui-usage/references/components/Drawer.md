# Drawer

## Import

```tsx
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Drawer`
- `DrawerPortal`
- `DrawerOverlay`
- `DrawerTrigger`
- `DrawerClose`
- `DrawerContent`
- `DrawerHeader`
- `DrawerFooter`
- `DrawerTitle`
- `DrawerDescription`

## Usage

`Drawer` is a dialog that slides in from an edge and can be dragged closed. It composes like [Dialog](Dialog.md):

```tsx
import { Button, Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@exre/exui"
import "@exre/exui/style.css"

export function FilterDrawer() {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Filters</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
          <DrawerDescription>Narrow down the results.</DrawerDescription>
        </DrawerHeader>
        <div className="p-4">Filter controls go here</div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button>Apply</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
```

`DrawerContent` includes the portal, the overlay, and the drag handle; position the drawer with the `direction` prop on the root (`"bottom"` by default; also `"top"`, `"left"`, `"right"`). Open state can stay uncontrolled through the trigger or be controlled with `open`/`onOpenChange` on the root. `DrawerTitle` is required for accessibility; pair it with `DrawerDescription` when the drawer needs explanation.

For advanced props, use the TypeScript types exposed by the package-root import.
