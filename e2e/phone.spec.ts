import { expect, test } from '@playwright/test'
import { adminPage, joined } from './helpers.ts'

// Phone layout: one-row header with a menu, board tools inside the screen, no overlap with the menu.
test('phone: header menu, board toolbar and buttons stay on screen', async ({ browser }) => {
  const admin = await adminPage(browser)
  const board = await admin.request.post('/api/boards', {
    data: { name: 'Handy' },
    headers: { origin: 'http://localhost:3100' },
  })
  const { id } = (await board.json()) as { id: string }

  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    storageState: await admin.context().storageState(),
  })
  const page = await context.newPage()
  await page.goto('/')
  const header = page.locator('header')
  await expect(page.getByRole('button', { name: 'Menü' })).toBeVisible()
  expect((await header.boundingBox())?.height).toBeLessThan(80)
  await expect(header.getByRole('link', { name: 'Einstellungen' })).toBeHidden()
  await page.getByRole('button', { name: 'Menü' }).click()
  await expect(page.getByRole('menuitem', { name: 'Einstellungen' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Abmelden' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto(`/b/${id}`)
  await joined(page)
  // Every tool and both phone buttons lie inside the screen.
  const inside = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox()
    expect(box, selector).not.toBeNull()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
  }
  await inside('.App-toolbar--mobile')
  await inside('button[aria-label="Inbox"]')
  await inside('[aria-label="Suche"]')

  // The sticky-note bar must not cover Excalidraw's menu: it hides while the menu is open.
  const sticky = page.locator('.wb-sticky-tool')
  await expect(sticky).toBeVisible()
  await page.locator('.main-menu-trigger').click()
  await expect(page.locator('.dropdown-menu')).toBeVisible()
  await expect(sticky).toBeHidden()

  // With the inbox panel open, the floating buttons and the sticky-note bar get out of the way.
  await page.reload()
  await joined(page)
  await expect(page.locator('button[aria-label="Inbox"]')).toBeVisible()
  await page.locator('button[aria-label="Inbox"]').click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('button[aria-label="Inbox"]')).toBeHidden()
  await expect(page.locator('[aria-label="Suche"]')).toBeHidden()
  await expect(sticky).toBeHidden()
})
