import { ulid } from '@wb/shared'

// Spike B: stand-in inbox items until the real inbox exists (Phase 2).

export type FakeKind = 'link' | 'pdf' | 'audio' | 'video'

export type FakeItem = {
  id: string
  kind: FakeKind
  title: string
  subtitle: string
  url?: string
  sender: string
  source: string
  date: string
}

const TEMPLATES: Omit<FakeItem, 'id'>[] = [
  {
    kind: 'link',
    title: 'Excalidraw – Virtuelles Whiteboard für Skizzen',
    subtitle: 'excalidraw.com',
    url: 'https://excalidraw.com/',
    sender: 'Anna',
    source: 'Telegram',
    date: '12.10.',
  },
  {
    kind: 'pdf',
    title: 'Reiseplan Toskana.pdf',
    subtitle: '3 Seiten · 1,2 MB',
    sender: 'Maik',
    source: 'Teilen',
    date: '11.10.',
  },
  {
    kind: 'audio',
    title: 'Sprachnachricht',
    subtitle: '0:42 · „Denk an die Fähre am Samstag …“',
    sender: 'Anna',
    source: 'Telegram',
    date: '10.10.',
  },
  {
    kind: 'video',
    title: 'Pasta wie in Bologna',
    subtitle: 'youtube.com · 8:15',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    sender: 'Maik',
    source: 'E-Mail',
    date: '09.10.',
  },
]

export const CARD_SIZE: Record<FakeKind, { width: number; height: number }> = {
  link: { width: 340, height: 300 },
  pdf: { width: 340, height: 260 },
  audio: { width: 340, height: 160 },
  video: { width: 340, height: 240 },
}

const store = new Map<string, FakeItem>()

export function makeItem(templateIndex: number): FakeItem {
  const template = TEMPLATES[templateIndex % TEMPLATES.length] as Omit<FakeItem, 'id'>
  const item = { ...template, id: ulid() }
  store.set(item.id, item)
  return item
}

export function getItem(id: string): FakeItem | undefined {
  return store.get(id)
}

export const initialInbox = (): FakeItem[] => TEMPLATES.map((_, index) => makeItem(index))
