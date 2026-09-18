# Sonner

## Import

```tsx
import { Toaster, toast } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Toaster`
- `toast`

## Usage

Mount one `Toaster` in your application and trigger notifications through the root `toast` export. `toast` re-exports the same Sonner instance the `Toaster` renders, so the full Sonner method set works as Sonner documents it: call `toast(message, data?)` directly, or use `toast.success`, `toast.error`, `toast.warning`, `toast.info`, `toast.message`, `toast.loading`, `toast.promise`, `toast.custom`, and `toast.dismiss`.

```tsx
import { Toaster, toast } from "@exre/exui"
import "@exre/exui/style.css"

export function App() {
  return (
    <>
      <Toaster />
      <button onClick={() => toast.success("Saved")}>Save</button>
    </>
  )
}
```

To update a notification in place, keep the id returned by `toast` and pass it back; to close one, call `toast.dismiss(id)` (or `toast.dismiss()` with no argument to close all).

[完整示例：通知调用链](../../examples/sonner-notifications.tsx) covers triggering, updating, dismissing, and the theme priority in one runnable file.

Do not install `sonner` yourself. A separately installed copy is a different instance whose toasts never reach the ExUI `Toaster`; the failure is silent. The same boundary applies to the other implementation libraries bundled into `@exre/exui` — see [React setup](../react-setup.md).

## Theme

The `Toaster` resolves its theme in this order:

1. An explicit `theme` prop on `<Toaster />` wins and stays fixed.
2. Without an explicit prop, the `Toaster` follows the surrounding ExUI `ThemeProvider`.
3. Without a provider, it falls back to `"system"` and still mounts without throwing.

Provider switches and OS color scheme changes are followed live. See [Theme usage](../theme-usage.md).

`ToasterProps` is Sonner's own: `position`, `duration`, `richColors`, `closeButton`, `toastOptions`, and the other props pass straight through to the underlying `Toaster`.
