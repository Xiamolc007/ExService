# DropdownMenu

## Import

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `DropdownMenu`
- `DropdownMenuPortal`
- `DropdownMenuTrigger`
- `DropdownMenuContent`
- `DropdownMenuGroup`
- `DropdownMenuLabel`
- `DropdownMenuItem`
- `DropdownMenuCheckboxItem`
- `DropdownMenuRadioGroup`
- `DropdownMenuRadioItem`
- `DropdownMenuSeparator`
- `DropdownMenuShortcut`
- `DropdownMenuSub`
- `DropdownMenuSubTrigger`
- `DropdownMenuSubContent`

## Usage

```tsx
import { MoreHorizontalIcon } from "lucide-react"
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from "@exre/exui"
import "@exre/exui/style.css"

export function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Open actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem>
          Rename
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

`DropdownMenuItem` accepts `variant="destructive"` for dangerous actions and `inset` for items aligned under a `DropdownMenuLabel`. Selection-style items follow the Radix menu API: `DropdownMenuCheckboxItem` takes `checked`/`onCheckedChange`, and `DropdownMenuRadioGroup` + `DropdownMenuRadioItem` take `value`/`onValueChange`. Nested menus go in `DropdownMenuSub` > `DropdownMenuSubTrigger` + `DropdownMenuSubContent`.

The same structure applies to [ContextMenu](ContextMenu.md) and [Menubar](Menubar.md).

For advanced props, use the TypeScript types exposed by the package-root import.
