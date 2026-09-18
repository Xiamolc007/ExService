# NativeSelect

## Import

```tsx
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `NativeSelect`
- `NativeSelectOptGroup`
- `NativeSelectOption`

## Usage

`NativeSelect` styles the platform's native `<select>`, so options are real `<option>` elements and mobile platforms get their native pickers.

```tsx
import * as React from "react"
import { NativeSelect, NativeSelectOption, NativeSelectOptGroup } from "@exre/exui"
import "@exre/exui/style.css"

export function TimezonePicker() {
  const [value, setValue] = React.useState("utc")

  return (
    <NativeSelect
      value={value}
      onChange={(event) => setValue(event.target.value)}
      aria-label="Timezone"
    >
      <NativeSelectOptGroup label="Common">
        <NativeSelectOption value="utc">UTC</NativeSelectOption>
        <NativeSelectOption value="cet">Central European Time</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  )
}
```

`NativeSelect` accepts `size` (`"default"` or `"sm"`) and the standard select props, including `required` and `disabled`. Group options with `NativeSelectOptGroup`; use `disabled` on individual `NativeSelectOption` entries as needed.

For the styled list-and-popup alternative, use [Select](Select.md) instead. For form wrapping, see [Field](Field.md).

For advanced props, use the TypeScript types exposed by the package-root import.
