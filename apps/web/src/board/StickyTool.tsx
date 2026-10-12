import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  FONT_FAMILY,
  ROUNDNESS,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useState } from 'react'
import { de } from '../i18n/de.ts'

// Pastel colours from PLAN.md 5.3.
export const STICKY_COLORS = [
  { key: 'yellow', value: '#FFF3BF' },
  { key: 'orange', value: '#FFE8CC' },
  { key: 'green', value: '#D3F9D8' },
  { key: 'blue', value: '#D0EBFF' },
  { key: 'pink', value: '#FFDEEB' },
  { key: 'purple', value: '#E5DBFF' },
] as const

const STICKY_WIDTH = 240
const STICKY_HEIGHT = 180
const COLOR_KEY = 'wb.stickyColor'

function storedColor(): string {
  try {
    const value = localStorage.getItem(COLOR_KEY)
    if (STICKY_COLORS.some((color) => color.value === value)) return value as string
  } catch {
    // ignore
  }
  return STICKY_COLORS[0].value
}

/** Adds a sticky note (rounded rectangle without border, bound text) in the middle of the view. */
export function addSticky(api: ExcalidrawImperativeAPI, color: string) {
  const state = api.getAppState()
  const center = viewportCoordsToSceneCoords(
    { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 },
    state,
  )
  const elements = convertToExcalidrawElements([
    {
      type: 'rectangle',
      x: center.x - STICKY_WIDTH / 2,
      y: center.y - STICKY_HEIGHT / 2,
      width: STICKY_WIDTH,
      height: STICKY_HEIGHT,
      backgroundColor: color,
      strokeColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      // The label inherits the container's (transparent) stroke colour unless set explicitly (SPIKES.md).
      // Excalidraw only creates the bound text for a non-empty label; a space keeps it editable with
      // these settings (Enter or double-click on the selected note).
      label: {
        text: ' ',
        strokeColor: '#1e1e1e',
        fontFamily: FONT_FAMILY.Nunito,
        fontSize: 20,
        textAlign: 'left',
        verticalAlign: 'top',
      },
    },
  ])
  const container = elements.find((element) => element.type === 'rectangle')
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: container ? { selectedElementIds: { [container.id]: true as const } } : null,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
}

/** Small floating bar: "Haftnotiz" plus colour choice (PLAN.md 5.3). */
export function StickyTool({ api }: { api: ExcalidrawImperativeAPI }) {
  const [color, setColor] = useState(storedColor)
  const choose = (value: string) => {
    setColor(value)
    try {
      localStorage.setItem(COLOR_KEY, value)
    } catch {
      // ignore
    }
  }
  return (
    <div className="wb-sticky-tool pointer-events-auto flex items-center gap-1 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-1 shadow-md">
      <button
        type="button"
        onClick={(event) => {
          addSticky(api, color)
          // Keyboard focus back to the board, so Enter edits the new note instead of adding another.
          event.currentTarget.blur()
        }}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-[var(--wb-hover)]"
      >
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-sm border border-black/10"
          style={{ backgroundColor: color }}
        />
        {de.board.sticky}
      </button>
      {STICKY_COLORS.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-label={de.board.stickyColor(de.board.colors[option.key])}
          aria-pressed={color === option.value}
          title={de.board.colors[option.key]}
          onClick={() => choose(option.value)}
          className={`h-6 w-6 rounded-md border ${color === option.value ? 'border-[var(--wb-accent)] ring-2 ring-[var(--wb-accent)]/40' : 'border-black/10'}`}
          style={{ backgroundColor: option.value }}
        />
      ))}
    </div>
  )
}
