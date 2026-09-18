import { BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-react"
import {
  Button,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@exre/exui"
import "@exre/exui/style.css"

const tools = [
  { label: "Bold", icon: BoldIcon },
  { label: "Italic", icon: ItalicIcon },
  { label: "Underline", icon: UnderlineIcon },
]

export default function TooltipToolbar() {
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3 p-6">
        <div className="flex gap-2">
          {tools.map((tool) => (
            <Tooltip key={tool.label}>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label={tool.label}>
                  <tool.icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tool.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          One provider wraps the toolbar so delay settings are shared; the
          default delay is 0, so the tooltips appear immediately on hover and
          focus.
        </p>
      </div>
    </TooltipProvider>
  )
}
