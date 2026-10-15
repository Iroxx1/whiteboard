import type { Item } from '@wb/shared'
import { memo } from 'react'
import { de } from '../i18n/de.ts'
import { assetUrl } from '../lib/api.ts'
import { fileFacts, itemIcon, itemProvenance, itemTitle } from '../ui/itemDisplay.ts'
import { useItem } from './itemsData.ts'

type Theme = 'light' | 'dark'

const SHELL: Record<Theme, string> = {
  light: 'bg-white text-[#1e1e24] border-[#e3e5ea]',
  dark: 'bg-[#1e1e24] text-[#ececf1] border-[#33343d]',
}
const MUTED: Record<Theme, string> = { light: 'text-[#5f6370]', dark: 'text-[#a3a6b4]' }

function Shell({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border font-sans shadow-sm select-none ${SHELL[theme]}`}
      style={{ fontFamily: 'Nunito, system-ui, sans-serif' }}
    >
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
    />
  )
}

function Picture({ id, play = false }: { id: string; play?: boolean }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black/5">
      <img src={assetUrl(id)} alt="" draggable={false} className="h-full w-full object-cover" />
      {play && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-xl text-white">
            ▶
          </span>
        </span>
      )}
    </div>
  )
}

function Body({ item, theme }: { item: Item; theme: Theme }) {
  const muted = MUTED[theme]
  const pending = item.processing === 'pending'
  const picture =
    item.kind === 'link'
      ? item.assets.og_image
      : item.kind === 'pdf'
        ? item.assets.page1
        : item.kind === 'video'
          ? item.assets.poster
          : undefined
  const domain = item.meta.domain
  const textPreview = item.kind === 'document' ? item.meta.textPreview : undefined

  return (
    <>
      {picture ? (
        <Picture id={picture.id} play={item.kind === 'video' || Boolean(item.meta.isVideo)} />
      ) : pending && item.kind !== 'audio' && item.kind !== 'file' ? (
        <div className={`flex min-h-0 flex-1 items-center justify-center gap-2 text-sm ${muted}`}>
          <Spinner /> {de.inbox.processing}
        </div>
      ) : null}
      <div className={`flex flex-col gap-1 p-3 ${picture || pending ? '' : 'flex-1'}`}>
        <div className="flex items-start gap-2">
          {!picture && <span className="text-2xl leading-none">{itemIcon(item)}</span>}
          <div className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-bold break-words">
            {itemTitle(item)}
          </div>
        </div>
        {item.kind === 'link' && item.meta.description && (
          <div className={`line-clamp-2 text-[13px] leading-snug ${muted}`}>{item.meta.description}</div>
        )}
        {item.kind !== 'link' && <div className={`text-[12px] ${muted}`}>{fileFacts(item)}</div>}
        {item.kind === 'audio' && item.meta.transcribing && (
          <div className={`flex items-center gap-2 text-[12px] ${muted}`}>
            <Spinner /> {de.inbox.transcribing}
          </div>
        )}
        {item.kind === 'audio' && item.meta.transcriptPreview && (
          <div className={`line-clamp-4 text-[12px] leading-snug ${muted}`}>{item.meta.transcriptPreview}</div>
        )}
        {textPreview && (
          <pre className={`line-clamp-6 overflow-hidden text-[12px] leading-snug whitespace-pre-wrap ${muted}`}>
            {textPreview}
          </pre>
        )}
        {item.note && <div className="line-clamp-2 text-[13px] leading-snug italic">{item.note}</div>}
        <div className={`mt-auto flex items-center gap-1.5 text-[11px] ${muted}`}>
          {item.kind === 'link' && item.assets.favicon && (
            <img src={assetUrl(item.assets.favicon.id)} alt="" className="h-3.5 w-3.5 rounded-sm" draggable={false} />
          )}
          {item.kind === 'link' && domain && <span className="truncate font-semibold">{domain}</span>}
          <span className="ml-auto truncate">{itemProvenance(item)}</span>
          {item.processing === 'failed' && <span title={de.inbox.failed}>⚠️</span>}
          {item.status === 'trashed' && (
            <span className="rounded bg-red-500/80 px-1 text-white">{de.card.trashed}</span>
          )}
        </div>
      </div>
    </>
  )
}

/** Card rendered by renderEmbeddable for elements with customData.wb (PLAN.md 5.4 "Karten-Rendering"). */
export const ItemCard = memo(function ItemCard({
  itemId,
  zoom,
  theme,
}: {
  itemId: string
  zoom: number
  theme: Theme
}) {
  const { data: item, isPending } = useItem(itemId)
  const muted = MUTED[theme]

  if (isPending) {
    return (
      <Shell theme={theme}>
        <div className={`flex flex-1 items-center justify-center gap-2 text-sm ${muted}`}>
          <Spinner /> {de.card.loading}
        </div>
      </Shell>
    )
  }
  if (!item) {
    return (
      <Shell theme={theme}>
        <div className={`flex flex-1 items-center justify-center text-sm ${muted}`}>{de.card.missing}</div>
      </Shell>
    )
  }
  // Far zoomed out: a light placeholder keeps many cards fast (PLAN.md 5.4 "Performance").
  if (zoom < 0.3) {
    return (
      <Shell theme={theme}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-6xl">{itemIcon(item)}</span>
          <span className="line-clamp-2 text-3xl font-bold">{itemTitle(item)}</span>
        </div>
      </Shell>
    )
  }
  return (
    <Shell theme={theme}>
      <Body item={item} theme={theme} />
    </Shell>
  )
})
