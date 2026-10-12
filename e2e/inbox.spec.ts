import { expect, test } from '@playwright/test'
import { adminPage, invitedPage, joined, ORIGIN, sceneOf } from './helpers.ts'

// PLAN.md 9, Phase 2: drag & drop places at the mouse position; items with a target board are
// placed exactly once, also with two open browsers.
test('inbox: drag & drop and automatic placement with two browsers', async ({ browser }) => {
  const admin = await adminPage(browser)
  const anna = await invitedPage(browser, admin, 'Inbox-Anna')

  const board = await admin.request.post('/api/boards', {
    data: { name: 'Inbox Test', hashtag: 'inboxtest' },
    headers: ORIGIN,
  })
  expect(board.ok()).toBe(true)
  const { id: boardId } = (await board.json()) as { id: string }
  await admin.goto(`/b/${boardId}`)
  await anna.goto(`/b/${boardId}`)
  for (const page of [admin, anna]) await joined(page)

  // A note arrives in the shared inbox of both.
  const added = await admin.request.post('/api/items', { data: { text: 'Drag-Test Notiz' }, headers: ORIGIN })
  const noteId = ((await added.json()) as { items: { id: string }[] }).items[0]?.id ?? ''
  const row = admin.locator(`[data-item-id="${noteId}"]`)
  await expect(row).toBeVisible()
  await expect(anna.locator(`[data-item-id="${noteId}"]`)).toBeVisible()

  // Drag it onto the canvas: the sticky note lands centred under the mouse.
  await admin.bringToFront()
  const canvas = admin.locator('canvas.excalidraw__canvas.interactive')
  await row.dragTo(canvas, { targetPosition: { x: 400, y: 400 } })
  await expect.poll(async () => (await sceneOf(admin)).filter((element) => element.itemId === noteId).length).toBe(2)
  const position = await admin.evaluate((id) => {
    const api = window.__wb?.api
    const element = api
      ?.getSceneElements()
      .find(
        (entry) => entry.type === 'rectangle' && (entry.customData as { wb?: { itemId?: string } })?.wb?.itemId === id,
      )
    const state = api?.getAppState() as unknown as {
      scrollX: number
      scrollY: number
      zoom: { value: number }
      offsetLeft: number
      offsetTop: number
    }
    if (!element || !state) return null
    const centerX =
      ((element.x as number) + (element.width as number) / 2 + state.scrollX) * state.zoom.value + state.offsetLeft
    const centerY =
      ((element.y as number) + (element.height as number) / 2 + state.scrollY) * state.zoom.value + state.offsetTop
    return { centerX, centerY }
  }, noteId)
  const box = await canvas.boundingBox()
  expect(position?.centerX).toBeCloseTo((box?.x ?? 0) + 400, -1)
  expect(position?.centerY).toBeCloseTo((box?.y ?? 0) + 400, -1)
  await expect(row).toBeHidden()
  await expect.poll(async () => (await sceneOf(anna)).filter((element) => element.itemId === noteId).length).toBe(2)
  await expect(admin.getByText('Platziert')).toBeVisible()

  // An item for #inboxtest is placed automatically in the "📥 Inbox" frame – exactly once.
  const auto = await anna.request.post('/api/items', { data: { text: 'Automatisch #inboxtest' }, headers: ORIGIN })
  const autoId = ((await auto.json()) as { items: { id: string }[] }).items[0]?.id ?? ''
  await expect.poll(async () => (await sceneOf(admin)).filter((element) => element.itemId === autoId).length).toBe(2)
  await admin.waitForTimeout(1500)
  for (const page of [admin, anna]) {
    const scene = await sceneOf(page)
    expect(scene.filter((element) => element.itemId === autoId)).toHaveLength(2)
    expect(scene.filter((element) => element.type === 'frame')).toHaveLength(1)
    expect(scene.filter((element) => element.itemId === autoId).every((element) => element.frameId)).toBe(true)
  }
  const item = await admin.request.get(`/api/items/${autoId}`)
  expect(((await item.json()) as { status: string }).status).toBe('placed')

  await admin.context().close()
  await anna.context().close()
})
