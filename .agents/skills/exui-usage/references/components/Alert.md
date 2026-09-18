# Alert

## Import

```tsx
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Alert`
- `AlertTitle`
- `AlertDescription`
- `AlertAction`

## Usage

```tsx
import { CircleAlertIcon } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@exre/exui"
import "@exre/exui/style.css"

export function ErrorAlert() {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Upload failed</AlertTitle>
      <AlertDescription>
        The file could not be uploaded. Check your connection and try again.
      </AlertDescription>
    </Alert>
  )
}
```

`Alert` accepts `variant`: `"default"` or `"destructive"`. An optional leading icon aligns itself with the title and description columns.

`AlertAction` positions a compact action in the top-right corner, such as a dismiss button:

```tsx
<Alert>
  <AlertTitle>New version available</AlertTitle>
  <AlertDescription>Restart to apply the update.</AlertDescription>
  <AlertAction>
    <button aria-label="Dismiss">Dismiss</button>
  </AlertAction>
</Alert>
```

For advanced props, use the TypeScript types exposed by the package-root import.
