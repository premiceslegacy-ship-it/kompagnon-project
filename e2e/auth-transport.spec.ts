import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test.use({ javaScriptEnabled: false })

for (const mode of ['login', 'signup'] as const) {
  test(`${mode} : le transport natif ne place pas les identifiants dans l’URL`, async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('An explicit local qualification origin is required.')
    const origin = new URL(baseURL).origin
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      return route.abort('blockedbyclient')
    })
    await page.goto(mode === 'signup' ? '/login?mode=signup' : '/login')
    if (mode === 'signup') await page.locator('input[name="full_name"]').fill('Qualification transport natif')
    await page.locator('input[name="email"]').fill('qualification-transport@atelier.test')
    await page.locator('input[name="password"]').fill(`Qualification-${randomUUID()}-A9!`)

    // Capture the browser's real native form request, without invoking account actions.
    await page.route((url) => url.origin === origin && url.pathname === '/login', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p>Transport capturé pour la qualification locale.</p>',
    }))
    const submitted = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/login')
    await page.getByRole('button', { name: mode === 'signup' ? 'Créer mon compte' : /se connecter/i }).click()
    const request = await submitted
    const url = new URL(request.url())
    expect(request.method()).toBe('POST')
    expect(url.searchParams.has('password')).toBe(false)
    expect(url.searchParams.has('email')).toBe(false)
  })
}
