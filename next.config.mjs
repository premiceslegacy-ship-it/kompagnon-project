/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        // Cloudflare Workers free plan ne supporte pas cloudflare/images.js
        // On désactive l'optimisation Next.js et on sert les images en passthrough
        unoptimized: true,
    },
};

export default nextConfig;
