# ExUI React setup

Set up `@exre/exui` in a React 19 project: install the right dependencies, load the stylesheet once, and keep implementation libraries out of your dependency tree. For Tokens without React, read [Token usage](token-usage.md) instead.

## Install

```bash
pnpm add @exre/exui react@19 react-dom@19
```

React and React DOM are the only host dependencies. They are declared as optional peers of `@exre/exui`, so a component consumer installs them explicitly. The supported range is React 19 (`>=19.0.0 <20`).

TypeScript projects also install the matching type packages:

```bash
pnpm add -D @types/react@19 @types/react-dom@19
```

The type packages are not optional peers and are not installed transitively. Without them, TypeScript has no React types for ExUI's component declarations.

The package root ships an ESM entry. CommonJS consumers can use the `@exre/exui/tokens` subpath, which also declares a `require` export, but not the React component root.

## Load the stylesheet once

```tsx
import "@exre/exui/style.css"
```

Import the component stylesheet once per application. `@exre/exui/style.css` already includes the Token stylesheet and the font stylesheet; do not import `@exre/exui/tokens/style.css` or `@exre/exui/tokens/font.css` again in the same React application, because that duplicates the CSS.

The stylesheet contains the component styles and the Token custom properties. It does not include general-purpose layout utilities (Tailwind or otherwise): a class such as `h-96` or `max-w-md` from the examples does nothing in a consumer that has no utility-class setup of its own. Use inline styles or your own CSS for layout outside the components.

## Sizing

ExUI publishes its scalable sizes in `rem` against a 16px base, so a 16px root font size reproduces the original pixel design exactly and any other root font size rescales type, controls, spacing, icons, and ordinary radii together. ExUI never sets a root font size itself:

```css
html {
  font-size: 20px; /* every scalable ExUI size grows by 20 / 16 */
}
```

Hairline borders and dividers, focus rings, shadows, the capsule radius, and third-party internals (Sonner toasts, Recharts axes and series) keep their own fixed sizes and do not scale. See [Token usage](token-usage.md) for the full list of fixed exceptions and for the `parseFloat(token)` caveat.

### Scale custom React content with the library

Use rem strings for new scalable lengths in React styles: `padding: "1.5rem"` follows the root font size, whereas `padding: 24` stays in pixels. Preserve unitless properties such as `lineHeight: 1.5` and fixed effects such as `border: "1px solid var(--exui-border-default)"`. Prefer the existing component and Token values before inventing new geometry.

Keep root-font control at application level and let content wrap or grow when text gets larger. Use [EXUI_SCALING_RULES.md](../guides/EXUI_SCALING_RULES.md) for concise authoring rules and a global CSS scale reference: 16px by default, 21px at viewport heights of at least 1440px, and 32px at heights of at least 2160px. Third-party developers can copy that file alone into their AI instructions.

## Implementation dependencies are bundled

Only React and React DOM stay external to the package build. Every implementation library that ExUI components are built on — Sonner, Radix UI, Base UI, cmdk, vaul, react-day-picker, Recharts, and the rest — is bundled into the package output.

Do not install these libraries to use ExUI:

- They add nothing: the components already run on the bundled copies.
- A separately installed copy is a different instance. For notifications this breaks silently: a `sonner` copy you install yourself has its own toast state, so its `toast` calls never reach the ExUI `Toaster`.
- The same instance rule covers providers. A Radix or Base UI provider you render yourself belongs to your copy, not ExUI's, so it cannot supply context to ExUI components. Where you would reach for an upstream provider, use ExUI's exported one instead — `DirectionProvider`, `TooltipProvider`, or `SidebarProvider`.

Use notifications through the package root so you share the bundled instance:

```tsx
import { Toaster, toast } from "@exre/exui"

export function App() {
  return (
    <>
      <Toaster />
      <button onClick={() => toast.success("Saved")}>Save</button>
    </>
  )
}
```

`toast` re-exports the same Sonner instance the `Toaster` renders, so `toast.success`, `toast.error`, `toast.dismiss`, and the other Sonner call signatures work as documented by Sonner. Theme behavior of the `Toaster` is covered in [Theme usage](theme-usage.md), and the runnable demo is [完整示例：通知调用链](../examples/sonner-notifications.tsx).

## Icons

ExUI does not re-export `lucide-react`. When your own code renders icons, install it directly, as described in [Icon usage](icon-usage.md).

## Where to go next

- Import components from the package root; the full inventory is in the [generated component export inventory](generated/component-exports.md).
- Read [Theme usage](theme-usage.md) before wiring `ThemeProvider`, `useTheme`, or `Toaster` theming.
