# Kbd

## Import

```tsx
import { Kbd, KbdGroup } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Kbd`
- `KbdGroup`

## Usage

Render a keyboard hint with `Kbd`; group several keys with `KbdGroup`.

```tsx
<KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup>
```

These components only display the keys. Register any shortcut in the application and display the appropriate platform-specific label.

For advanced props, use the TypeScript types exposed by the package-root import.
