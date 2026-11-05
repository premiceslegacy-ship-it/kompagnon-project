import { test, expect } from './fixtures'

test('Préférences de thème Atelier : respecter le mouvement réduit lors du changement de thème', async ({ page, qualification }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/login')
  await page.locator('input[name="email"]').fill(qualification.email)
  await page.locator('input[name="password"]').fill(qualification.password)
  await page.getByRole('button', { name: /se connecter/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.evaluate(async () => {
    await Promise.all(document.body.getAnimations().map(animation => animation.finished))
  })
  const beforePalette = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
  }))

  const transitionDurations = await page.evaluateHandle(() => {
    const durations: number[] = []
    document.body.addEventListener('transitionrun', event => {
      if (event.target !== document.body) return
      for (const animation of document.body.getAnimations()) {
        const duration = animation.effect?.getComputedTiming().duration
        if (typeof duration === 'number') durations.push(duration)
      }
    })
    return durations
  })

  await page.getByRole('button', { name: `${qualification.companyName}, ${qualification.companyName}`, exact: true }).click()
  await page.getByRole('button', { name: 'Passer en mode clair', exact: true }).click()
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const afterPalette = await page.evaluate(async () => {
    await Promise.all(document.body.getAnimations().map(animation => animation.finished))
    return {
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
    }
  })

  const durations = await transitionDurations.jsonValue()
  await transitionDurations.dispose()
  // Une bascule instantanée est valide, mais le thème doit réellement changer de couleur.
  expect(afterPalette).not.toEqual(beforePalette)
  expect(Math.max(0, ...durations)).toBeLessThanOrEqual(150)
})
