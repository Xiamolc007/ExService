# Collapsible

## Import

```tsx
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Collapsible`
- `CollapsibleTrigger`
- `CollapsibleContent`

## Usage

Place `CollapsibleTrigger` and `CollapsibleContent` inside the root. Use `open`/`onOpenChange` for controlled state, or `defaultOpen` for uncontrolled state.

```tsx
<Collapsible defaultOpen>
  <CollapsibleTrigger>Build details</CollapsibleTrigger>
  <CollapsibleContent>All checks passed.</CollapsibleContent>
</Collapsible>
```

The trigger is a button by default. Use `asChild` with a single custom control; the primitive supplies expanded-state and content relationships.

For advanced props, use the TypeScript types exposed by the package-root import.
