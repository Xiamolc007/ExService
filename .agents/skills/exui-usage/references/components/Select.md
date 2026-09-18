# Select

## Import

```tsx
import { Select } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Select`
- `SelectField`
- `SelectContent`
- `SelectGroup`
- `SelectItem`
- `SelectLabel`
- `SelectScrollDownButton`
- `SelectScrollUpButton`
- `SelectSeparator`
- `SelectTrigger`
- `SelectValue`

## Usage

There are two ways to use the select: the simplified `Select` wrapper and the composed parts.

### Simplified Select

Pass `options` and control the value with `value` and `onChange`. The trigger, value display, content, and items are rendered for you.

```tsx
const [value, setValue] = React.useState<string>()

<Select
  options={[
    { value: "1.0", label: "Version 1.0" },
    { value: "2.0", label: "Version 2.0" },
  ]}
  value={value}
  onChange={setValue}
  placeholder="Select a version"
/>
```

Options are `{ label, value, disabled? }` items. `Select` also accepts `defaultValue`, `disabled`, `size` (`"default"` or `"sm"`), and a `className` for the trigger. Note that the simplified wrapper uses `onChange`, not the Radix-style `onValueChange`.

### Composed parts

For grouped items, custom labels, separators, or full Radix Select control, compose from `SelectField`:

```tsx
<SelectField value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Pick a fruit" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Citrus</SelectLabel>
      <SelectItem value="orange">Orange</SelectItem>
    </SelectGroup>
  </SelectContent>
</SelectField>
```

[完整示例：选择器](../../examples/select-usage.tsx) shows both variants side by side in one runnable file.

`SelectItem` renders its own check indicator; put only the label in children. `SelectContent` opens in a portal with `position="item-aligned"` by default; set `position="popper"` for popover-style placement. The composed path follows the Radix Select API — `SelectField` is the Radix root, so `value`/`onValueChange`/`defaultValue` and the other root props apply.

For form integration, wrap either variant in the [Field](Field.md) parts.
