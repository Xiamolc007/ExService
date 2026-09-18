# RadioGroup

## Import

```tsx
import { RadioGroup, RadioGroupItem } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `RadioGroup`
- `RadioGroupItem`

## Usage

Use one unique string `value` per option. Control selection with `value`/`onValueChange`, or use `defaultValue` for uncontrolled selection.

```tsx
<RadioGroup defaultValue="standard" name="density" aria-label="Density">
  <label><RadioGroupItem value="standard" /> Standard</label>
  <label><RadioGroupItem value="compact" /> Compact</label>
</RadioGroup>
```

Label every item. The primitive handles selection and arrow-key navigation; `disabled` can apply to the group or individual items.

For advanced props, use the TypeScript types exposed by the package-root import.
