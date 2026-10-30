// Identifiants des tenants de test, séparés de seed.mts pour que les fichiers
// de test puissent les importer sans redéclencher le seed (qui s'exécute au
// top-level de seed.mts) à chaque import.

export const TENANTS = {
  a: {
    email: 'isolation-test-a@atelier-btp.test',
    password: 'IsolationTestA-44!',
    fullName: 'Tenant A Test',
    companyName: 'Tenant A — Isolation Test',
  },
  b: {
    email: 'isolation-test-b@atelier-btp.test',
    password: 'IsolationTestB-44!',
    fullName: 'Tenant B Test',
    companyName: 'Tenant B — Isolation Test',
  },
  // Rôle lecture seule dans l'organisation A : sert à prouver que les gardes
  // valent aussi contre un membre non privilégié du bon tenant, pas seulement
  // contre un autre tenant.
  viewer: {
    email: 'isolation-test-viewer@atelier-btp.test',
    password: 'IsolationTestViewer-44!',
    fullName: 'Tenant A Viewer',
  },
} as const
