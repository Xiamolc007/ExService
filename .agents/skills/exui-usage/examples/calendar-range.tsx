import * as React from "react"
import { Calendar } from "@exre/exui"
import "@exre/exui/style.css"

type DateRange = { from: Date | undefined; to?: Date | undefined }

export default function CalendarRange() {
  const [range, setRange] = React.useState<DateRange | undefined>(undefined)

  return (
    <div className="flex flex-col gap-2 p-6">
      <Calendar
        mode="range"
        selected={range}
        onSelect={setRange}
        numberOfMonths={2}
      />
      <p className="text-sm text-muted-foreground">
        From: {range?.from ? range.from.toDateString() : "—"} · To:
        {range?.to ? range.to.toDateString() : "—"}
      </p>
    </div>
  )
}
