import * as React from "react"
import {
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  useComboboxAnchor,
} from "@exre/exui"
import "@exre/exui/style.css"

const tags = [
  { value: "design", label: "Design" },
  { value: "engineering", label: "Engineering" },
  { value: "marketing", label: "Marketing" },
  { value: "support", label: "Support" },
]

export default function ComboboxMultiple() {
  const [value, setValue] = React.useState<string[]>([])
  const anchor = useComboboxAnchor()

  return (
    <div className="p-6">
      <Combobox multiple value={value} onValueChange={setValue}>
        <div ref={anchor} className="w-fit">
          <ComboboxChips>
            {value.map((tag) => (
              <ComboboxChip key={tag}>
                {tags.find((item) => item.value === tag)?.label}
              </ComboboxChip>
            ))}
            <ComboboxChipsInput placeholder="Add tags…" />
          </ComboboxChips>
        </div>
        <ComboboxContent anchor={anchor}>
          <ComboboxList>
            {tags.map((tag) => (
              <ComboboxItem key={tag.value} value={tag.value}>
                {tag.label}
              </ComboboxItem>
            ))}
            <ComboboxEmpty>No tag found.</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
