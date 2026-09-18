# Label

## Import

```tsx
import { Label } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Label`

## Usage

Connect the label to a control with matching `htmlFor` and `id`. Import the control from the package root as well.

```tsx
<Label htmlFor="display-name">Display name</Label>
<input id="display-name" name="displayName" />
```

Use [Field](Field.md) when the control also needs a description, validation message, or grouped layout.

For advanced props, use the TypeScript types exposed by the package-root import.
