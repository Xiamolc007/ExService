# Slider

## Import

```tsx
import { Slider } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Slider`

## Usage

Values are number arrays: one value creates one thumb, and two values create a range. Use `value`/`onValueChange` for controlled state or `defaultValue` for uncontrolled state.

```tsx
<Slider defaultValue={[25]} min={0} max={100} step={5} />
```

`min` and `max` default to 0 and 100. Always supply the intended value array: if both value props are omitted, the wrapper renders two thumbs. `onValueCommit` handles changes after an interaction finishes. Provide accessible names for the generated thumb controls in your application's integration; the wrapper does not expose per-thumb props.

For advanced props, use the TypeScript types exposed by the package-root import.
