# Dialog

## Import

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Dialog`
- `DialogClose`
- `DialogContent`
- `DialogDescription`
- `DialogFooter`
- `DialogHeader`
- `DialogOverlay`
- `DialogPortal`
- `DialogTitle`
- `DialogTrigger`

## Usage

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="danger">Delete account</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete account</DialogTitle>
      <DialogDescription>
        This action cannot be undone.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

[完整示例：对话框](../../examples/dialog-usage.tsx) shows the full combination with both footer actions in one runnable file.

## Composition notes

- Open state can stay uncontrolled via `DialogTrigger`, or be controlled with `open` and `onOpenChange` on `Dialog`.
- `DialogTrigger` and `DialogClose` render buttons by default; pass `asChild` to use your own button or link.
- `DialogContent` includes the portal, the overlay, and a close button in the top-right corner. Pass `showCloseButton={false}` to hide that button. There is no need to add `DialogPortal` or `DialogOverlay` yourself.
- `DialogTitle` and `DialogDescription` are required for accessibility; screen readers announce the dialog through them. For purely visual dialogs, render them with `sr-only` text rather than omitting them.
- `DialogFooter` lays out actions and can render a standard close button with `showCloseButton`.
- Escape closes the dialog and focus returns to the trigger, handled by the underlying primitive.
