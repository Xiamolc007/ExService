# Menubar

## Import

```tsx
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Menubar`
- `MenubarPortal`
- `MenubarMenu`
- `MenubarTrigger`
- `MenubarContent`
- `MenubarGroup`
- `MenubarSeparator`
- `MenubarLabel`
- `MenubarItem`
- `MenubarShortcut`
- `MenubarCheckboxItem`
- `MenubarRadioGroup`
- `MenubarRadioItem`
- `MenubarSub`
- `MenubarSubTrigger`
- `MenubarSubContent`

## Usage

`Menubar` renders a horizontal menu bar of `MenubarMenu` entries; each has a trigger and a dropdown content, with keyboard navigation between menus built in.

```tsx
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarCheckboxItem, MenubarSeparator, MenubarShortcut } from "@exre/exui"
import "@exre/exui/style.css"

export function AppMenubar() {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>
            New file
            <MenubarShortcut>⌘N</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarCheckboxItem checked>Show sidebar</MenubarCheckboxItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem variant="destructive">Delete project</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}
```

`MenubarItem` accepts `variant="destructive"` for dangerous actions and `inset` for items aligned under a `MenubarLabel`. Selection-style items follow the Radix menu API: `MenubarCheckboxItem` takes `checked`/`onCheckedChange`, and `MenubarRadioGroup` + `MenubarRadioItem` take `value`/`onValueChange`. Nested menus go in `MenubarSub` > `MenubarSubTrigger` + `MenubarSubContent`.

The same item structure applies to [DropdownMenu](DropdownMenu.md) and [ContextMenu](ContextMenu.md).

For advanced props, use the TypeScript types exposed by the package-root import.
