import { type Browser, expect, type Page } from '@playwright/test'

export const PASSWORD = 'e2e-korrekt-pferd-batterie'
export const ORIGIN = { origin: 'http://localhost:3100' }
export const ADMIN_EMAIL = 'maik@example.test'

export async function fillAccount(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD)
}

/** Signs in the admin; creates the account via the setup link on the first call. */
export async function adminPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  const status = await (await page.request.get('/api/auth/status')).json()
  if (status.setupRequired) {
    await page.goto(process.env.WB_E2E_SETUP_URL ?? '')
    await fillAccount(page, 'Maik', ADMIN_EMAIL)
    await page.getByRole('button', { name: 'Admin-Konto anlegen' }).click()
  } else {
    await page.goto('/login')
    await page.getByLabel('E-Mail').fill(ADMIN_EMAIL)
    await page.getByLabel('Passwort').fill(PASSWORD)
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible()
  return page
}

/** Invites and signs in another user in a separate browser context. */
export async function invitedPage(browser: Browser, admin: Page, name: string): Promise<Page> {
  const invite = await admin.request.post('/api/admin/invites', { data: { role: 'member' }, headers: ORIGIN })
  expect(invite.ok()).toBe(true)
  const { url } = (await invite.json()) as { url: string }
  const page = await (await browser.newContext()).newPage()
  await page.goto(url)
  await fillAccount(page, name, `${name.toLowerCase()}-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible()
  return page
}

export const joined = (page: Page) => page.waitForFunction(() => window.__wb?.sync.isJoined)

export type SceneElement = { id: string; type: string; text?: string; itemId?: string; frameId?: string | null }

export const sceneOf = (page: Page) =>
  page.evaluate(
    () =>
      window.__wb?.api.getSceneElements().map((element) => ({
        id: element.id as string,
        type: element.type,
        text: typeof element.text === 'string' ? element.text : undefined,
        itemId: (element.customData as { wb?: { itemId?: string } } | undefined)?.wb?.itemId,
        frameId: (element.frameId as string | null | undefined) ?? null,
      })) ?? [],
  ) as Promise<SceneElement[]>
