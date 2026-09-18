# Command

## Import

```tsx
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Command`
- `CommandDialog`
- `CommandInput`
- `CommandList`
- `CommandEmpty`
- `CommandGroup`
- `CommandItem`
- `CommandShortcut`
- `CommandSeparator`

## Usage

`Command` builds a searchable, keyboard-navigable list. Items filter against the input automatically; give each `CommandItem` a unique `value` when you need deterministic filtering and selection.

```tsx
<Command className="w-96">
  <CommandInput placeholder="Type a command or search…" />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    <CommandGroup heading="Suggestions">
      <CommandItem>Calendar</CommandItem>
    </CommandGroup>
  </CommandList>
</Command>
```

`CommandItem` accepts an optional leading icon and a `CommandShortcut` for its hotkey hint.

For a command palette, use `CommandDialog`. It wraps `Command` in a dialog with a screen-reader heading; open it by controlling `open`/`onOpenChange`, for example from a `Ctrl`/`Cmd`+K listener. [完整示例：命令面板](../../examples/command-palette.tsx) shows the keyboard shortcut, the grouped list, and the shortcuts in one runnable file.

For advanced props, use the TypeScript types exposed by the package-root import.
