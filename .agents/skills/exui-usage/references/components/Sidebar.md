# Sidebar

## Import

```tsx
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `Sidebar`
- `SidebarContent`
- `SidebarFooter`
- `SidebarGroup`
- `SidebarGroupAction`
- `SidebarGroupContent`
- `SidebarGroupLabel`
- `SidebarHeader`
- `SidebarInput`
- `SidebarInset`
- `SidebarMenu`
- `SidebarMenuAction`
- `SidebarMenuBadge`
- `SidebarMenuButton`
- `SidebarMenuItem`
- `SidebarMenuSkeleton`
- `SidebarMenuSub`
- `SidebarMenuSubButton`
- `SidebarMenuSubItem`
- `SidebarProvider`
- `SidebarRail`
- `SidebarSeparator`
- `SidebarTrigger`
- `useSidebar`

## Usage

`Sidebar` parts require a `SidebarProvider`. `useSidebar` and every sidebar part that reads the context throw without one. Wrap the whole layout, not the sidebar alone: the provider renders the flex wrapper that places `Sidebar` next to `SidebarInset`.

```tsx
<SidebarProvider>
  <Sidebar collapsible="icon">{/* header, groups, footer */}</Sidebar>
  <SidebarInset>
    <header>
      <SidebarTrigger />
    </header>
  </SidebarInset>
</SidebarProvider>
```

[完整示例：完整布局](../../examples/sidebar-layout.tsx) shows the provider, the menu groups with `tooltip` and `isActive`, the trigger, and the icon-collapse mode in one runnable file.

`SidebarTrigger` toggles the sidebar and belongs in the main area, typically next to the page header.

## Variants and collapse behavior

`Sidebar` accepts `side` (`"left"` or `"right"`), `variant` (`"sidebar"`, `"floating"`, or `"inset"`), and `collapsible`:

- `collapsible="offcanvas"` (default): the sidebar slides out of view and the layout collapses.
- `collapsible="icon"`: the sidebar collapses to an icon rail. Give each `SidebarMenuButton` a `tooltip` so collapsed items reveal their label; mark the active item with `isActive`. The `tooltip` prop renders a [Tooltip](Tooltip.md), so a `TooltipProvider` from the package root must wrap the tree — without one, the tooltip throws. `TooltipProvider` can wrap the whole application once, as described in [Tooltip usage](Tooltip.md).
- `collapsible="none"`: no collapsing; the sidebar takes fixed space.

## State, keyboard, and responsive behavior

- Desktop state (`open`) can stay uncontrolled or be controlled with `open` and `onOpenChange` on `SidebarProvider`.
- On desktop, `Ctrl`/`Cmd`+`B` toggles the sidebar.
- Desktop open-state changes write the `sidebar_state` cookie with a seven-day lifetime. The provider does not read this cookie on mount: the application must read it and supply `defaultOpen` or controlled `open` to restore a saved state. `defaultOpen` defaults to `true`; mobile open state is separate.
- Below the 768px breakpoint the sidebar renders in a mobile `Sheet` controlled by `openMobile`/`setOpenMobile` from `useSidebar()`; `SidebarTrigger` and the keyboard shortcut toggle the mobile sheet automatically in that mode.

## Menu structure and submenus

Use `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton` for navigation items. `SidebarMenuButton` renders a `button`; pass `asChild` to render a link instead. `SidebarMenuBadge` adds trailing metadata, `SidebarMenuAction` adds a trailing action button (`showOnHover` to reveal it on hover), and nested links go in `SidebarMenuSub` > `SidebarMenuSubItem` > `SidebarMenuSubButton`.
