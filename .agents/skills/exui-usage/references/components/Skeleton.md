# Skeleton

## Import

```tsx
import { Skeleton } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Skeleton`

## Usage

Set dimensions appropriate for the content that is loading. `Skeleton` is an animated `div`; it does not fetch data or announce loading automatically.

```tsx
<div aria-busy="true" aria-label="Loading profile">
  <Skeleton aria-hidden="true" style={{ width: "12rem", height: "1rem" }} />
</div>
```

Replace the placeholder and clear the surrounding busy state when data arrives.

For advanced props, use the TypeScript types exposed by the package-root import.
