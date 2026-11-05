import { test, expect } from './fixtures'

test('la configuration de facturation électronique reste accessible au propriétaire autorisé', async ({ page, qualification }) => {
  await page.goto('/login')
  await page.locator('input[name="email"]').fill(qualification.email)
  await page.locator('input[name="password"]').fill(qualification.password)
  await page.getByRole('button', { name: /se connecter/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.goto('/settings?tab=facturation')

  await expect(page.getByRole('heading', { name: 'Facturation électronique', exact: true })).toBeVisible()
})
