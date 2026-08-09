import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';
import { ThemeProvider } from '@/components/theme-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { SentryInit } from '@/components/sentry-init';
import { APP_NAME } from '@/lib/brand';
import { appIconPath } from '@/lib/pwa';
import { getPublicRuntimeConfig } from '@/lib/supabase/config';

import { Plus_Jakarta_Sans, Inter } from 'next/font/google';

const displayFont = Plus_Jakarta_Sans({
    subsets: ['latin'],
    weight: ['600', '700', '800'],
    variable: '--font-jakarta'
});

const bodyFont = Inter({
    subsets: ['latin'],
    weight: ['400', '500'],
    variable: '--font-inter'
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
            <body className={`${displayFont.variable} ${bodyFont.variable} font-body bg-base min-h-screen transition-colors duration-300 ease-out`}>
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
