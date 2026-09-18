# Accordion

## Import

```tsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Accordion`
- `AccordionItem`
- `AccordionTrigger`
- `AccordionContent`

## Usage

```tsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@exre/exui"
import "@exre/exui/style.css"

export function Faq() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="item-1">
        <AccordionTrigger>Is it accessible?</AccordionTrigger>
        <AccordionContent>
          Yes. The trigger is a button and the content is announced when expanded.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Can I open several items at once?</AccordionTrigger>
        <AccordionContent>
          Use type="multiple" on the root to allow that.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
```

Each `AccordionItem` requires a unique `value`. Use `type="single" collapsible` to allow zero or one open item, or `type="multiple"` for independent items. Control the state with `value` and `onValueChange` on the root; `onValueChange` receives a string for single mode and a string array for multiple mode.

`AccordionTrigger` renders its own chevron icons that rotate with the expanded state.

For advanced props, use the TypeScript types exposed by the package-root import.
