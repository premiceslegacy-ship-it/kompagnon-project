import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';
import { ThemeProvider } from '@/components/theme-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { SentryInit } from '@/components/sentry-init';
import { APP_NAME } from '@/lib/brand';
import { appIconPath } from '@/lib/pwa';
import { getPublicRuntimeConfig, serializeRuntimeConfig } from '@/lib/supabase/config';

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
    const runtimeConfigScript = `window.__APP_RUNTIME_CONFIG__ = ${serializeRuntimeConfig(runtimeConfig)};`;

    return (
        <html lang="fr" suppressHydrationWarning>
            <body className={`${displayFont.variable} ${bodyFont.variable} font-body bg-base min-h-screen transition-colors duration-300 ease-out`}>
                <script
                    id="app-runtime-config"
                    dangerouslySetInnerHTML={{ __html: runtimeConfigScript }}
                />
                <SentryInit />
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    <PostHogProvider>
                        {children}
                    </PostHogProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
