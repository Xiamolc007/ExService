import { HomeIcon, InboxIcon, CalendarIcon } from "lucide-react"
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
  TooltipProvider,
} from "@exre/exui"
import "@exre/exui/style.css"

const navItems = [
  { title: "Home", icon: HomeIcon },
  { title: "Inbox", icon: InboxIcon },
  { title: "Calendar", icon: CalendarIcon },
]

export default function SidebarLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader />
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Application</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item, index) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={index === 0}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter />
        </Sidebar>
        <SidebarInset>
          <header className="flex items-center gap-2 border-b p-2">
            <SidebarTrigger />
            <span className="text-sm font-medium">Page content</span>
          </header>
          <main className="p-4 text-sm">
            Main area. Toggle the sidebar with the trigger or Ctrl/Cmd+B;
            with collapsible="icon" the menu collapses to an icon rail
            and the buttons reveal their tooltip.
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
