import * as React from "react"
import { Calendar } from "@exre/exui"
import "@exre/exui/style.css"

export default function CalendarSingle() {
  const [date, setDate] = React.useState<Date | undefined>(undefined)

  return (
    <div className="flex flex-col gap-2 p-6">
      <Calendar mode="single" selected={date} onSelect={setDate} />
      <p className="text-sm text-muted-foreground">
        Selected: {date ? date.toDateString() : "nothing yet"}
      </p>
    </div>
  )
}
