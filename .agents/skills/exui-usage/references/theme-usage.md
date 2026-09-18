# ExUI theme usage

Control light, dark, and system themes in a React consumer with `ThemeProvider` and `useTheme`, and understand how the `Toaster` picks up the theme. Installation prerequisites are covered in [React setup](react-setup.md).

## Provider and hook

Wrap the application once with `ThemeProvider` and read the theme with `useTheme`:

```tsx
import { ThemeProvider, useTheme } from "@exre/exui"

<ThemeProvider>
  <Layout />
</ThemeProvider>
```

`useTheme` returns `{ theme, setTheme }`. Calling `useTheme` outside a `ThemeProvider` throws `useTheme must be used within a ThemeProvider`; this is the public contract, so do not call it in components that may render without the provider.

[完整示例：主题切换与通知跟随](../examples/theme-provider-usage.tsx) shows the provider with a persisted light/dark/system switcher and a `Toaster` that follows the provider live.

## Provider props

- `defaultTheme`: `"light"`, `"dark"`, or `"system"`. Defaults to `"system"`.
- `storageKey`: the `localStorage` key that persists the choice. Defaults to `"theme"`. Changes through `setTheme` are persisted and synchronized across browser tabs.
- `disableTransitionOnChange`: temporarily disables CSS transitions while switching to avoid color cross-fades. Defaults to `true`.

## How themes resolve

`theme` and `setTheme` accept exactly `"light"`, `"dark"`, or `"system"`.

- When the theme is `"system"`, the provider follows the operating system preference live through `prefers-color-scheme` and updates without remounting.
- The provider applies the resolved `"light"` or `"dark"` class to `document.documentElement`, which is what the Token stylesheet keys on.

## Toaster theme priority

The `Toaster` resolves its theme in this order:

1. An explicit `theme` prop on `<Toaster />` wins and stays fixed, even if the surrounding provider changes.
2. Without an explicit prop, the `Toaster` follows the surrounding `ThemeProvider`.
3. With no provider at all, the `Toaster` falls back to `"system"` and still mounts without throwing.

```tsx
import { Toaster } from "@exre/exui"

{/* follows the provider */}
<Toaster />

{/* stays light regardless of the provider */}
<Toaster theme="light" />
```

Mount one `Toaster` per surface; each mounted `Toaster` renders every toast from the shared instance. [完整示例：通知调用链](../examples/sonner-notifications.tsx) toggles the explicit `theme` prop and the provider side by side so both rules can be verified live.

## Server-side rendering limitation

`ThemeProvider` reads `localStorage` while initializing its state. Rendering it on a server throws. In the browser, it reads `window.matchMedia` when applying `"system"` in an effect. Adding `"use client"` does not make it SSR-safe; in frameworks that prerender client components, the initial HTML render still runs on the server. The provider must only mount in the browser, for example behind a client-only mount after hydration. This is a documented limitation of the current package; it does not ship an SSR-safe provider or hydration strategy.

## Pitch Black is a Token CSS layer, not a provider theme

The Token stylesheet exposes the Pitch Black palette under the `.pitch-black` class, next to Light under `:root` and Dark under `.dark`. The React `ThemeProvider` is a separate contract that only knows `"light"`, `"dark"`, and `"system"`.

- Never call `setTheme("pitch-black")`. It is outside the theme union, and the provider is not the mechanism that drives `.pitch-black`.
- The provider only adds and removes the `light` and `dark` classes on the root element. It does not clean up a manually applied `.pitch-black`, and switching between the two control styles does not reset the other one. If you mix them, class cleanup is your responsibility.

See [Token usage](token-usage.md) for the Token-side theme contract.
