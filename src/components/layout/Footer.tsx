'use client'

import { APP_SIGNATURE } from '@/lib/brand'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { usePathname } from 'next/navigation'

export const Footer = ({ orgName }: { orgName: string | null }) => {
    const pathname = usePathname()
    const isEditorWorkspace = pathname?.startsWith('/finances/quote-editor')
    const isAIQuoteWorkspace = pathname?.startsWith('/atelier-ia')

    if (isEditorWorkspace || isAIQuoteWorkspace) return null

    return (
    <footer className="shrink-0 p-8 border-t border-[var(--elevation-border)] text-center relative z-0 bg-base/80 backdrop-blur">
        <p className="text-secondary text-xs font-medium tracking-widest uppercase">{orgName ?? APP_SIGNATURE} · Logiciel métier</p>
        <LegalLinks className="mt-3" />
    </footer>
    )
}
