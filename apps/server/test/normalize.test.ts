import { describe, expect, it } from 'vitest'
import { type IngestPayload, normalizePayload } from '../src/ingest/normalize.ts'
import { resolveHashtags } from '../src/lib/hashtags.ts'
import { kindForMime, sanitizeFilename } from '../src/lib/mime.ts'
import { findUrls, normalizeUrl, stripUrls, youtubeId } from '../src/lib/urls.ts'

const boards = new Map([
  ['urlaub', 'BOARD_URLAUB'],
  ['kueche', 'BOARD_KUECHE'],
])

const payload = (extra: Partial<IngestPayload>): IngestPayload => ({ userId: 'u', source: 'pwa', files: [], ...extra })
const fakeSniff = async (_file: string, filename: string) =>
  filename.endsWith('.jpg') ? 'image/jpeg' : filename.endsWith('.pdf') ? 'application/pdf' : 'audio/ogg'

describe('urls', () => {
  it('finds URLs in text without trailing punctuation', () => {
    expect(findUrls('Schau mal: https://example.org/a?b=1. Und www.test.de!')).toEqual([
      'https://example.org/a?b=1',
      'https://www.test.de/',
    ])
    expect(findUrls('(siehe https://de.wikipedia.org/wiki/Kiel_(Schiff))')).toEqual([
      'https://de.wikipedia.org/wiki/Kiel_(Schiff)',
    ])
    expect(findUrls('kein link hier, nur example.org')).toEqual([])
  })

  it('normalises for duplicate detection', () => {
    expect(normalizeUrl('https://WWW.Example.org/path/?utm_source=x&b=2&a=1#top')).toBe('example.org/path?a=1&b=2')
    expect(normalizeUrl('https://example.org/?fbclid=abc')).toBe('example.org')
    expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe('youtube:dQw4w9WgXcQ')
    expect(normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=1')).toBe('youtube:dQw4w9WgXcQ')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
  })

  it('extracts YouTube ids', () => {
    expect(youtubeId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeId('https://example.org/watch?v=x')).toBeNull()
  })

  it('strips URLs from text', () => {
    expect(stripUrls('Toller Artikel https://example.org/x  \n\n\n lesen!', ['https://example.org/x'])).toBe(
      'Toller Artikel\n\nlesen!',
    )
  })
})

describe('hashtags', () => {
  it('resolves known boards, keeps unknown tags and handles #inbox', () => {
    expect(resolveHashtags('Für #Urlaub merken', boards)).toEqual({
      boardId: 'BOARD_URLAUB',
      inboxOnly: false,
      unknown: [],
      text: 'Für merken',
    })
    expect(resolveHashtags('#Küche und #garten', boards)).toMatchObject({
      boardId: 'BOARD_KUECHE',
      unknown: ['garten'],
      text: 'und #garten',
    })
    expect(resolveHashtags('#urlaub #inbox', boards)).toMatchObject({ boardId: null, inboxOnly: true })
    expect(resolveHashtags('https://example.org/#urlaub', boards).boardId).toBeNull()
  })
})

describe('normalizePayload', () => {
  it('Android: page title in title, URL in text', async () => {
    const result = await normalizePayload(
      payload({ title: 'Ein Artikel', text: 'https://example.org/artikel' }),
      boards,
    )
    expect(result.drafts).toEqual([
      expect.objectContaining({ kind: 'link', title: 'Ein Artikel', note: null, url: 'https://example.org/artikel' }),
    ])
  })

  it('Android: title and URL both in text', async () => {
    const result = await normalizePayload(payload({ text: 'Ein Artikel https://example.org/a' }), boards)
    expect(result.drafts[0]).toMatchObject({ kind: 'link', title: null, note: 'Ein Artikel' })
  })

  it('text equal to the title is dropped', async () => {
    const result = await normalizePayload(payload({ title: 'Seite', text: 'Seite\nhttps://example.org' }), boards)
    expect(result.drafts[0]).toMatchObject({ title: 'Seite', note: null })
  })

  it('several URLs become a group of links with the same note', async () => {
    const result = await normalizePayload(payload({ text: 'Ideen: https://a.example/ und https://b.example/' }), boards)
    expect(result.drafts.map((draft) => [draft.kind, draft.url, draft.note])).toEqual([
      ['link', 'https://a.example/', 'Ideen: und'],
      ['link', 'https://b.example/', 'Ideen: und'],
    ])
  })

  it('plain text becomes a note', async () => {
    const result = await normalizePayload(payload({ text: 'Milch kaufen' }), boards)
    expect(result.drafts).toEqual([expect.objectContaining({ kind: 'note', note: 'Milch kaufen', title: null })])
  })

  it('files: one item each, kind by content, note on the first, links from the text join the group', async () => {
    const result = await normalizePayload(
      payload({
        text: 'Urlaubsfotos #urlaub https://maps.example/x',
        files: [
          { filename: 'IMG_1.jpg', size: 10, tmpPath: 'a' },
          { filename: 'plan.pdf', size: 20, tmpPath: 'b' },
          { filename: 'PTT-2026.opus', size: 30, tmpPath: 'c' },
        ],
      }),
      boards,
      fakeSniff,
    )
    expect(result.targetBoardId).toBe('BOARD_URLAUB')
    expect(result.drafts.map((draft) => [draft.kind, draft.note, draft.fileIndex])).toEqual([
      ['image', 'Urlaubsfotos', 0],
      ['pdf', null, 1],
      ['audio', null, 2],
      ['link', null, null],
    ])
    expect(result.drafts[1]?.meta).toMatchObject({ filename: 'plan.pdf', mime: 'application/pdf', ext: 'pdf' })
  })

  it('YouTube links are marked as video with a privacy-friendly embed', async () => {
    const result = await normalizePayload(payload({ url: 'https://youtu.be/dQw4w9WgXcQ' }), boards)
    expect(result.drafts[0]?.meta).toMatchObject({
      isVideo: true,
      embed: { provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' },
    })
  })

  it('an explicit board wins over hashtags; #inbox forces the inbox', async () => {
    expect((await normalizePayload(payload({ text: 'x #urlaub', targetBoardId: 'OTHER' }), boards)).targetBoardId).toBe(
      'OTHER',
    )
    expect((await normalizePayload(payload({ text: 'x #urlaub #inbox' }), boards)).targetBoardId).toBeNull()
    expect((await normalizePayload(payload({ text: 'x #unbekannt' }), boards)).unknownHashtags).toEqual(['unbekannt'])
  })

  it('returns nothing for an empty payload', async () => {
    expect((await normalizePayload(payload({ text: '   ' }), boards)).drafts).toEqual([])
  })
})

describe('mime helpers', () => {
  it('maps MIME types to kinds', () => {
    expect(kindForMime('image/heic')).toBe('image')
    expect(kindForMime('image/svg+xml')).toBe('file')
    expect(kindForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document')
    expect(kindForMime('text/markdown')).toBe('document')
    expect(kindForMime('application/zip')).toBe('file')
    expect(kindForMime('video/mp4')).toBe('video')
  })

  it('sanitises file names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\x\\Bericht "final".pdf')).toBe('Bericht _final_.pdf')
    expect(sanitizeFilename('\u0000\u202e.')).toBe('datei')
  })
})
