# Table

## Import

```tsx
import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Table`
- `TableHeader`
- `TableBody`
- `TableFooter`
- `TableHead`
- `TableRow`
- `TableCell`
- `TableCaption`

## Usage

```tsx
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@exre/exui"
import "@exre/exui/style.css"

export function InvoicesTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>INV-001</TableCell>
          <TableCell>Paid</TableCell>
          <TableCell className="text-right">$250.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>INV-002</TableCell>
          <TableCell>Pending</TableCell>
          <TableCell className="text-right">$150.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
```

The parts map to the semantic table elements (`table`, `thead`, `tbody`, `tfoot`, `th`, `tr`, `td`, `caption`), so screen readers and browser table features work as with plain HTML. Mark header cells with `TableHead`; use `TableCaption` for an accessible description and `TableFooter` for summary rows.

For advanced props, use the TypeScript types exposed by the package-root import.
