import { expect, type Page, test } from '@playwright/test'
import { adminPage, ORIGIN } from './helpers.ts'

// PLAN.md 10: share-target simulation – a form POST to /share-target while the service worker is
// active, like Android's share sheet does it.
/** Submits a multipart form to /share-target as a page navigation, like the share sheet does. */
async function shareViaServiceWorker(
  page: Page,
  fields: Record<string, string>,
  files: { name: string; text: string }[],
) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.evaluate(
    ({ fields, files }) => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = '/share-target'
      form.enctype = 'multipart/form-data'
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input')
        input.name = name
        input.value = value
        form.append(input)
      }
      if (files.length > 0) {
        const input = document.createElement('input')
        input.type = 'file'
        input.name = 'files'
        input.multiple = true
        const transfer = new DataTransfer()
        for (const file of files) transfer.items.add(new File([file.text], file.name, { type: 'text/plain' }))
        input.files = transfer.files
        form.append(input)
      }
      document.body.append(form)
      form.submit()
    },
    { fields, files },
  )
  await page.waitForURL(/\/share\?id=[0-9A-Z]{26}$/)
}

test('share sheet: saves at once, board choice, offline queue', async ({ browser }) => {
  const admin = await adminPage(browser)
  await admin.goto('/')
  const board = await admin.request.post('/api/boards', {
    data: { name: 'Teilen Test', hashtag: 'teilentest' },
    headers: ORIGIN,
  })
  const { id: boardId } = (await board.json()) as { id: string }

  // Online: link plus a file, saved right away.
  await shareViaServiceWorker(admin, { title: 'Eine Seite', text: 'https://example.org/geteilt' }, [
    { name: 'notiz.txt', text: 'Hallo vom Handy' },
  ])
  await expect(admin.getByText('✓ In der Inbox gespeichert')).toBeVisible()
  await expect(admin.getByText('notiz.txt')).toBeVisible()

  // Choose the board: all items of the share get it (saved debounced).
  await admin.getByRole('button', { name: /Teilen Test/ }).click()
  await expect
    .poll(async () => {
      const list = await (await admin.request.get('/api/items?status=inbox')).json()
      return (list.items as { targetBoardId: string | null; meta: { filename?: string } }[])
        .filter((item) => item.meta.filename === 'notiz.txt')
        .map((item) => item.targetBoardId)
    })
    .toEqual([boardId])
  await admin.getByRole('button', { name: 'Fertig' }).click()
  await expect(admin).toHaveURL(/\/(\?tab=inbox)?$/)

  // Offline: the share waits on the phone and is uploaded once the connection is back.
  await admin.context().setOffline(true)
  await shareViaServiceWorker(admin, { text: 'Offline geteilt' }, [])
  await expect(admin.getByText(/wird automatisch hochgeladen/)).toBeVisible()
  await admin.context().setOffline(false)
  await expect(admin.getByText('✓ In der Inbox gespeichert')).toBeVisible({ timeout: 15_000 })
  const list = await (await admin.request.get('/api/items?status=inbox')).json()
  expect((list.items as { note: string | null }[]).filter((item) => item.note === 'Offline geteilt')).toHaveLength(1)

  await admin.context().close()
})
