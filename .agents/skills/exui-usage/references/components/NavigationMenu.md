# NavigationMenu

## Import

```tsx
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuContent, NavigationMenuTrigger, NavigationMenuLink, navigationMenuTriggerStyle } from "@exre/exui"
import "@exre/exui/style.css"
```

## Exports

- `NavigationMenu`
- `NavigationMenuList`
- `NavigationMenuItem`
- `NavigationMenuContent`
- `NavigationMenuTrigger`
- `NavigationMenuLink`
- `NavigationMenuIndicator`
- `NavigationMenuViewport`
- `navigationMenuTriggerStyle`

## Usage

```tsx
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuContent, NavigationMenuTrigger, NavigationMenuLink, navigationMenuTriggerStyle } from "@exre/exui"
import "@exre/exui/style.css"

export function SiteNav() {
  return (
    <NavigationMenu viewport={false}>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
            <a href="/docs">Docs</a>
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Components</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavigationMenuLink asChild>
              <a href="/components/dialog">Dialog</a>
            </NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}
```

To render router links instead of anchors, pass your router's link component through `asChild`.

- The root accepts `viewport` (default `true`): dropdown contents render in a shared viewport bar below the menu. Set it to `false` to anchor each content to its item instead.
- Use `NavigationMenuTrigger` + `NavigationMenuContent` for dropdown entries, and `NavigationMenuLink` for plain links. `navigationMenuTriggerStyle()` applies the trigger look to plain links.
- `NavigationMenuIndicator` and `NavigationMenuViewport` are exported for custom layouts when you position them yourself.

For advanced props, use the TypeScript types exposed by the package-root import.
