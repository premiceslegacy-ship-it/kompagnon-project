import { defineConfig, devices } from '@playwright/test'

// Couvre le parcours artisan côté Atelier UNIQUEMENT : /settings → onglet
// facturation → bouton "Activer" → l'URL de redirection construite est bien
// formée. Le tunnel Super PDP lui-même (domaine tiers, KYC) n'est pas
// automatisable ici — il reste couvert par scripts/super-pdp-sandbox-probe.mjs
// en exécution manuelle. Voir docs/atelier-facturation-electronique.md §7.3.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Un serveur Next dev à froid + Supabase (tier gratuit, cold start) peuvent
  // chacun ajouter 10-20s de latence par requête — timeout par test large pour
  // ne pas confondre lenteur d'infra locale et vraie régression.
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
