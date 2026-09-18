# Attachment

## Import

```tsx
import { Attachment, AttachmentGroup, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions, AttachmentAction, AttachmentTrigger } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Attachment`
- `AttachmentGroup`
- `AttachmentMedia`
- `AttachmentContent`
- `AttachmentTitle`
- `AttachmentDescription`
- `AttachmentActions`
- `AttachmentAction`
- `AttachmentTrigger`

## Usage

`Attachment` presents a file or link card with an upload state. `state` drives the visual treatment: `"idle"` (dashed placeholder), `"uploading"`, `"processing"`, `"error"`, or `"done"` (default). `size` (`"default"`, `"sm"`, `"xs"`) and `orientation` (`"horizontal"`, `"vertical"`) shape the card.

```tsx
import { FileIcon } from "lucide-react"
import { Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription } from "@exre/exui"
import "@exre/exui/style.css"

export function UploadingFile() {
  return (
    <Attachment state="uploading">
      <AttachmentMedia>
        <FileIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>report-q3.pdf</AttachmentTitle>
        <AttachmentDescription>Uploading… 64%</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  )
}
```

For a link-style attachment, use `AttachmentTrigger` with `asChild` to render the card as an `a` element, and put trailing controls in `AttachmentActions` > `AttachmentAction` (for example, a remove button). `AttachmentGroup` lays out several attachments with wrapping.

For advanced props, use the TypeScript types exposed by the package-root import.
