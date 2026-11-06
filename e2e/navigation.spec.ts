import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { provisionNavigationActor } from './navigation-fixtures'

async function signIn(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login')
  await page.locator('input[name="email"]').fill(credentials.email)
  await page.locator('input[name="password"]').fill(credentials.password)
  await page.getByRole('button', { name: /se connecter/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

async function requestCreation(page: Page, kind: 'Client' | 'Chantier', pathname: '/clients' | '/chantiers') {
  const trigger = page.getByRole('button', { name: 'Créer', exact: true })
  await trigger.focus()
  await trigger.press('Enter')
  const menu = page.getByRole('dialog', { name: 'Créer', exact: true })
  const intention = page.waitForURL(url => url.pathname === pathname && url.searchParams.get('new') === '1')
  await menu.getByRole('button', { name: new RegExp(`^${kind}(?:\\s|$)`) }).click()
  await intention
  await page.waitForURL(url => url.pathname === pathname && !url.searchParams.has('new'))
}

test('Créer un client deux fois depuis la même page conserve le brouillon ouvert', async ({ page, qualification }) => {
  await signIn(page, qualification)
  await page.goto('/clients')
  await requestCreation(page, 'Client', '/clients')
  const company = page.locator('input[name="company_name"]')
  await company.fill('Brouillon client conservé')
  // La feuille de création est modale : une seconde demande arrive par la navigation interne (lien, retour).
  await page.evaluate(() => window.history.pushState(null, '', '/clients?new=1'))
  await page.waitForURL(url => url.pathname === '/clients' && !url.searchParams.has('new'))
  await expect(company).toHaveValue('Brouillon client conservé')
})

test('Créer un chantier deux fois conserve le formulaire choisi et sa saisie', async ({ page, qualification }) => {
  await signIn(page, qualification)
  await page.goto('/chantiers')
  await requestCreation(page, 'Chantier', '/chantiers')
  await page.getByRole('button', { name: /^Chantier \/ travaux/ }).click()
  const title = page.getByPlaceholder('Réfection toiture bâtiment A')
  await title.fill('Brouillon chantier conservé')
  // La feuille est modale : la seconde demande arrive par la navigation interne.
  await page.evaluate(() => window.history.pushState(null, '', '/chantiers?new=1'))
  await page.waitForURL(url => url.pathname === '/chantiers' && !url.searchParams.has('new'))
  await expect(title).toHaveValue('Brouillon chantier conservé')
  await expect(page.getByRole('heading', { name: 'Créer un suivi', exact: true })).toHaveCount(0)
})

test('Le lien de création client consomme son intention sans effacer les autres paramètres ni le fragment', async ({ page, qualification }) => {
  await signIn(page, qualification)
  await page.goto('/clients?new=1&navigation=conserve#position')
  await page.waitForURL(url => url.pathname === '/clients' && !url.searchParams.has('new'))
  await expect(page).toHaveURL(`${qualification.baseUrl}/clients?navigation=conserve#position`)
  await expect(page.locator('input[name="company_name"]')).toBeVisible()
})

test('Le menu personnel mobile reste accessible sans droit Réglages et révoque réellement la session', async ({ page, qualification }) => {
  const actor = await provisionNavigationActor(qualification, 'employee')
  try {
    const membership = await qualification.admin.from('memberships').select('role_id')
      .eq('organization_id', qualification.orgId).eq('user_id', actor.userId).eq('is_active', true).single()
    if (membership.error || !membership.data) throw new Error('Generated navigation membership unavailable.')
    const revoked = await qualification.admin.from('role_permissions').update({ is_allowed: false })
      .eq('role_id', membership.data.role_id).eq('permission_key', 'settings.view')
    if (revoked.error) throw new Error('Could not revoke the generated business settings permission.')
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, actor)
    await page.getByRole('navigation', { name: 'Navigation principale mobile', exact: true })
      .locator('a[href="/entreprise"]').click()
    await page.waitForURL('**/entreprise')
    await expect(page.getByRole('main').locator('a[href="/settings"]')).toHaveCount(0)
    await page.getByRole('button', { name: `Intervenant de qualification, ${qualification.companyName}`, exact: true }).click()
    const profile = page.getByRole('dialog', { name: 'Profil', exact: true })
    await expect(profile.getByRole('button', { name: /Passer en mode (clair|sombre)/ })).toBeVisible()
    await profile.getByRole('button', { name: 'Se déconnecter', exact: true }).click()
    await page.waitForURL('**/login')
    await page.goto('/entreprise')
    await page.waitForURL('**/login')
  } finally {
    await actor.dispose()
  }
})

test('Une notification vers la page courante ne laisse pas la navigation occupée', async ({ page, qualification }) => {
  const request = await qualification.admin.from('quote_requests').insert({
    organization_id: qualification.orgId,
    name: 'Demande de qualification navigation',
    email: 'qualification-navigation-alert@atelier.test',
    description: 'Demande locale pour vérifier le retour à la page courante.',
    status: 'new',
    type: 'custom',
  })
  if (request.error) throw new Error('Could not create the generated navigation request.')
  await signIn(page, qualification)
  await page.goto('/requests')
  const trigger = page.getByRole('button', { name: /^Notifications(?:,|$)/ })
  await trigger.click()
  const notifications = page.getByRole('dialog', { name: 'Notifications', exact: true })
  await notifications.getByRole('button', { name: /^1 demande de devis à traiter/ }).click()
  await expect(notifications).toHaveCount(0)
  await expect(page).toHaveURL(`${qualification.baseUrl}/requests`)
  await expect(trigger).not.toHaveAttribute('aria-busy', 'true')
})

test('La barre latérale ne fait pas déborder le résumé et la liste Documents à 900 px', async ({ page, qualification }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await signIn(page, qualification)
  await page.goto('/finances')
  const segment = page.getByRole('main').getByRole('radio', { name: 'Devis', exact: true })
  await expect(segment).toBeChecked()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) throw new Error('Documents screen unavailable.')
    const bounds = main.getBoundingClientRect()
    const overflowing = [...main.querySelectorAll('*')].filter(element => {
      // Les annonces vocales (Hud) sont des régions invisibles collées au bord de la fenêtre.
      if (window.getComputedStyle(element).clipPath !== 'none' || element.closest('[aria-live], [role="status"], [role="alert"]')) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && (rect.right > bounds.right + 1 || rect.left < bounds.left - 1)
    }).length
    return { documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1, overflowing }
  })).toEqual({ documentFits: true, overflowing: 0 })
})

test('Les années des dates de facture restent lisibles avec la barre latérale à 1024 px', async ({ page, qualification }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await signIn(page, qualification)
  await page.goto('/finances/invoice-editor')
  await expect(page.locator('input[type="date"]')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const attribute = (node: typeof root, name: string) => {
      const attributes = node.attributes
      if (!attributes) return undefined
      for (let i = 0; i < attributes.length; i += 2) if (attributes[i] === name) return attributes[i + 1]
      return undefined
    }
    const dates: (typeof root)[] = []
    const visit = (node: typeof root, collect: (node: typeof root) => void) => {
      collect(node)
      for (const child of node.children ?? []) visit(child, collect)
      for (const shadow of node.shadowRoots ?? []) visit(shadow, collect)
    }
    visit(root, node => { if (node.nodeName === 'INPUT' && attribute(node, 'type') === 'date') dates.push(node) })
    const fullyVisible: boolean[] = []
    for (const date of dates) {
      const parts = new Map<string, typeof root>()
      visit(date, node => {
        const pseudo = attribute(node, 'pseudo')
        if (pseudo) parts.set(pseudo, node)
      })
      const bounds = async (pseudo: string) => {
        const part = parts.get(pseudo)
        if (!part) throw new Error('Native invoice date part unavailable.')
        const { model } = await cdp.send('DOM.getBoxModel', { nodeId: part.nodeId })
        return { left: Math.min(model.content[0], model.content[2], model.content[4], model.content[6]), right: Math.max(model.content[0], model.content[2], model.content[4], model.content[6]) }
      }
      const [editor, year, picker] = await Promise.all([
        bounds('-webkit-datetime-edit'),
        bounds('-webkit-datetime-edit-year-field'),
        bounds('-webkit-calendar-picker-indicator'),
      ])
      fullyVisible.push(year.right <= editor.right + 0.5 && year.right <= picker.left + 0.5)
    }
    expect(fullyVisible).toEqual([true, true])
  } finally {
    await cdp.detach()
  }
})

test('Le rappel de configuration conserve ses liens entièrement visibles à 900 px', async ({ page, qualification }) => {
  const prepared = await qualification.admin.from('organizations')
    .update({ setup_checklist_dismissed: false, signature_image: null }).eq('id', qualification.orgId)
  if (prepared.error) throw new Error('Could not prepare the generated incomplete setup reminder.')
  await page.setViewportSize({ width: 900, height: 900 })
  await signIn(page, qualification)
  await page.goto('/dashboard')
  const link = page.getByRole('main').getByRole('link', { name: 'E-facturation au choix', exact: true })
  await expect(link).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => link.evaluate(element => {
    const card = element.closest('section')
    if (!card) throw new Error('Setup reminder card unavailable.')
    const box = card.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1)
  })).toBe(true)
})

test('Le retour du devis reste atteignable sans interception à 1024 px', async ({ page, qualification }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await signIn(page, qualification)
  await page.goto('/finances/quote-editor?returnTo=%2Ffinances')
  await expect(page.getByRole('main').getByRole('button', { name: 'Documents', exact: true })).toBeVisible()
  await expect(page.getByText('Préparation du devis…', { exact: true })).toHaveCount(0)
  const manualChoice = page.getByRole('button', { name: /Je fais le devis moi-même/ })
  if (await manualChoice.isVisible()) await manualChoice.click()
  await expect(manualChoice).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  const title = page.getByRole('main').getByRole('heading', { level: 1 })
  const back = page.getByRole('main').getByRole('button', { name: 'Documents', exact: true })
  await expect.poll(() => back.evaluate(element => {
    const box = element.getBoundingClientRect()
    return [0.2, 0.5, 0.8].every(y => [0.2, 0.5, 0.8].every(x => {
      const hit = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)
      return hit === element || (hit !== null && element.contains(hit))
    }))
  })).toBe(true)
  await expect(title).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(`${qualification.baseUrl}/finances`)
})

test('Le texte du rappel ne chevauche pas ses actions à 1024 px', async ({ page, qualification }) => {
  const prepared = await qualification.admin.from('organizations')
    .update({ setup_checklist_dismissed: false, signature_image: null }).eq('id', qualification.orgId)
  if (prepared.error) throw new Error('Could not prepare the generated incomplete setup reminder.')
  await page.setViewportSize({ width: 1024, height: 900 })
  await signIn(page, qualification)
  await page.goto('/dashboard')
  const link = page.getByRole('main').getByRole('link', { name: 'E-facturation au choix', exact: true })
  await expect(link).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(() => link.evaluate(element => {
    const text = element.closest('section')?.querySelector('h2')?.parentElement
    const actions = element.parentElement?.parentElement
    if (!text || !actions) throw new Error('Setup text or action region unavailable.')
    const bounds = actions.getBoundingClientRect()
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
    let overlaps = false
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      for (const rect of range.getClientRects()) {
        const width = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)
        const height = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)
        if (width > 1 && height > 1) overlaps = true
      }
    }
    return { textHasWidth: text.getBoundingClientRect().width > 0, overlaps }
  })).toEqual({ textHasWidth: true, overlaps: false })
})
