# Input

## Import

```tsx
import { Input } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Input`

## Usage

`Input` accepts native input props. Use `value`/`onChange` for controlled text, or `defaultValue` for an initial uncontrolled value.

```tsx
<label>
  Email
  <Input name="email" type="email" autoComplete="email" required />
</label>
```

Keep a visible label; a placeholder alone is insufficient. Add `aria-invalid` and connect descriptive/error text with `aria-describedby` when using the [Field](Field.md) parts.

For advanced props, use the TypeScript types exposed by the package-root import.
