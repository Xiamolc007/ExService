# ContextMenu

## Import

```tsx
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuGroup } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `ContextMenu`
- `ContextMenuTrigger`
- `ContextMenuContent`
- `ContextMenuItem`
- `ContextMenuCheckboxItem`
- `ContextMenuRadioItem`
- `ContextMenuLabel`
- `ContextMenuSeparator`
- `ContextMenuShortcut`
- `ContextMenuGroup`
- `ContextMenuPortal`
- `ContextMenuSub`
- `ContextMenuSubContent`
- `ContextMenuSubTrigger`
- `ContextMenuRadioGroup`

## Usage

`ContextMenu` opens on right-click (or the platform's context-menu gesture) on the area wrapped by `ContextMenuTrigger`.

```tsx
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from "@exre/exui"
import "@exre/exui/style.css"

export function FileRow() {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="p-2">report-q3.pdf</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>
          Open
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>Properties</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

`ContextMenuItem` accepts `variant="destructive"` for dangerous actions and `inset` for items aligned under a `ContextMenuLabel`. Selection-style items follow the Radix menu API: `ContextMenuCheckboxItem` takes `checked`/`onCheckedChange`, and `ContextMenuRadioGroup` + `ContextMenuRadioItem` take `value`/`onValueChange`. Nested menus go in `ContextMenuSub` > `ContextMenuSubTrigger` + `ContextMenuSubContent`.

The same structure applies to [DropdownMenu](DropdownMenu.md) and [Menubar](Menubar.md).

For advanced props, use the TypeScript types exposed by the package-root import.
