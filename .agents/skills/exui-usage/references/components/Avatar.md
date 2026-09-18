# Avatar

## Import

```tsx
import { Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Avatar`
- `AvatarImage`
- `AvatarFallback`
- `AvatarGroup`
- `AvatarGroupCount`
- `AvatarBadge`

## Usage

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@exre/exui"
import "@exre/exui/style.css"

export function UserAvatar() {
  return (
    <Avatar>
      <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      <AvatarFallback>SC</AvatarFallback>
    </Avatar>
  )
}
```

`Avatar` accepts `size`: `"default"`, `"sm"`, or `"lg"`. `AvatarFallback` renders while the image loads or when it fails.

To stack avatars, use `AvatarGroup`; `AvatarGroupCount` renders the overflow count:

```tsx
<AvatarGroup>
  <Avatar>
    <AvatarImage src="/a.png" alt="Alice" />
    <AvatarFallback>A</AvatarFallback>
  </Avatar>
  <Avatar>
    <AvatarImage src="/b.png" alt="Bob" />
    <AvatarFallback>B</AvatarFallback>
  </Avatar>
  <AvatarGroupCount>+3</AvatarGroupCount>
</AvatarGroup>
```

`AvatarBadge` renders a small status badge pinned to the avatar corner.

For advanced props, use the TypeScript types exposed by the package-root import.
