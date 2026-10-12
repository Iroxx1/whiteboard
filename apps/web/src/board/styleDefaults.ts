import { FONT_FAMILY } from '@excalidraw/excalidraw'
import type { AppState } from '@excalidraw/excalidraw/types'

// Miro-like defaults for new elements (PLAN.md 5.3).
export const STYLE_DEFAULTS: Partial<AppState> = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemRoundness: 'round',
  currentItemStrokeWidth: 2,
  currentItemFontSize: 20,
  currentItemFillStyle: 'solid',
}

// Tool settings a user may change; remembered per user in this browser.
const REMEMBERED = [
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemStartArrowhead',
  'currentItemEndArrowhead',
  'currentItemRoundness',
  'currentItemArrowType',
] as const satisfies readonly (keyof AppState)[]

const storageKey = (userId: string) => `wb.style.${userId}`

export function pickStyle(appState: Partial<AppState>): Partial<AppState> {
  const style: Record<string, unknown> = {}
  for (const key of REMEMBERED) if (appState[key] !== undefined) style[key] = appState[key]
  return style as Partial<AppState>
}

export function loadStyle(userId: string): Partial<AppState> {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '{}') as Partial<AppState>
    return { ...STYLE_DEFAULTS, ...pickStyle(stored) }
  } catch {
    return STYLE_DEFAULTS
  }
}

/** Returns a saver that writes only when the remembered settings actually changed. */
export function createStyleSaver(userId: string) {
  let last = ''
  return (appState: AppState) => {
    const json = JSON.stringify(pickStyle(appState))
    if (json === last) return
    last = json
    try {
      localStorage.setItem(storageKey(userId), json)
    } catch {
      // Private mode: settings are simply not remembered.
    }
  }
}
