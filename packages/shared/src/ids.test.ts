import { describe, expect, it } from 'vitest'
import { isUlid, itemIdFromLink, ulid } from './ids.ts'

describe('ulid', () => {
  it('produces valid, time-sortable ids', () => {
    const a = ulid(1_700_000_000_000)
    const b = ulid(1_700_000_000_001)
    expect(isUlid(a)).toBe(true)
    expect(isUlid(b)).toBe(true)
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true)
  })
})

describe('itemIdFromLink', () => {
  const id = '01JAB3C4D5E6F7G8H9JKMNPQRS'

  it('accepts item permalinks on any domain', () => {
    expect(itemIdFromLink(`https://board.example.de/i/${id}`)).toBe(id)
    expect(itemIdFromLink(`https://other.example/i/${id}/`)).toBe(id)
    expect(itemIdFromLink(`/i/${id}`)).toBe(id)
  })

  it('rejects everything else', () => {
    expect(itemIdFromLink('https://www.youtube.com/watch?v=abc')).toBeNull()
    expect(itemIdFromLink(`https://board.example.de/i/${id}/x`)).toBeNull()
    expect(itemIdFromLink('https://board.example.de/i/not-a-ulid')).toBeNull()
  })
})
