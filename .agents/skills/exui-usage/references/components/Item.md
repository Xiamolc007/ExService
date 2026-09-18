# Item

## Import

```tsx
import { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Item`
- `ItemMedia`
- `ItemContent`
- `ItemActions`
- `ItemGroup`
- `ItemSeparator`
- `ItemTitle`
- `ItemDescription`
- `ItemHeader`
- `ItemFooter`

## Usage

`Item` is a generic list-entry surface: media on one side, title and description in the middle, actions at the other end.

```tsx
import { BellIcon, MoreHorizontalIcon } from "lucide-react"
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@exre/exui"
import "@exre/exui/style.css"

export function NotificationItem() {
  return (
    <Item>
      <ItemMedia>
        <BellIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Deploy finished</ItemTitle>
        <ItemDescription>production · 2 minutes ago</ItemDescription>
      </ItemContent>
      <ItemActions>
        <button aria-label="Item actions">
          <MoreHorizontalIcon />
        </button>
      </ItemActions>
    </Item>
  )
}
```

`Item` accepts `variant` (`"default"`, `"outline"`, `"muted"`), `size` (`"default"`, `"sm"`, `"xs"`), and `asChild` to render the whole item as a link or button. `ItemMedia` styles icons or images; `ItemActions` aligns trailing controls. Stack items in `ItemGroup`, optionally divided by `ItemSeparator`, with `ItemHeader`/`ItemFooter` for section chrome.

For advanced props, use the TypeScript types exposed by the package-root import.
