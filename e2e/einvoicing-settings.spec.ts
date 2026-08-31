import { test, expect } from '@playwright/test'

// Parcours artisan côté Atelier pour l'activation Super PDP — voir
// docs/atelier-facturation-electronique.md §7.3 et playwright.config.ts pour
// ce qui est/n'est pas couvert par ce test.

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? 'demo@weber-tolerie-demo.fr'
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'Weber4kompagnon44!'

test.describe('Facturation électronique — /settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[name="email"]').fill(TEST_EMAIL)
    await page.locator('input[name="password"]').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /se connecter/i }).click()
    // Timeout généreux : un serveur Next dev à froid + Supabase (tier gratuit,
    // cold start) peuvent chacun ajouter 10-20s sur la première requête d'un run.
    // Constaté une fois en session de debug : ~20 connexions rapprochées contre
    // le même compte de test ont fait grimper un POST /login à 6.7min côté
    // Supabase Auth (rate limiting/throttling silencieux, pas de 429 explicite) —
    // si ce test traîne anormalement, espacer les runs plutôt qu'augmenter encore
    // ce timeout.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  })

  test('affiche l\'onglet dès que l\'utilisateur a la permission de configurer la facturation électronique', async ({ page }) => {
    await page.goto('/settings?tab=facturation')

    // Self-service : l'onglet ne dépend plus de mode !== 'off', seulement de la
    // permission einvoicing.configure — visible même pour un compte jamais connecté.
    await expect(page.getByRole('heading', { name: 'Facturation électronique' })).toBeVisible()
    await expect(page.getByText(/Statut\s*:/)).toBeVisible()
  })

  test('le bouton Activer redirige vers une URL Super PDP avec un state signé', async ({ page }) => {
    await page.goto('/settings?tab=facturation')

    const activateButton = page.getByRole('button', { name: /Activer la facturation électronique/i })

    // Si le compte de test est déjà connecté à Super PDP (oauth_status = connected),
    // le bouton n'est pas rendu — ce test n'est pertinent qu'à l'état not_connected.
    if (!(await activateButton.isVisible().catch(() => false))) {
      test.skip(true, 'Compte déjà connecté à Super PDP (oauth_status=connected) — bouton non rendu')
      return
    }

    // On intercepte la toute première requête sortante vers superpdp.tech plutôt que
    // d'attendre la stabilisation de l'URL du navigateur : Super PDP fait ensuite ses
    // propres redirections internes (api. → www., écran de login...) qui font perdre
    // les query params qu'Atelier a construits — ce sont ceux-là qu'on veut vérifier,
    // pas l'état final de la page après plusieurs sauts hors de notre contrôle.
    const firstRequestToSuperPdp = page.waitForRequest((req) => req.url().includes('superpdp.tech'), { timeout: 10_000 })
    await activateButton.click()
    const request = await firstRequestToSuperPdp

    const requestedUrl = new URL(request.url())
    expect(requestedUrl.hostname).toContain('superpdp.tech')
    expect(requestedUrl.pathname).toContain('/oauth2/authorize')
    expect(requestedUrl.searchParams.get('response_type')).toBe('code')
    expect(requestedUrl.searchParams.get('client_id')).toBeTruthy()
    expect(requestedUrl.searchParams.get('redirect_uri')).toBeTruthy()

    const state = requestedUrl.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(state).toContain('.') // encoded.signature
  })

  test('affiche le toggle émission pour un compte déjà connecté à Super PDP', async ({ page }) => {
    await page.goto('/settings?tab=facturation')

    // Ce test suppose oauth_status='connected' pour le compte de test — s'il ne
    // l'est pas (ou plus), il n'est pas pertinent (voir test précédent pour le
    // parcours d'activation initiale).
    const emissionToggle = page.locator('#emission-toggle')
    if (!(await emissionToggle.isVisible().catch(() => false))) {
      test.skip(true, 'Compte non connecté à Super PDP (oauth_status!=connected) — toggle émission non rendu')
      return
    }

    await expect(page.getByText(/Réception des factures fournisseurs/i)).toBeVisible()
    await expect(page.getByText(/Transmettre mes factures émises via Super PDP/i)).toBeVisible()
  })

  test('masque le bouton Activer pour un utilisateur sans la permission einvoicing.configure', async ({ page }) => {
    // Ce cas dépend du rôle du compte de test — documenté ici en tant que garde
    // de non-régression visuelle, pas exécuté sans un second compte à droits réduits.
    test.skip(true, 'Nécessite un compte de test avec un rôle sans einvoicing.configure — non disponible')
  })
})
