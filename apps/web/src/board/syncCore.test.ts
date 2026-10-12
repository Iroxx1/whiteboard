import { describe, expect, it } from 'vitest'
import { changedIds, mergeAfterJoin } from './syncCore.ts'

const el = (
  id: string,
  version: number,
  extra: { versionNonce?: number; index?: string; isDeleted?: boolean } = {},
) => ({
  id,
  version,
  versionNonce: extra.versionNonce ?? 1,
  index: extra.index ?? `a${id}`,
  isDeleted: extra.isDeleted ?? false,
})

describe('changedIds', () => {
  it('reports elements whose version the server does not have', () => {
    const known = new Map([
      ['1', 3],
      ['2', 1],
    ])
    expect(changedIds([el('1', 3), el('2', 2), el('3', 1)], known)).toEqual(['2', '3'])
  })
})

describe('mergeAfterJoin', () => {
  it('takes the server state and drops unconfirmed-free local leftovers', () => {
    const local = [el('1', 5), el('old-tombstone', 9, { isDeleted: true })]
    const server = [el('1', 6), el('2', 1)]
    const { scene, resend } = mergeAfterJoin(local, server, new Set())
    expect(scene.map((element) => `${element.id}@${element.version}`)).toEqual(['1@6', '2@1'])
    expect(resend).toEqual([])
  })

  it('keeps pending local changes that win and resends them', () => {
    const local = [el('1', 7), el('3', 1), el('2', 1)]
    const server = [el('1', 6), el('2', 4, { isDeleted: true })]
    const { scene, resend } = mergeAfterJoin(local, server, new Set(['1', '2', '3']))
    expect(resend.map((element) => element.id)).toEqual(['1', '3'])
    expect(scene.map((element) => `${element.id}@${element.version}`)).toEqual(['1@7', '2@4', '3@1'])
    // The element deleted on the server stays deleted although it was pending locally.
    expect(scene.find((element) => element.id === '2')?.isDeleted).toBe(true)
  })

  it('sorts the result by fractional index', () => {
    const { scene } = mergeAfterJoin([el('x', 1, { index: 'a0' })], [el('y', 1, { index: 'a1' })], new Set(['x']))
    expect(scene.map((element) => element.id)).toEqual(['x', 'y'])
  })
})
