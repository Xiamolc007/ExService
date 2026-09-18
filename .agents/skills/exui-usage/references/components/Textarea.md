# Textarea

## Import

```tsx
import { Textarea } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Textarea`

## Usage

`Textarea` accepts native textarea props. Use `value`/`onChange` for controlled text or `defaultValue` for uncontrolled text.

```tsx
<label>
  Description
  <Textarea name="description" rows={4} maxLength={500} />
</label>
```

The default styles use content-based field sizing where supported and disable manual resizing. Override with your own CSS or `style` if the application requires a fixed height or a resize handle. See [Field](Field.md) for validation layout.

For advanced props, use the TypeScript types exposed by the package-root import.
