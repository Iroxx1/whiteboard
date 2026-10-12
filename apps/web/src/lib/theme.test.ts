import { describe, expect, it } from 'vitest'
import { parsePreference, resolveTheme } from './theme.ts'

describe('theme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to system for unknown stored values', () => {
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference('blue')).toBe('system')
    expect(parsePreference('dark')).toBe('dark')
  })
})
