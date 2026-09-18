# Direction

## Import

```tsx
import { DirectionProvider, useDirection } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `DirectionProvider`
- `useDirection`

## Usage

`DirectionProvider` supplies direction to the bundled Radix components that read its context, such as [NavigationMenu](NavigationMenu.md). It does not set a DOM `dir` attribute or configure the separate Base UI context used by Combobox. Sidebar placement remains controlled by its `side` prop.

```tsx
import { DirectionProvider } from "@exre/exui"
import "@exre/exui/style.css"

export function App() {
  return (
    <div dir="rtl">
      <DirectionProvider dir="rtl">
        {/* Radix direction context and DOM text direction now agree */}
      </DirectionProvider>
    </div>
  )
}
```

`dir` accepts `"ltr"` or `"rtl"`. The optional `direction` alias takes precedence over `dir`. `useDirection(localDirection?)` resolves its argument first, then the provider, then `"ltr"`; it does not inspect `<html dir>`. Set the DOM direction and provider consistently when using RTL.

For advanced props, use the TypeScript types exposed by the package-root import.
