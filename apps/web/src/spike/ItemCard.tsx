import { createContext, type MouseEvent, useContext } from 'react'
import { de } from '../i18n/de.ts'
import { type FakeItem, getItem } from './fakeItems.ts'

export const CardActions = createContext<{ openDetails: (itemId: string) => void }>({ openDetails: () => {} })

const ICON: Record<FakeItem['kind'], string> = { link: '🔗', pdf: '📄', audio: '🎙️', video: '▶️' }

type Props = { itemId: string; zoom: number; theme: 'light' | 'dark' }

export function ItemCard({ itemId, zoom, theme }: Props) {
  const { openDetails } = useContext(CardActions)
  const item = getItem(itemId)
  const dark = theme === 'dark'
  const palette = dark
    ? { bg: '#24252c', text: '#ececf1', muted: '#a3a6b4', border: '#3a3b45', thumb: '#30313a' }
    : { bg: '#ffffff', text: '#1e1e24', muted: '#5f6370', border: '#e3e5ea', thumb: '#eef0f4' }

  if (!item) return null

  const onClick = (event: MouseEvent) => {
    if ((event.ctrlKey || event.metaKey) && item.url) {
      event.preventDefault()
      window.open(item.url, '_blank', 'noopener,noreferrer')
    }
  }

  // Far zoomed out: a cheap placeholder keeps 300+ cards fluid (PLAN.md 5.4).
  if (zoom < 0.3) {
    return (
      <div
        style={{ background: palette.bg, color: palette.text, borderColor: palette.border }}
        className="flex h-full w-full items-center justify-center gap-3 rounded-xl border-2 text-5xl"
      >
        <span>{ICON[item.kind]}</span>
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: spike card; keyboard access follows with the real cards
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <div
      onClick={onClick}
      onDoubleClick={() => openDetails(item.id)}
      style={{ background: palette.bg, color: palette.text, borderColor: palette.border }}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border text-left shadow-sm"
    >
      {(item.kind === 'link' || item.kind === 'video' || item.kind === 'pdf') && (
        <div style={{ background: palette.thumb }} className="flex min-h-0 flex-1 items-center justify-center text-5xl">
          {ICON[item.kind]}
        </div>
      )}
      <div className="flex shrink-0 flex-col gap-1 p-3">
        <div className="flex items-start gap-2">
          {item.kind === 'audio' && <span className="text-2xl">{ICON.audio}</span>}
          <div className="min-w-0">
            <div className="line-clamp-2 text-[15px] leading-snug font-semibold">{item.title}</div>
            <div style={{ color: palette.muted }} className="truncate text-xs">
              {item.subtitle}
            </div>
          </div>
          <button
            type="button"
            title={de.spike.details}
            onClick={() => openDetails(item.id)}
            style={{ color: palette.muted }}
            className="ml-auto shrink-0 rounded px-1 text-sm hover:opacity-80"
          >
            ↗
          </button>
        </div>
        <div style={{ color: palette.muted }} className="text-[11px]">
          via {item.source} · {item.sender} · {item.date}
        </div>
      </div>
    </div>
  )
}
