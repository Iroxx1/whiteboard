import { type BrowserContext, expect, type Page, test } from '@playwright/test'

// PLAN.md 9, Phase 1: two users edit the same board at the same time.
const PASSWORD = 'e2e-korrekt-pferd-batterie'
const ORIGIN = { origin: 'http://localhost:3100' }

async function fillAccount(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD)
}

type Scene = { type: string; text?: string; isDeleted?: boolean }[]

const sceneOf = (page: Page) =>
  page.evaluate(
    () =>
      window.__wb?.api
        .getSceneElements()
        .map((element) => ({ type: element.type, text: 'text' in element ? element.text : undefined })) ?? [],
  ) as Promise<Scene>

test('two users edit one board in real time', async ({ browser }) => {
  const contexts: BrowserContext[] = []
  const newPage = async () => {
    const context = await browser.newContext()
    contexts.push(context)
    return context.newPage()
  }

  // Admin account via the one-time setup link.
  const admin = await newPage()
  await admin.goto(process.env.WB_E2E_SETUP_URL ?? '')
  await fillAccount(admin, 'Maik', 'maik@example.test')
  await admin.getByRole('button', { name: 'Admin-Konto anlegen' }).click()
  await expect(admin.getByRole('heading', { name: 'Boards' })).toBeVisible()

  // Invite a second user.
  const invite = await admin.request.post('/api/admin/invites', { data: { role: 'member' }, headers: ORIGIN })
  expect(invite.ok()).toBe(true)
  const { url } = (await invite.json()) as { url: string }
  const anna = await newPage()
  await anna.goto(url)
  await expect(anna.getByText('Alle Nutzer sehen und bearbeiten alle Boards')).toBeVisible()
  await fillAccount(anna, 'Anna', 'anna@example.test')
  await anna.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(anna.getByRole('heading', { name: 'Boards' })).toBeVisible()

  // Admin creates a board; Anna opens it.
  await admin.getByRole('button', { name: '+ Neues Board' }).click()
  await admin.getByLabel('Name').fill('Urlaub')
  await admin.getByRole('button', { name: 'Anlegen' }).click()
  await admin.waitForURL(/\/b\/[0-9A-Z]{26}$/)
  await anna.goto(admin.url())
  for (const page of [admin, anna]) await page.waitForFunction(() => window.__wb?.sync.isJoined)

  // Sticky note with text from the admin appears at Anna's within a second.
  await admin.bringToFront()
  await admin.getByRole('button', { name: 'Haftnotiz' }).click()
  await admin.keyboard.press('Enter')
  await admin.keyboard.type('Hotel buchen')
  await admin.keyboard.press('Escape')
  const typedAt = Date.now()
  await expect
    .poll(async () => (await sceneOf(anna)).some((e) => e.text === 'Hotel buchen'), { timeout: 3000 })
    .toBe(true)
  expect(Date.now() - typedAt).toBeLessThan(1000)

  // Anna draws a rectangle; the admin sees it and Anna's cursor.
  await anna.bringToFront()
  await anna.keyboard.press('r')
  // Right of the sticky note and away from Excalidraw's property panel on the left.
  await anna.mouse.move(850, 520)
  await anna.mouse.down()
  await anna.mouse.move(1000, 620, { steps: 5 })
  await anna.mouse.up()
  await expect.poll(async () => (await sceneOf(admin)).filter((e) => e.type === 'rectangle').length).toBe(2)
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
  await admin.waitForFunction(() => window.__wb?.sync.isJoined)
  expect(await sceneOf(admin)).toEqual([])

  for (const context of contexts) await context.close()
})
