import { expect, test } from '@playwright/test'
import { adminPage, joined } from './helpers.ts'

// PLAN.md 9, Phase 7: a word part finds a sticky note; the hit opens the board at the note.
test('search finds a sticky note and jumps to it', async ({ browser }) => {
  const admin = await adminPage(browser)
  await admin.getByRole('button', { name: '+ Neues Board' }).click()
  await admin.getByLabel('Name').fill('Garten')
  await admin.getByRole('button', { name: 'Anlegen' }).click()
  await admin.waitForURL(/\/b\/[0-9A-Z]{26}$/)
  const boardUrl = admin.url()
  await joined(admin)

  await admin.getByRole('button', { name: 'Haftnotiz' }).click()
  await admin.keyboard.press('Enter')
  await admin.keyboard.type('Gartenschlauch kaufen')
  await admin.keyboard.press('Escape')
  const noteId = await admin.evaluate(
    () => (window.__wb?.api.getSceneElements().find((element) => element.type === 'text')?.containerId as string) ?? '',
  )
  expect(noteId).not.toBe('')

  // Indexed once the board is saved (a few seconds after the change).
  await expect
    .poll(
      async () => {
        const result = await (await admin.request.get('/api/search?q=schlauch')).json()
        return (result.boardTexts as { elementId: string }[]).map((hit) => hit.elementId)
      },
      { timeout: 15_000 },
    )
    .toEqual([noteId])

  // From the dashboard: Ctrl+K, a word part, click the hit.
  await admin.goto('/')
  await admin.keyboard.press('Control+k')
  await admin.getByRole('searchbox', { name: 'Suche' }).fill('schlauch')
  await expect(admin.getByText('Auf Boards')).toBeVisible()
  await admin.getByRole('button', { name: /Gartenschlauch kaufen/ }).click()

  await admin.waitForURL(boardUrl)
  await joined(admin)
  await expect
    .poll(() => admin.evaluate(() => Object.keys(window.__wb?.api.getAppState().selectedElementIds ?? {})))
    .toEqual([noteId])
  await admin.context().close()
})
