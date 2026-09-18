# Pagination

## Import

```tsx
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Pagination`
- `PaginationContent`
- `PaginationEllipsis`
- `PaginationItem`
- `PaginationLink`
- `PaginationNext`
- `PaginationPrevious`

## Usage

```tsx
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@exre/exui"
import "@exre/exui/style.css"

export function TablePagination({ page }: { page: number }) {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href={`?page=${page - 1}`} />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href={`?page=${page - 1}`}>{page - 1}</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href={`?page=${page}`} isActive>
            {page}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href={`?page=${page + 1}`}>{page + 1}</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href={`?page=${page + 1}`} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
```

`PaginationLink` marks the current page with `isActive` and accepts `size`. `PaginationPrevious`/`PaginationNext` render chevron links; customize their visible labels with the `text` prop and their accessible labels with `aria-label`. These components render anchors and do not expose `asChild`. Use `href` with your router's anchor handling, or intercept `onClick` for application navigation. The application must hide or disable unavailable previous/next destinations and avoid generating page zero.

For advanced props, use the TypeScript types exposed by the package-root import.
