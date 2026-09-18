# Field

## Import

```tsx
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldContent, FieldTitle } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Field`
- `FieldLabel`
- `FieldDescription`
- `FieldError`
- `FieldGroup`
- `FieldLegend`
- `FieldSeparator`
- `FieldSet`
- `FieldContent`
- `FieldTitle`

## Usage

`Field` lays out one form control with its label, description, and error message. Place the control and the texts in `FieldContent`:

```tsx
const [email, setEmail] = React.useState("")
const invalid = email.length > 0 && !email.includes("@")

<Field data-invalid={invalid || undefined}>
  <FieldContent>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input
      id="email"
      type="email"
      value={email}
      onChange={(event) => setEmail(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "email-help email-error" : "email-help"}
    />
    <FieldDescription id="email-help">We only use this to sign you in.</FieldDescription>
    {invalid && <FieldError id="email-error">Enter a valid email address.</FieldError>}
  </FieldContent>
</Field>
```

[完整示例：表单字段](../../examples/field-usage.tsx) shows the live validation and the `errors` array rendering in one runnable file.

Set `data-invalid` on `Field` to switch the group into its invalid styling, and pass `aria-invalid` on the control itself for assistive technology.

The parts do not automatically connect labels, descriptions, or errors to a control. Supply matching `htmlFor`/`id` and `aria-describedby` values, using unique IDs for each field instance.

`FieldError` can also render an array of form-library errors directly; duplicates are collapsed:

```tsx
<FieldError errors={formErrors} />
```

`Field` accepts `orientation`: `"vertical"` (default), `"horizontal"`, or `"responsive"` (stacks, then rows at the group container breakpoint). For grouping several fields use `FieldSet` with `FieldLegend`, or `FieldGroup`; `FieldSeparator` renders a divider with optional text between them.

For advanced props, use the TypeScript types exposed by the package-root import.
