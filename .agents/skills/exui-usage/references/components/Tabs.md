# Tabs

## Import

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Tabs`
- `TabsList`
- `TabsTrigger`
- `TabsContent`
- `tabsListVariants`

## Usage

```tsx
const [value, setValue] = React.useState("account")

<Tabs value={value} onValueChange={setValue}>
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">Account settings here.</TabsContent>
  <TabsContent value="password">Password settings here.</TabsContent>
</Tabs>
```

[完整示例：受控标签页](../../examples/tabs-controlled.tsx) shows the controlled value and the active tab readout in one runnable file. For uncontrolled use, pass `defaultValue` instead of `value`/`onValueChange`.

`TabsTrigger` and `TabsContent` are linked by their `value` prop: the content for the active trigger's value is shown. The trigger's text is its accessible name, so label it clearly.

## Variants and orientation

- `TabsList` accepts `variant`: `"default"` (segmented surface) or `"line"` (underline indicator).
- `Tabs` accepts `orientation` (`"horizontal"` by default). With `"vertical"`, the list stacks vertically and the indicator moves to the side; make sure the layout gives the list a column direction that fits.
- Control the active tab with `value` and `onValueChange` on `Tabs` instead of `defaultValue`.

`tabsListVariants` is exported for applying the list styles to custom elements.
