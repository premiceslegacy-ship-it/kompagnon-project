import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        // Images servies sans transformation payante. OpenNext sait fonctionner
        // sans binding IMAGES ; aucun patch du Worker généré n'est nécessaire.
        unoptimized: true,
    },
    // pdf-lib reste externe côté serveur ; aucune dépendance react-pdf.
    serverExternalPackages: ['pdf-lib'],
    async redirects() {
        return [
            {
                // Centre des relances supprimé (dashboard fait déjà le suivi) —
                // conserve les liens déjà émis (notifications push, favoris).
                source: '/reminders',
                destination: '/finances',
                permanent: false,
            },
        ];
    },
    async headers() {
        // Next applique toutes les règles qui matchent une URL, dans l'ordre de ce
        // tableau ; pour un header répété, la dernière valeur déclarée l'emporte.
        // Permissions-Policy est donc sorti de la règle générale et placé en dernier,
        // pour que la restriction par défaut (tout bloqué) ne vienne jamais écraser
        // l'autorisation micro accordée juste avant aux pages app authentifiées.
        return [
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload',
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff',
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin',
                    },
                ],
            },
            {
                // Le formulaire public est intégrable ; la CSP conserve le refus
                // de framing partout ailleurs, en plus de ce header historique.
                source: '/((?!demande/[^/]+/?$).*)',
                headers: [
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY',
                    },
                ],
            },
            {
                // Défaut : micro/caméra/géoloc bloqués partout, y compris les pages
                // publiques et l'auth. Doit rester déclaré avant la règle app ci-dessous
                // pour que celle-ci l'emporte sur les pages authentifiées.
                source: '/(.*)',
                headers: [
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(), geolocation=()',
                    },
                ],
            },
            {
                // Pages app authentifiées : micro autorisé pour Sarah (dictée et vocal live).
                // Le groupe de routes (app) n'apparaît pas dans l'URL réelle : on liste donc
                // ses segments explicitement plutôt qu'un pattern '/(app)/(.*)' qui ne matche
                // jamais rien et laissait silencieusement microphone=() bloquer tout accès.
                source: '/:section(dashboard|clients|chantiers|finances|devis|catalog|contracts|rapports|requests|settings|atelier-ia|kompagnon-ia|orsayn)/:rest*',
                headers: [
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=self, geolocation=()',
                    },
                ],
            },
        ];
    },
};

// Suivi Sentry côté client uniquement (components/sentry-init.tsx). La partie
// serveur/edge reste désactivée pour le runtime OpenNext/Cloudflare. L'upload
// des sources est optionnel pour les instances sans configuration Sentry.
const sentryBuildOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    telemetry: false,
    webpack: {
        // L'upload des sourcemaps ne doit pas réintroduire le SDK Node dans
        // le Worker quand SENTRY_AUTH_TOKEN est configuré en CI.
        autoInstrumentServerFunctions: false,
        autoInstrumentMiddleware: false,
        autoInstrumentAppDirectory: false,
    },
};

export default process.env.SENTRY_AUTH_TOKEN
    ? withSentryConfig(nextConfig, sentryBuildOptions)
    : nextConfig;
