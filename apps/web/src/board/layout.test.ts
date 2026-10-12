import { describe, expect, it } from 'vitest'
import { imageSize, newFramePosition, nextSlot } from './layout.ts'

const frame = { x: 0, y: 0, width: 1520, height: 1000 }
const card = { width: 340, height: 300 }

describe('newFramePosition', () => {
  it('starts at (0, 0) on an empty board and left of the content otherwise', () => {
    expect(newFramePosition([])).toEqual({ x: 0, y: 0, width: 1520, height: 1000 })
    expect(
      newFramePosition([
        { x: 100, y: 50, width: 10, height: 10 },
        { x: -20, y: 400, width: 10, height: 10 },
      ]),
    ).toMatchObject({ x: -1740, y: 50 })
  })
})

describe('nextSlot', () => {
  it('fills the first row column by column', () => {
    const children: { x: number; y: number; width: number; height: number }[] = []
    const xs: number[] = []
    for (let i = 0; i < 4; i++) {
      const slot = nextSlot(frame, children, card)
      xs.push(slot.x)
      expect(slot.y).toBe(20)
      children.push({ ...card, x: slot.x, y: slot.y })
    }
    expect(xs).toEqual([20, 400, 780, 1160])
    const fifth = nextSlot(frame, children, card)
    expect(fifth).toMatchObject({ x: 20, frameHeight: 1000 })
    expect(fifth.y).toBeGreaterThanOrEqual(340)
  })

  it('skips taken spots and grows the frame downwards when full', () => {
    const children = [
      { x: 20, y: 20, width: 1480, height: 950 }, // something big fills the frame
    ]
    const slot = nextSlot(frame, children, card)
    expect(slot.y).toBeGreaterThanOrEqual(990)
    expect(slot.frameHeight).toBe(slot.y + 300 + 20)
  })

  it('keeps wide items inside the frame', () => {
    const wide = { width: 400, height: 300 }
    const children = [
      { x: 20, y: 20, width: 400, height: 300 },
      { x: 460, y: 20, width: 400, height: 300 },
      { x: 900, y: 20, width: 400, height: 300 },
    ]
    const slot = nextSlot(frame, children, wide)
    expect(slot.x + 400).toBeLessThanOrEqual(1500)
  })
})

describe('imageSize', () => {
  it('scales the long side to 400 px', () => {
    expect(imageSize(1600, 1200)).toEqual({ width: 400, height: 300 })
    expect(imageSize(900, 1600)).toEqual({ width: 225, height: 400 })
    expect(imageSize(null, null)).toEqual({ width: 400, height: 300 })
  })
})
