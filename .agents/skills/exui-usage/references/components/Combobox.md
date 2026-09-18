# Combobox

## Import

```tsx
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Combobox`
- `ComboboxInput`
- `ComboboxContent`
- `ComboboxList`
- `ComboboxItem`
- `ComboboxGroup`
- `ComboboxLabel`
- `ComboboxCollection`
- `ComboboxEmpty`
- `ComboboxSeparator`
- `ComboboxChips`
- `ComboboxChip`
- `ComboboxChipsInput`
- `ComboboxTrigger`
- `ComboboxValue`
- `useComboboxAnchor`

## Usage

The combobox is built on Base UI, not Radix. `Combobox` is the root; combine a search input with a popup list. Controlled state uses `value` with `onValueChange`: single selection passes `Value | null`, and with `multiple` it passes `Value[]`.

### Single selection

```tsx
const [value, setValue] = React.useState<string | null>(null)

<Combobox value={value} onValueChange={setValue}>
  <ComboboxInput placeholder="Select a framework" />
  <ComboboxContent>
    <ComboboxList>
      <ComboboxItem value="React">React</ComboboxItem>
      <ComboboxEmpty>No framework found.</ComboboxEmpty>
    </ComboboxList>
  </ComboboxContent>
</Combobox>
```

[完整示例：单选](../../examples/combobox-single.tsx) renders the list from an array and echoes the selected value.

`ComboboxItem` accepts any `value` type and renders its own check indicator; put only the label in children. When items are `{ value, label }` objects, the label fills the input automatically.

### Multiple selection with chips

```tsx
const [value, setValue] = React.useState<string[]>([])
const anchor = useComboboxAnchor()

<Combobox multiple value={value} onValueChange={setValue}>
  <div ref={anchor}>
    <ComboboxChips>
      {value.map((tag) => (
        <ComboboxChip key={tag}>{labelFor(tag)}</ComboboxChip>
      ))}
      <ComboboxChipsInput placeholder="Add tags…" />
    </ComboboxChips>
  </div>
  <ComboboxContent anchor={anchor}>{/* ComboboxList with items */}</ComboboxContent>
</Combobox>
```

[完整示例：多选 chips](../../examples/combobox-multiple.tsx) shows the chip rendering, the anchored popup, and the value array in one runnable file.

Render one `ComboboxChip` per selected value inside `ComboboxChips`; chips map to the value array by order and remove themselves through their built-in remove button (`showRemove={false}` hides it). `useComboboxAnchor()` returns a ref you attach to the element the popup should track; pass it as `anchor` on `ComboboxContent`.

## Parts reference

- `ComboboxInput`: the search input, wrapped in an `InputGroup`. It accepts `showTrigger` (default `true`, the inline chevron button), `showClear` (default `false`, a clear button), and `disabled`.
- `ComboboxContent`: the popup, with portal and positioning built in. Positioning props (`side`, `align`, `sideOffset`, `alignOffset`, `anchor`) pass to the positioner.
- `ComboboxList`: the scrollable list container.
- `ComboboxValue`: renders the current selection for trigger-style comboboxes. `children` can be a function of the selected value, and `placeholder` shows when nothing is selected.
- `ComboboxTrigger`: a standalone button trigger, for use outside `ComboboxInput`.
- `ComboboxGroup` + `ComboboxLabel`: group items with a heading. `ComboboxSeparator` divides groups.
- Root props of note: `multiple`, `value`/`onValueChange`/`defaultValue`, `onOpenChange`, `onInputValueChange`, and optional `items` for providing the item collection to the root.

For the full prop set, use the TypeScript types exposed by the package-root import.
