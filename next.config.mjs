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
                        value: [
                            "default-src 'self'",
                            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                            "font-src 'self' https://fonts.gstatic.com",
                            "img-src 'self' data: blob: https:",
                            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com https://openrouter.ai",
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

export default nextConfig;
