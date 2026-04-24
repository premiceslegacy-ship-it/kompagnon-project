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
};

export default nextConfig;
