import { describe, expect, it } from 'vitest'
import { isChunkLoadError, shouldReload } from './staleChunks.ts'

describe('stale chunk reload', () => {
  it('reloads at most once per minute', () => {
    expect(shouldReload(null, 1_000)).toBe(true)
    expect(shouldReload(1_000, 30_000)).toBe(false)
    expect(shouldReload(1_000, 62_000)).toBe(true)
  })

  it('recognises failed dynamic imports of Chrome, Safari and Firefox', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/image-x.js'))).toBe(
      true,
    )
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true)
    expect(isChunkLoadError(new Error('network down'))).toBe(false)
  })
})
