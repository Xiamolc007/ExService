import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useTheme,
} from '@exre/exui'

/**
 * 主题切换：三态单选菜单，直接读写 ExUI 的 `ThemeProvider`。
 *
 * 必须渲染在 `<ThemeProvider>` 之内 —— ExUI 的 `useTheme` 在 provider 之外
 * 调用会抛错，这是它的公开契约。挂载点在 `apps/web/src/main.tsx`。
 *
 * 当前选项用 `DropdownMenuRadioGroup` 表达：三项互斥，正好对应它的语义，
 * 选中标记由 ExUI 的 `DropdownMenuRadioItem` 自带，这里不需要额外的指示器。
 */
const THEME_OPTIONS = [
  { value: 'light', label: '浅色', Icon: SunIcon },
  { value: 'dark', label: '深色', Icon: MoonIcon },
  { value: 'system', label: '跟随系统', Icon: MonitorIcon },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const CurrentIcon = THEME_OPTIONS.find((option) => option.value === theme)?.Icon ?? MonitorIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="切换主题">
          <CurrentIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(next) => {
            const option = THEME_OPTIONS.find((candidate) => candidate.value === next)

            if (option) {
              setTheme(option.value)
            }
          }}
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
