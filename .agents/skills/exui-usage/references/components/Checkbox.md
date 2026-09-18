# Checkbox

## Import

```tsx
import { Checkbox } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Checkbox`

## Usage

Use `checked` and `onCheckedChange` for controlled state, or `defaultChecked` for an initial uncontrolled value. The checked state can be `true`, `false`, or `"indeterminate"`; a boolean form field can normalize changes with `next === true`.

```tsx
<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
  <Checkbox name="terms" defaultChecked />
  Accept the terms
</label>
```

Pass `disabled`, `required`, and `name` as needed. For validation, pair `aria-invalid` on the control with the [Field](Field.md) label and error parts.

For advanced props, use the TypeScript types exposed by the package-root import.
