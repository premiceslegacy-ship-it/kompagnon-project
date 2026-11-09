// @atelier-migrated
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const dynamic = 'force-dynamic';
import { ThemeProvider } from '@/components/theme-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { SentryInit } from '@/components/sentry-init';
import { APP_NAME } from '@/lib/brand';
import { appIconPath } from '@/lib/pwa';
import { getPublicRuntimeConfig } from '@/lib/supabase/config';
import { ESBUILD_NAME_SHIM } from '@/lib/esbuild-name-shim';

import localFont from 'next/font/local';

const displayFont = localFont({
    src: '../../public/fonts/geist-variable.woff2',
    weight: '100 900',
    variable: '--font-geist'
});

const bodyFont = localFont({
    src: [
        { path: '../../public/fonts/inter-latin-400.woff2', weight: '400' },
        {
            path: '../../public/fonts/inter-latin-500.woff2',
            weight: '500',
        },
        {
            path: '../../public/fonts/inter-latin-600.woff2',
            weight: '600',
        },
        { path: '../../public/fonts/inter-latin-700.woff2', weight: '700' },
    ],
    variable: '--font-inter',
});

// Cockpit /orsayn uniquement (voir .cockpit-shell dans globals.css)
const cockpitFont = localFont({
    src: [
        { path: '../../public/fonts/general-sans-regular.otf', weight: '400', style: 'normal' },
        { path: '../../public/fonts/general-sans-medium.otf', weight: '500', style: 'normal' },
        { path: '../../public/fonts/general-sans-semibold.otf', weight: '600', style: 'normal' },
        { path: '../../public/fonts/general-sans-bold.otf', weight: '700', style: 'normal' },
    ],
    variable: '--font-general-sans',
});

const appFontVariables = `${displayFont.variable} ${bodyFont.variable} ${cockpitFont.variable}`;
const cockpitFontVariables = `${displayFont.variable} ${cockpitFont.variable}`;

export const metadata: Metadata = {
    title: `${APP_NAME} - ERP`,
    description: 'Gérez vos chantiers, vos finances et vos clients avec une intelligence artificielle intégrée.',
    icons: {
        icon: appIconPath(192),
        shortcut: appIconPath(192),
        apple: appIconPath(180),
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
    },
    manifest: '/api/manifest',
};

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const requestHeaders = await headers();
    const nonce = requestHeaders.get('x-nonce') ?? undefined;
    const runtimeConfig = getPublicRuntimeConfig();
    const operatorMode = process.env.OPERATOR_MODE === 'true';

    return (
        <html
            lang="fr"
            className={operatorMode ? cockpitFontVariables : appFontVariables}
            data-atelier-surface={operatorMode ? 'cockpit' : 'app'}
            data-supabase-url={runtimeConfig.supabaseUrl}
            data-supabase-anon-key={runtimeConfig.supabaseAnonKey}
            data-sentry-dsn={process.env.NEXT_PUBLIC_SENTRY_DSN || undefined}
            data-posthog-key={process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined}
            data-posthog-host={process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined}
            suppressHydrationWarning
        >
            <body className={`font-body bg-base min-h-screen transition-colors ${operatorMode ? 'duration-300 ease-out' : 'duration-couleur ease-couleur'}`}>
                <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: ESBUILD_NAME_SHIM }} />
                <SentryInit />
                <ThemeProvider operatorMode={operatorMode} nonce={nonce}>
                    <PostHogProvider>
                        {children}
                    </PostHogProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
