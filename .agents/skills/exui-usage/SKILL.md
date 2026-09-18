---
name: exui-usage
description: Guide external projects in choosing and using ExUI Tokens, component recipes, React components, and Lucide icons from the public @exre/exui package and its tokens and Fumadocs docs-theme subpaths.
---

# ExUI Usage

Guide consuming projects through ExUI's public package entries. Do not use this skill for changes to ExUI's own package source.

## Start with the task

Check the consuming project's installed ExUI version, React version, stylesheet entry, and layout styling setup before applying an example. Use the directories below to select the relevant guide, component reference, and example; read only those files. Consult the generated inventories when exact exports or Token paths are needed, rather than loading every reference first.

| Task                                                          | Read first                                                                                               | Continue with                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Install or integrate React UI                                 | [React setup](references/react-setup.md)                                                                 | The component directory below                                                                            |
| Build components or content that follow the root-font scale | [Standalone ExUI scaling rules](guides/EXUI_SCALING_RULES.md) | [React sizing guidance](references/react-setup.md#sizing) |
| Build a form or selection flow                                | [Field](references/components/Field.md)                                                                  | Input and selection components; the matching example below                                               |
| Build navigation or an application shell                      | [Sidebar](references/components/Sidebar.md) or [NavigationMenu](references/components/NavigationMenu.md) | Navigation and layout components                                                                         |
| Add notifications                                             | [Sonner / Toaster / toast](references/components/Sonner.md)                                              | [Notification example](examples/sonner-notifications.tsx)                                                |
| Switch themes or integrate SSR                                | [Theme usage](references/theme-usage.md)                                                                 | [Theme example](examples/theme-provider-usage.tsx); read the SSR limitation before mounting the provider |
| Theme a Fumadocs UI docs site                                 | [Fumadocs docs theme](references/docs-theme.md)                                                          | [Theme usage](references/theme-usage.md) for the one-theme-driver rule                                   | 
| Use CSS / JavaScript Tokens or recipes, with or without React | [Token usage](references/token-usage.md)                                                                 | [Exact Token paths and CSS properties](references/generated/token-paths.md)                              |
| Add icons or icon-only controls                               | [Icon usage](references/icon-usage.md)                                                                   | [Button](references/components/Button.md) or [Tooltip](references/components/Tooltip.md)                 |
| Find an exact public symbol or type                           | [Component export inventory](references/generated/component-exports.md)                                  | Its linked component reference and the installed package's public types                                  |

## File layout

```text
exui-usage/
├── SKILL.md                  Task routing and complete resource directory
├── guides/EXUI_SCALING_RULES.md  Standalone rules to copy into a consuming project's AI instructions
├── references/
│   ├── react-setup.md        React installation, CSS, dependency boundaries
│   ├── theme-usage.md        Provider, hook, notifications, SSR limitations
│   ├── docs-theme.md         Fumadocs UI colour contract and its boundaries
│   ├── token-usage.md        Framework-neutral Tokens and component recipes
│   ├── icon-usage.md         Lucide setup and accessible icon usage
│   ├── components/*.md      Component imports, composition, props, examples
│   └── generated/*.md       Generated public exports and Token path inventories
├── examples/*.tsx           Complete examples to adapt into a consuming app
├── scripts/                 Maintainer inventory and example validation
├── package-selection.json   Maintainer source selection for generation
└── agents/openai.yaml       Skill UI metadata
```

## Copyable rules for third-party AI

For third-party AI handoff, copy [EXUI_SCALING_RULES.md](guides/EXUI_SCALING_RULES.md) on its own. It explains how to build React components and content that follow ExUI's root-font scale, including deliberate pixel exceptions, without requiring this skill directory.

## Component directory

Each link opens the component's usage reference, including its public parts. Categories are navigation aids; the generated export inventory defines the full symbol list. ThemeProvider and useTheme are covered by the theme guide above. Sonner is the reference filename for the public Toaster and toast exports.

| Use case                      | Component references                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions                       | [Button](references/components/Button.md), [ButtonGroup](references/components/ButtonGroup.md), [Toggle](references/components/Toggle.md), [ToggleGroup](references/components/ToggleGroup.md)                                                                                                                                                                                                                                                            |
| Form structure and text input | [Field](references/components/Field.md), [Label](references/components/Label.md), [Input](references/components/Input.md), [InputGroup](references/components/InputGroup.md), [InputOTP](references/components/InputOTP.md), [Textarea](references/components/Textarea.md)                                                                                                                                                                                |
| Selection and dates           | [Checkbox](references/components/Checkbox.md), [RadioGroup](references/components/RadioGroup.md), [Switch](references/components/Switch.md), [Slider](references/components/Slider.md), [Select](references/components/Select.md), [NativeSelect](references/components/NativeSelect.md), [Combobox](references/components/Combobox.md), [Calendar](references/components/Calendar.md)                                                                    |
| Navigation and commands       | [Breadcrumb](references/components/Breadcrumb.md), [NavigationMenu](references/components/NavigationMenu.md), [Menubar](references/components/Menubar.md), [DropdownMenu](references/components/DropdownMenu.md), [ContextMenu](references/components/ContextMenu.md), [Command](references/components/Command.md), [Pagination](references/components/Pagination.md), [Tabs](references/components/Tabs.md), [Sidebar](references/components/Sidebar.md) |
| Overlays                      | [Dialog](references/components/Dialog.md), [AlertDialog](references/components/AlertDialog.md), [Sheet](references/components/Sheet.md), [Drawer](references/components/Drawer.md), [Popover](references/components/Popover.md), [HoverCard](references/components/HoverCard.md), [Tooltip](references/components/Tooltip.md)                                                                                                                             |
| Layout and disclosure         | [Accordion](references/components/Accordion.md), [Collapsible](references/components/Collapsible.md), [Card](references/components/Card.md), [AspectRatio](references/components/AspectRatio.md), [Resizable](references/components/Resizable.md), [ScrollArea](references/components/ScrollArea.md), [Separator](references/components/Separator.md), [Direction](references/components/Direction.md)                                                    |
| Data and media                | [Table](references/components/Table.md), [Chart](references/components/Chart.md), [Carousel](references/components/Carousel.md), [Avatar](references/components/Avatar.md), [Badge](references/components/Badge.md), [Item](references/components/Item.md), [Kbd](references/components/Kbd.md)                                                                                                                                                           |
| Feedback and loading          | [Alert](references/components/Alert.md), [Sonner / Toaster / toast](references/components/Sonner.md), [Empty](references/components/Empty.md), [Progress](references/components/Progress.md), [Skeleton](references/components/Skeleton.md), [Spinner](references/components/Spinner.md)                                                                                                                                                                  |
| Messaging and attachments     | [Attachment](references/components/Attachment.md), [Bubble](references/components/Bubble.md), [Message](references/components/Message.md), [MessageScroller](references/components/MessageScroller.md), [Marker](references/components/Marker.md)                                                                                                                                                                                                         |

## Example directory

These are complete TSX examples, not a standalone application. Follow React setup before adapting them. Layout utility classes require the consumer's own utility setup; otherwise translate those classes to local CSS or inline styles. Component references also contain smaller inline examples; a component without a standalone TSX file is still documented above.

| Example file                                                      | Demonstrates                                      | Usage reference                                             |
| ----------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| [calendar-single.tsx](examples/calendar-single.tsx)               | Single-date selection                             | [Calendar](references/components/Calendar.md)               |
| [calendar-range.tsx](examples/calendar-range.tsx)                 | Date-range selection                              | [Calendar](references/components/Calendar.md)               |
| [combobox-single.tsx](examples/combobox-single.tsx)               | Controlled single selection                       | [Combobox](references/components/Combobox.md)               |
| [combobox-multiple.tsx](examples/combobox-multiple.tsx)           | Multiple selection, chips, anchored popup         | [Combobox](references/components/Combobox.md)               |
| [command-palette.tsx](examples/command-palette.tsx)               | Command palette composition                       | [Command](references/components/Command.md)                 |
| [dialog-usage.tsx](examples/dialog-usage.tsx)                     | Dialog composition and state                      | [Dialog](references/components/Dialog.md)                   |
| [field-usage.tsx](examples/field-usage.tsx)                       | Form labels, validation, errors                   | [Field](references/components/Field.md)                     |
| [message-scroller-usage.tsx](examples/message-scroller-usage.tsx) | Message list scrolling                            | [MessageScroller](references/components/MessageScroller.md) |
| [select-usage.tsx](examples/select-usage.tsx)                     | Select composition                                | [Select](references/components/Select.md)                   |
| [sidebar-layout.tsx](examples/sidebar-layout.tsx)                 | Sidebar application layout                        | [Sidebar](references/components/Sidebar.md)                 |
| [sonner-notifications.tsx](examples/sonner-notifications.tsx)     | Trigger, update, dismiss, and theme notifications | [Sonner](references/components/Sonner.md)                   |
| [tabs-controlled.tsx](examples/tabs-controlled.tsx)               | Controlled active tab                             | [Tabs](references/components/Tabs.md)                       |
| [theme-provider-usage.tsx](examples/theme-provider-usage.tsx)     | Theme switching and notification integration      | [Theme usage](references/theme-usage.md)                    |
| [tooltip-toolbar.tsx](examples/tooltip-toolbar.tsx)               | Tooltips for toolbar controls                     | [Tooltip](references/components/Tooltip.md)                 |

## Defaults

- Prefer theme semantic Tokens before component recipes or foundation Tokens.
- Prefer an existing `@exre/exui` React component over rebuilding it from `componentRecipes`.
- Prefer `lucide-react` for general-purpose React icons, subject to the documented narrow exceptions.
- Import only from the package root, its declared CSS subpaths, or the `@exre/exui/tokens` subpath. Never use package `src/`, `dist/`, or `types/` paths as consumer APIs.
- Do not import Token CSS or font CSS again when `@exre/exui/style.css` is already loaded; the component stylesheet includes both.
- Token consumers do not need React. Component consumers install React, React DOM, and their type packages themselves.

## ExUI integration pitfalls

- **Composition APIs:** read the selected component reference before using upstream shadcn, Radix, or Base UI patterns. For example, ExUI's Combobox uses Base UI; do not assume Radix composition or callback signatures.
- **Notifications:** import both `toast` and `Toaster` from `@exre/exui`. A separately installed Sonner instance does not share the ExUI notification state. See React setup and the Sonner reference.
- **Themes and SSR:** consult Theme usage before mounting ThemeProvider. It currently reads browser APIs during rendering; `"use client"` alone does not make it SSR-safe. Pitch Black is a Token CSS class, not a `setTheme` value.
- **Version differences:** if a documented export or prop is absent from the installed package's public types, check the installed version before adapting the example. Do not compensate with private imports or invent an API.

## Maintaining this directory

When updating the skill in the ExUI repository, add links here for every component reference, usage guide, generated inventory, and TSX example. Keep usage guidance in its existing reference and link a new example from the relevant reference as well as this directory.

- [update.mjs](scripts/update.mjs): `--check` validates directory coverage, relative file links, and generated inventories; `--self-test` checks rejection cases; `--write` refreshes generated inventories only.
- [verify-examples.mjs](scripts/verify-examples.mjs): validates example imports and documentation links, then compiles the examples in an isolated packed consumer. Use `--self-test` for its rejection fixtures.

Run these scripts from the ExUI repository root with `node skills/exui-usage/scripts/<script>`. They are maintainer checks, not prerequisites for using ExUI in another project.
