# Toggle

## Import

```tsx
import { Toggle, toggleVariants } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Toggle`
- `toggleVariants`

## Usage

Use a toggle for an action that stays pressed, such as a formatting option. Control it with `pressed`/`onPressedChange`, or initialize it with `defaultPressed`.

```tsx
<Toggle variant="outline" size="sm" aria-label="Toggle bold">B</Toggle>
```

`variant` accepts `"default"` or `"outline"`; `size` accepts `"default"`, `"sm"`, or `"lg"`. The primitive supplies `aria-pressed`. Use [ToggleGroup](ToggleGroup.md) for related options.

For advanced props, use the TypeScript types exposed by the package-root import.
