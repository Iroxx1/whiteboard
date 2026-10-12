import { describe, expect, it } from 'vitest'
import { normalizeHashtag } from './hashtags.ts'
import { compareByIndex, incomingWins } from './scene.ts'

describe('incomingWins', () => {
  it('accepts new elements', () => {
    expect(incomingWins(undefined, { version: 1, versionNonce: 5 })).toBe(true)
  })

  it('prefers the higher version', () => {
    expect(incomingWins({ version: 2, versionNonce: 1 }, { version: 3, versionNonce: 9 })).toBe(true)
    expect(incomingWins({ version: 3, versionNonce: 9 }, { version: 2, versionNonce: 1 })).toBe(false)
  })

  it('breaks ties with the lower versionNonce', () => {
    expect(incomingWins({ version: 2, versionNonce: 10 }, { version: 2, versionNonce: 4 })).toBe(true)
    expect(incomingWins({ version: 2, versionNonce: 4 }, { version: 2, versionNonce: 10 })).toBe(false)
    expect(incomingWins({ version: 2, versionNonce: 4 }, { version: 2, versionNonce: 4 })).toBe(false)
  })
})

describe('compareByIndex', () => {
  it('sorts by fractional index, then id', () => {
    const elements = [
      { id: 'c', index: 'a2' },
      { id: 'b', index: 'a1' },
      { id: 'a', index: 'a1' },
      { id: 'd', index: 'Zz' },
      { id: 'e', index: null },
    ]
    expect(elements.toSorted(compareByIndex).map((element) => element.id)).toEqual(['e', 'd', 'a', 'b', 'c'])
  })
})

describe('normalizeHashtag', () => {
  it('transliterates umlauts and strips everything else', () => {
    expect(normalizeHashtag('Urlaub Italien')).toBe('urlaubitalien')
    expect(normalizeHashtag('#Küche & Bäder')).toBe('kuechebaeder')
    expect(normalizeHashtag('Straße 2026')).toBe('strasse2026')
    expect(normalizeHashtag('Café_Crème')).toBe('cafe_creme')
    expect(normalizeHashtag('📥 !!!')).toBe('')
  })

  it('limits the length', () => {
    expect(normalizeHashtag('x'.repeat(60))).toHaveLength(40)
  })
})
