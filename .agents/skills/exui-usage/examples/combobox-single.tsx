import * as React from "react"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@exre/exui"
import "@exre/exui/style.css"

const frameworks = ["React", "Vue", "Svelte", "Solid"]

export default function ComboboxSingle() {
  const [value, setValue] = React.useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2 p-6">
      <Combobox value={value} onValueChange={setValue}>
        <ComboboxInput placeholder="Select a framework" />
        <ComboboxContent>
          <ComboboxList>
            {frameworks.map((framework) => (
              <ComboboxItem key={framework} value={framework}>
                {framework}
              </ComboboxItem>
            ))}
            <ComboboxEmpty>No framework found.</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p className="text-sm text-muted-foreground">
        Selected: {value ?? "nothing yet"}
      </p>
    </div>
  )
}
