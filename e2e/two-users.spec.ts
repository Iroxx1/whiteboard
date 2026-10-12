import { expect, test } from '@playwright/test'
import { adminPage, invitedPage, joined, sceneOf } from './helpers.ts'

// PLAN.md 9, Phase 1: two users edit the same board at the same time.
test('two users edit one board in real time', async ({ browser }) => {
  const admin = await adminPage(browser)
  const anna = await invitedPage(browser, admin, 'Anna')

  // Admin creates a board; Anna opens it.
  await admin.getByRole('button', { name: '+ Neues Board' }).click()
  await admin.getByLabel('Name').fill('Urlaub')
  await admin.getByRole('button', { name: 'Anlegen' }).click()
  await admin.waitForURL(/\/b\/[0-9A-Z]{26}$/)
  await anna.goto(admin.url())
  for (const page of [admin, anna]) await joined(page)

  // Sticky note with text from the admin appears at Anna's within a second.
  await admin.bringToFront()
  await admin.getByRole('button', { name: 'Haftnotiz' }).click()
  await admin.keyboard.press('Enter')
  await admin.keyboard.type('Hotel buchen')
  await admin.keyboard.press('Escape')
  const typedAt = Date.now()
  await expect
    .poll(async () => (await sceneOf(anna)).some((element) => element.text === 'Hotel buchen'), { timeout: 3000 })
    .toBe(true)
  expect(Date.now() - typedAt).toBeLessThan(1000)

  // Anna draws a rectangle; the admin sees it and Anna's cursor.
  await anna.bringToFront()
  await anna.keyboard.press('r')
  // Left of the docked inbox sidebar and away from Excalidraw's property panel.
  await anna.mouse.move(350, 520)
  await anna.mouse.down()
  await anna.mouse.move(500, 620, { steps: 5 })
  await anna.mouse.up()
  await expect.poll(async () => (await sceneOf(admin)).filter((element) => element.type === 'rectangle').length).toBe(2)
  await expect
    .poll(() =>
      admin.evaluate(() =>
        [...(window.__wb?.api.getAppState().collaborators.values() ?? [])].map((user) => user.username),
      ),
    )
    .toContain('Anna')

  // Anna deletes everything; it stays deleted for the admin, also after reloading.
  await anna.keyboard.press('Escape')
  await anna.keyboard.press('Control+a')
  await anna.keyboard.press('Delete')
  await expect.poll(async () => (await sceneOf(admin)).length).toBe(0)
  await admin.reload()
  await joined(admin)
  expect(await sceneOf(admin)).toEqual([])

  await admin.context().close()
  await anna.context().close()
})
