import { defineConfig } from 'vitest/config'

// Projet Vitest séparé de vitest.config.ts (racine) : ces tests ont besoin
// d'une vraie base Supabase locale avec RLS active (supabase start + db reset
// + tests/isolation/seed.mts). Le projet racine est 100% unitaire/statique et
// ne doit jamais dépendre d'une base — d'où l'include disjoint (tests/ vs src/).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/isolation/**/*.test.ts'],
    testTimeout: 20_000,
    // Les scénarios réutilisent le même login (2 tenants) — throttling Auth
    // documenté dans scripts/sarah-e2e.mts au-delà de connexions rapprochées.
    fileParallelism: false,
  },
})
