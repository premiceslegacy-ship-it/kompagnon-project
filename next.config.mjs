import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        // Cloudflare Workers free plan ne supporte pas cloudflare/images.js
        // On désactive l'optimisation Next.js et on sert les images en passthrough
        unoptimized: true,
    },
    // @react-pdf/renderer et pdf-lib utilisent des modules Node natifs — ne pas bundler côté serveur
    experimental: {
        serverComponentsExternalPackages: ['@react-pdf/renderer', 'pdf-lib'],
    },
    async headers() {
        return [
            {
                // Pages app authentifiées : micro autorisé pour Sarah vocale
                source: '/(app)/(.*)',
                headers: [
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=self, geolocation=()',
                    },
                ],
            },
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload',
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'DENY',
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff',
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'strict-origin-when-cross-origin',
                    },
                    {
                        key: 'Permissions-Policy',
                        value: 'camera=(), microphone=(), geolocation=()',
                    },
                    {
                        key: 'Content-Security-Policy',
                        // nonce-based inline scripts handled via _document; unsafe-inline kept for
                        // next/script and react-pdf until a nonce solution is wired up.
                        // *.sentry.io / *.ingest.us.sentry.io : remontée d'erreurs client (Sentry).
                        // *.posthog.com / *.i.posthog.com : analytics produit (PostHog).
                        value: [
                            "default-src 'self'",
                            "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
                            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                            "font-src 'self' https://fonts.gstatic.com",
                            "img-src 'self' data: blob: https:",
                            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com https://openrouter.ai https://api.elevenlabs.io wss://api.elevenlabs.io https://api-adresse.data.gouv.fr https://*.sentry.io https://*.ingest.us.sentry.io https://*.posthog.com https://*.i.posthog.com",
                            "frame-ancestors 'none'",
                            "form-action 'self'",
                            "base-uri 'self'",
                        ].join('; '),
                    },
                ],
            },
        ];
    },
};

// Suivi Sentry côté client uniquement (voir components/sentry-init.tsx — pas
// src/instrumentation-client.ts, convention Next 15.3+ non supportée par Next
// 14.2 ici) — la partie serveur/edge n'est pas activée : bug connu non résolu (AsyncLocalStorage) sur
// OpenNext/Cloudflare Workers. withSentryConfig() ne s'applique que si les
// variables d'upload sont présentes, pour ne jamais faire échouer le build d'un
// client sans Sentry configuré (setup per-client, credentials optionnels).
const sentryBuildOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    telemetry: false,
};

export default process.env.SENTRY_AUTH_TOKEN
    ? withSentryConfig(nextConfig, sentryBuildOptions)
    : nextConfig;
