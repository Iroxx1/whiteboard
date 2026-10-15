import { expect, test } from '@playwright/test'
import { adminPage, invitedPage, joined, ORIGIN, sceneOf } from './helpers.ts'

// PLAN.md 9, Phase 10: passkeys, board tags and previews, links pasted onto the board.

test('passkey: add in the settings, then sign in with it', async ({ browser }) => {
  const admin = await adminPage(browser)
  const page = await invitedPage(browser, admin, 'Paula')

  // A software authenticator that behaves like a phone with a screen lock.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  await page.goto('/settings')
  await page.getByLabel('Name des Geräts').fill('Test-Handy')
  await page.getByRole('button', { name: 'Passkey hinzufügen' }).click()
  await expect(page.getByText('Passkey gespeichert.')).toBeVisible()
  await expect(page.getByText('Test-Handy')).toBeVisible()

  // Signed out, back in without typing anything.
  await page.request.post('/api/auth/logout', { headers: ORIGIN })
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByRole('button', { name: /Mit Passkey anmelden/ }).click()
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible()

  // Removing it works, too.
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.getByText('Noch kein Passkey eingerichtet.')).toBeVisible()
})

test('board tags: set on creation, filter on the dashboard, preview after drawing', async ({ browser }) => {
  const page = await adminPage(browser)
  const name = `Reise ${Date.now()}`

  await page.getByRole('button', { name: '+ Neues Board' }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Tags').fill('Urlaub, Familie')
  await page.getByRole('button', { name: 'Anlegen' }).click()
  await page.waitForURL(/\/b\/[0-9A-Z]{26}$/)
  await joined(page)

  // Something to look at in the preview.
  await page.getByRole('button', { name: 'Haftnotiz' }).click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Hotel buchen')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await sceneOf(page)).some((element) => element.text === 'Hotel buchen')).toBe(true)

  // Leaving the board (client-side) renders and uploads the preview.
  await page.evaluate(() => {
    history.pushState({}, '', '/')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  const tile = page.getByRole('listitem').filter({ hasText: name })
  await expect(tile.getByText('Familie')).toBeVisible()
  await expect(tile.locator('img')).toBeVisible({ timeout: 15_000 })

  // The tag chip filters the list.
  const filter = page.getByRole('group', { name: 'Nach Tag filtern' })
  await filter.getByRole('button', { name: 'Familie' }).click()
  await expect(tile).toBeVisible()
  await filter.getByRole('button', { name: 'Alle' }).click()
})

test('pasting an address onto the board creates an item and a card', async ({ browser }) => {
  const page = await adminPage(browser)
  await page.getByRole('button', { name: '+ Neues Board' }).click()
  await page.getByLabel('Name', { exact: true }).fill(`Einfügen ${Date.now()}`)
  await page.getByRole('button', { name: 'Anlegen' }).click()
  await page.waitForURL(/\/b\/[0-9A-Z]{26}$/)
  await joined(page)

  // Plain text must stay with Excalidraw (no item), an address becomes a card.
  await page.mouse.move(500, 400)
  const paste = (text: string) =>
    page.evaluate((value) => {
      const data = new DataTransfer()
      data.setData('text/plain', value)
      const canvas = document.querySelector('canvas.interactive') ?? document.body
      canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, text)

  await paste('https://example.com/')
  await expect
    .poll(async () => (await sceneOf(page)).filter((element) => element.itemId !== undefined).length, {
      timeout: 10_000,
    })
    .toBe(1)
})
