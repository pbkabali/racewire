import { useTheme } from '../app/providers/useTheme'
import type { ThemeChoice } from '../app/providers/themeContext'

const options: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
  { value: 'system', label: 'System', icon: '◐' },
]

/** Three-way theme control. 'system' is a real option, not an absence of one. */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-md border border-edge p-0.5"
    >
      {options.map((option) => {
        const active = choice === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.label}
            onClick={() => setChoice(option.value)}
            className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
              active ? 'bg-accent text-accent-fg' : 'text-fg-subtle hover:text-fg'
            }`}
          >
            <span aria-hidden>{option.icon}</span>
            <span className="sr-only">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
