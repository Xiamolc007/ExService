# InputOTP

## Import

```tsx
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `InputOTP`
- `InputOTPGroup`
- `InputOTPSlot`
- `InputOTPSeparator`

## Usage

```tsx
import * as React from "react"
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@exre/exui"
import { MinusIcon } from "lucide-react"
import "@exre/exui/style.css"

export function OtpInput() {
  const [value, setValue] = React.useState("")

  return (
    <InputOTP maxLength={6} value={value} onChange={setValue}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator>
        <MinusIcon />
      </InputOTPSeparator>
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}
```

`maxLength` on the root decides how many slots the code holds; each `InputOTPSlot` takes its `index`. The value is controlled with `value`/`onChange` (a plain string). `InputOTPSeparator` renders between groups, and `InputOTP` accepts `containerClassName` to style the outer container.

For form integration and validation messaging, wrap it in the [Field](Field.md) parts.

For advanced props, use the TypeScript types exposed by the package-root import.
