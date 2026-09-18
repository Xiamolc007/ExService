# Card

## Import

```tsx
import { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Card`
- `CardHeader`
- `CardFooter`
- `CardTitle`
- `CardAction`
- `CardDescription`
- `CardContent`

## Usage

Compose the header, body, and footer within `Card`. Use `size="sm"` for tighter spacing; the default size is `"default"`.

```tsx
<Card size="sm">
  <CardHeader>
    <CardTitle><h2>Workspace</h2></CardTitle>
    <CardDescription>Manage this project's settings.</CardDescription>
  </CardHeader>
  <CardContent>Three members have access.</CardContent>
  <CardFooter>Last updated today</CardFooter>
</Card>
```

`CardAction` places an action in the header's trailing column. `CardTitle` is a styled `div`, so supply a heading element when the card introduces a section.

For advanced props, use the TypeScript types exposed by the package-root import.
