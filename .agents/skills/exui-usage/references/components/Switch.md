# Switch

## Import

```tsx
import { Switch } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Switch`

## Usage

Use `checked`/`onCheckedChange` for controlled boolean state, or `defaultChecked` for uncontrolled state. `size` accepts `"default"` and `"sm"`.

```tsx
<label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
  <Switch name="notifications" defaultChecked size="sm" />
  Enable notifications
</label>
```

Give the switch a visible label. `disabled`, `required`, and form `name` pass through to the primitive.

For advanced props, use the TypeScript types exposed by the package-root import.
