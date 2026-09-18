# ToggleGroup

## Import

```tsx
import { ToggleGroup, ToggleGroupItem } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `ToggleGroup`
- `ToggleGroupItem`

## Usage

```tsx
import * as React from "react"
import { AlignLeftIcon, AlignCenterIcon, AlignRightIcon } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@exre/exui"
import "@exre/exui/style.css"

export function AlignPicker() {
  const [value, setValue] = React.useState("left")

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(next) => {
        if (next) setValue(next)
      }}
    >
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
```

`type` is `"single"` or `"multiple"`, following the Radix toggle-group API; `value`/`onValueChange` carry a string or string array accordingly. The group accepts `variant` and `size` (applied to every item), `spacing` (gap in spacing units, default 2), and `orientation` (`"horizontal"` by default, or `"vertical"`). Give icon-only items an `aria-label`.

For advanced props, use the TypeScript types exposed by the package-root import.
