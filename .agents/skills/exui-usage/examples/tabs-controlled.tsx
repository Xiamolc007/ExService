import * as React from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@exre/exui"
import "@exre/exui/style.css"

export default function TabsControlled() {
  const [value, setValue] = React.useState("account")

  return (
    <div className="flex flex-col gap-3 p-6">
      <Tabs value={value} onValueChange={setValue}>
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="account">Account settings here.</TabsContent>
        <TabsContent value="password">Password settings here.</TabsContent>
        <TabsContent value="notifications">
          Notification settings here.
        </TabsContent>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        Active tab: {value}. Uncontrolled usage replaces value/onValueChange
        with defaultValue.
      </p>
    </div>
  )
}
