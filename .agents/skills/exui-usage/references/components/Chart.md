# Chart

## Import

```tsx
import { Recharts, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle } from "@exre/exui"
import "@exre/exui/style.css"

const { BarChart, Bar, XAxis } = Recharts
```

## Exports

- `ChartContainer`
- `ChartTooltip`
- `ChartTooltipContent`
- `ChartLegend`
- `ChartLegendContent`
- `ChartStyle`
- `Recharts` (bundled chart primitives and their types)

## Usage

Build the chart with primitives from the root `Recharts` namespace. They share
the same bundled instance as `ChartTooltip` and `ChartLegend`.

```tsx
<ChartContainer config={{ visitors: { label: "Visitors", color: "#6366f1" } }}>
  <BarChart data={[{ month: "January", visitors: 10 }, { month: "February", visitors: 20 }]}>
    <XAxis dataKey="month" />
    <Bar dataKey="visitors" fill="var(--color-visitors)" />
    <ChartTooltip content={<ChartTooltipContent />} />
    <ChartLegend content={<ChartLegendContent />} />
  </BarChart>
</ChartContainer>
```

Migrate existing `import { BarChart, Bar } from "recharts"` to the import and
destructuring above. Do not mix charts from an independently installed Recharts
copy with ExUI's Chart parts: tooltip and legend context will be disconnected.
Consumers need no separate `recharts` dependency. The namespace exposes its public
types as well, for example `Recharts.BarProps`.

For advanced props, use the TypeScript types exposed by the package-root import.
