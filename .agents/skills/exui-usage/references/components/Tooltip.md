# Tooltip

## Import

```tsx
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Tooltip`
- `TooltipContent`
- `TooltipProvider`
- `TooltipTrigger`

## Usage

```tsx
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="outline">Hover me</Button>
    </TooltipTrigger>
    <TooltipContent>A helpful hint</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

[完整示例：图标工具栏](../../examples/tooltip-toolbar.tsx) shows one provider wrapping an icon toolbar with accessible labels; the tooltips appear on hover and on keyboard focus.

## Composition notes

- Wrap the area that uses tooltips in one `TooltipProvider` so open delay and other defaults are shared. The provider sets `delayDuration` to `0` by default; pass a custom value in milliseconds to delay appearance.
- `TooltipTrigger` renders a button by default; pass `asChild` to attach the tooltip to your own control. The accessible description link to the trigger is handled by the primitive.
- `TooltipContent` renders its own arrow and portals to the body. Use `side` and `align` (with `sideOffset`/`alignOffset`) for placement.
- Tooltips describe or label their trigger on hover and focus; do not put interactive content or essential information in a tooltip alone.
