import { de } from '../i18n/de.ts'
import { type ThemePreference, useTheme } from '../lib/theme.ts'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: de.theme.system },
  { value: 'light', label: de.theme.light },
  { value: 'dark', label: de.theme.dark },
]

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()
  return (
    <fieldset
      className="inline-flex rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-0.5 text-sm"
      aria-label={de.theme.label}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={preference === option.value}
          onClick={() => setPreference(option.value)}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            preference === option.value
              ? 'bg-[var(--wb-accent)] text-white'
              : 'text-[var(--wb-muted)] hover:text-[var(--wb-text)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
