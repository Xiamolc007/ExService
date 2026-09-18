# ButtonGroup

## Import

```tsx
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `ButtonGroup`
- `ButtonGroupSeparator`
- `ButtonGroupText`
- `buttonGroupVariants`

## Usage

`ButtonGroup` joins buttons (and adjacent controls) into one visual cluster with shared corners. Direct children that are buttons merge their borders and rounding.

```tsx
import { CalendarIcon, ListIcon, TableIcon } from "lucide-react"
import { Button, ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@exre/exui"
import "@exre/exui/style.css"

export function ViewSwitcher() {
  return (
    <ButtonGroup>
      <Button variant="outline" size="sm">
        <ListIcon /> List
      </Button>
      <Button variant="outline" size="sm">
        <TableIcon /> Table
      </Button>
      <ButtonGroupSeparator />
      <ButtonGroupText>
        <CalendarIcon /> This week
      </ButtonGroupText>
    </ButtonGroup>
  )
}
```

`orientation` (`"horizontal"` by default, or `"vertical"`) switches the cluster direction. `ButtonGroupText` renders a non-interactive segment, and `ButtonGroupSeparator` divides segments with a rule. A `Select` trigger or `InputGroup` as a direct child joins the cluster the same way.

For advanced props, use the TypeScript types exposed by the package-root import.
