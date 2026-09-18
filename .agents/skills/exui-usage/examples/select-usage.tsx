import * as React from "react"
import {
  Select,
  SelectField,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "@exre/exui"
import "@exre/exui/style.css"

const versions = [
  { value: "1.0", label: "Version 1.0" },
  { value: "2.0", label: "Version 2.0" },
  { value: "3.0", label: "Version 3.0" },
]

export default function SelectUsage() {
  const [version, setVersion] = React.useState<string>()
  const [fruit, setFruit] = React.useState<string>()

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Simplified Select with options:
        </p>
        <Select
          options={versions}
          value={version}
          onChange={setVersion}
          placeholder="Select a version"
        />
        <p className="text-sm text-muted-foreground">
          Selected: {version ?? "nothing yet"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Composed parts with groups:
        </p>
        <SelectField value={fruit} onValueChange={setFruit}>
          <SelectTrigger style={{ width: "12rem" }}>
            <SelectValue placeholder="Pick a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Citrus</SelectLabel>
              <SelectItem value="orange">Orange</SelectItem>
              <SelectItem value="lemon">Lemon</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Berries</SelectLabel>
              <SelectItem value="strawberry">Strawberry</SelectItem>
              <SelectItem value="blueberry">Blueberry</SelectItem>
            </SelectGroup>
          </SelectContent>
        </SelectField>
        <p className="text-sm text-muted-foreground">
          Selected: {fruit ?? "nothing yet"}
        </p>
      </div>
    </div>
  )
}
