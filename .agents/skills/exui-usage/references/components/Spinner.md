# Spinner

## Import

```tsx
import { Spinner } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Spinner`

## Usage

Use the spinner for an in-progress action. It renders an animated SVG with `role="status"` and the default accessible label `"Loading"`.

```tsx
<Spinner aria-label="Saving changes" />
```

When adjacent text already communicates status, avoid duplicate announcements by marking the icon decorative with `aria-hidden="true"`.

For advanced props, use the TypeScript types exposed by the package-root import.
