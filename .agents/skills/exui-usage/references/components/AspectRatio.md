# AspectRatio

## Import

```tsx
import { AspectRatio } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `AspectRatio`

## Usage

Give the parent a width and set `ratio` to width divided by height. The component reserves the corresponding height for its content.

```tsx
<div style={{ width: 320 }}>
  <AspectRatio ratio={16 / 9}>
    <img src="/preview.jpg" alt="Project preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </AspectRatio>
</div>
```

For advanced props, use the TypeScript types exposed by the package-root import.
