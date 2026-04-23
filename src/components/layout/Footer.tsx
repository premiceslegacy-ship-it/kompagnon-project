import { APP_SIGNATURE } from '@/lib/brand'
import { LegalLinks } from '@/components/legal/LegalLinks'

export const Footer = ({ orgName }: { orgName: string | null }) => (
    <footer className="p-8 border-t border-[var(--elevation-border)] text-center relative z-10">
        <p className="text-secondary text-xs font-medium tracking-widest uppercase">{orgName ?? APP_SIGNATURE} · Logiciel métier</p>
        <LegalLinks className="mt-3" />
    </footer>
);
