# AlertDialog

## Import

```tsx
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `AlertDialog`
- `AlertDialogAction`
- `AlertDialogCancel`
- `AlertDialogContent`
- `AlertDialogDescription`
- `AlertDialogFooter`
- `AlertDialogHeader`
- `AlertDialogMedia`
- `AlertDialogOverlay`
- `AlertDialogPortal`
- `AlertDialogTitle`
- `AlertDialogTrigger`

## Usage

```tsx
import { Button, AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "@exre/exui"
import "@exre/exui/style.css"

export function DeleteAccount() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="danger">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. All of your data will be permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="danger">Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

## Composition notes

- An alert dialog is for destructive or high-attention confirmations: it does not close on outside click and expects an explicit decision. Escape and focus handling come from the underlying primitive.
- `AlertDialogAction` and `AlertDialogCancel` close the dialog when pressed. Both render as buttons with the package button styles and accept `variant` and `size`; cancel defaults to `variant="outline"`.
- `AlertDialogContent` accepts `size`: `"default"` (centered text, actions below) or `"sm"` (side-by-side actions).
- `AlertDialogMedia` renders the round icon slot above the title for prominent confirmations; give it a single icon as children.
- `AlertDialogTitle` and `AlertDialogDescription` are required for accessibility, as with [Dialog](Dialog.md).

For advanced props, use the TypeScript types exposed by the package-root import.
