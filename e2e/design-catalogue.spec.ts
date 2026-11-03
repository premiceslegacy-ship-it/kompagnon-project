import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import type { QualificationTenant } from './fixtures'

async function openCatalogue(page: Page, qualification: QualificationTenant) {
  await page.goto('/login')
  await page.locator('input[name="email"]').fill(qualification.email)
  await page.locator('input[name="password"]').fill(qualification.password)
  await page.getByRole('button', { name: /se connecter/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  return page.goto('/design')
}

test('Catalogue interne : actif en développement et absent de la production', async ({ page, qualification }) => {
  const response = await openCatalogue(page, qualification)
  if (process.env.E2E_NEXT_SERVER_MODE === 'start') {
    expect(response?.status()).toBe(404)
    return
  }

  expect(response?.status()).toBe(200)
  const control = page.getByRole('switch', { name: 'Relances automatiques', exact: true })
  await expect(control).toHaveAttribute('aria-checked', 'true')
  await control.click()
  await expect(control).toHaveAttribute('aria-checked', 'false')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('combobox', { name: 'Données', exact: true }).selectOption('long')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const first = page.getByRole('radio', { name: 'Devis Devis', exact: true })
  await first.focus()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await first.press('End')
  const selected = page.getByRole('radio', { name: 'Reçues Reçues', exact: true })
  await expect(selected).toBeChecked()
  await expect.poll(async () => selected.evaluate((element, initialScroll) => {
    let scroller = element.parentElement
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) {
      scroller = scroller.parentElement
    }
    if (!scroller) return false
    const controlBounds = element.getBoundingClientRect()
    const visibleBounds = scroller.getBoundingClientRect()
    return controlBounds.left >= visibleBounds.left + 3.5
      && controlBounds.right <= visibleBounds.right - 3.5
      && window.scrollY === initialScroll
      && document.documentElement.scrollWidth <= window.innerWidth
  }, scrollBefore)).toBe(true)

  await page.getByRole('combobox', { name: 'Segments', exact: true }).selectOption('full')
  await page.getByRole('combobox', { name: 'Données', exact: true }).selectOption('example')
  const group = page.getByRole('radiogroup', { name: 'Documents', exact: true })
  await expect.poll(async () => group.evaluate((element) => {
    const radios = [...element.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    let track = radios[0]?.parentElement
    while (track && !radios.every(radio => track?.contains(radio))) track = track.parentElement
    if (!track) return false
    const widths = radios.map(radio => radio.getBoundingClientRect().width)
    return Math.abs(track.getBoundingClientRect().width - element.getBoundingClientRect().width) < 1
      && Math.max(...widths) - Math.min(...widths) < 1
  })).toBe(true)
  await page.getByRole('combobox', { name: 'Données', exact: true }).selectOption('long')
  await expect.poll(async () => group.evaluate((element) => {
    for (const radio of element.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const label = radio.labels?.[0]
      if (!label) return false
      const slot = radio.getBoundingClientRect()
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const text = range.getBoundingClientRect()
        if (text.left < slot.left - 0.5 || text.right > slot.right + 0.5) return false
      }
    }
    return document.documentElement.scrollWidth <= window.innerWidth
  })).toBe(true)
})

test.describe('Compositions du catalogue de développement', () => {
  test.skip(process.env.E2E_NEXT_SERVER_MODE === 'start', 'Le catalogue est volontairement absent de la production.')

  test.beforeEach(async ({ page, qualification }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const response = await openCatalogue(page, qualification)
    expect(response?.status()).toBe(200)
  })

  test('Le menu au deuxième niveau supprime après fermeture, puis Annuler restaure la ligne', async ({ page }) => {
    const row = page.locator('#lists').getByRole('button', { name: /Dupont Rénovation/ })
    await page.getByRole('button', { name: 'Ouvrir la feuille', exact: true }).click()
    await page.getByRole('button', { name: 'Ouvrir le deuxième niveau', exact: true }).click()
    await page.getByRole('button', { name: 'Plus au deuxième niveau', exact: true }).click()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2)
    await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0)
    await expect(row).toHaveCount(0)
    const hud = page.getByRole('status').filter({ hasText: 'Ligne supprimée' })
    const undo = page.getByRole('button', { name: 'Annuler', exact: true })
      .and(page.locator(`[aria-describedby="${await hud.getAttribute('id')}"]`))
    await undo.click()
    await expect(row).toBeVisible()
    await expect(hud).toHaveCount(0)
  })

  test('Une nouvelle feuille suspend le HUD sans consommer le temps pour Annuler', async ({ page }) => {
    await page.getByRole('button', { name: 'Supprimer la ligne', exact: true }).click()
    const hud = page.getByRole('status', { includeHidden: true }).filter({ hasText: 'Ligne supprimée' })
    await expect(hud).toBeVisible()
    const undo = page.getByRole('button', { name: 'Annuler', exact: true })
      .and(page.locator(`[aria-describedby="${await hud.getAttribute('id')}"]`))
    await page.getByRole('button', { name: 'Ouvrir la feuille', exact: true }).click()
    await expect(hud).toBeHidden()
    await page.waitForTimeout(4_200) // The real expiry interval is the behavior under test.
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click()
    await expect(hud).toBeVisible()
    await undo.focus()
    await undo.press('Enter')
    await expect(page.locator('#lists').getByRole('button', { name: /Dupont Rénovation/ })).toBeVisible()
  })

  test('Une fermeture gestuelle refusée laisse la feuille entière et les niveaux utilisables', async ({ page }) => {
    await page.getByRole('button', { name: 'Ouvrir la feuille', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('switch', { name: 'Garder la feuille ouverte', exact: true }).click()
    const title = sheet.getByRole('heading', { name: 'Client', exact: true })
    await expect(title).toBeVisible()
    const bounds = await title.boundingBox()
    if (!bounds) throw new Error('Le titre de la feuille locale est absent.')
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 180, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => {
      const panel = await sheet.boundingBox()
      return panel ? panel.y + panel.height : Infinity
    }).toBeLessThanOrEqual(845)
    await sheet.getByRole('button', { name: 'Ouvrir le deuxième niveau', exact: true }).click()
    await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await sheet.getByRole('switch', { name: 'Garder la feuille ouverte', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ouvrir la feuille', exact: true })).toBeFocused()
  })
})
