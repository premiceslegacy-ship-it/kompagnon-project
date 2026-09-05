import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';
import { ThemeProvider } from '@/components/theme-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { SentryInit } from '@/components/sentry-init';
import { APP_NAME } from '@/lib/brand';
import { appIconPath } from '@/lib/pwa';
import { getPublicRuntimeConfig } from '@/lib/supabase/config';

import localFont from 'next/font/local';

const displayFont = localFont({
    src: '../../public/fonts/geist-variable.woff2',
    weight: '100 900',
    variable: '--font-jakarta'
});

const bodyFont = localFont({
    src: '../../public/fonts/geist-variable.woff2',
    weight: '100 900',
    variable: '--font-inter'
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

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const runtimeConfig = getPublicRuntimeConfig();

    return (
        <html
            lang="fr"
            data-supabase-url={runtimeConfig.supabaseUrl}
            data-supabase-anon-key={runtimeConfig.supabaseAnonKey}
            data-sentry-dsn={process.env.NEXT_PUBLIC_SENTRY_DSN || undefined}
            data-posthog-key={process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined}
            data-posthog-host={process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined}
            suppressHydrationWarning
        >
            <body className={`${displayFont.variable} ${bodyFont.variable} ${cockpitFont.variable} font-body bg-base min-h-screen transition-colors duration-300 ease-out`}>
                <SentryInit />
                <ThemeProvider>
                    <PostHogProvider>
                        {children}
                    </PostHogProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
