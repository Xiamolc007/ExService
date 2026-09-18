import * as React from "react"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldContent,
  Input,
} from "@exre/exui"
import "@exre/exui/style.css"

export default function FieldUsage() {
  const [email, setEmail] = React.useState("")
  const invalid = email.length > 0 && !email.includes("@")
  const formErrors = [{ message: "Email is required" }]

  return (
    <div className="flex flex-col gap-6 p-6">
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
      <Field>
        <FieldContent>
          <FieldLabel htmlFor="newsletter">Newsletter</FieldLabel>
          <Input id="newsletter" aria-invalid aria-describedby="newsletter-error" />
          <FieldError id="newsletter-error" errors={formErrors} />
        </FieldContent>
      </Field>
    </div>
  )
}
