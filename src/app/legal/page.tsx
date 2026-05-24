import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import {
  LEGAL_CONTACT,
  LEGAL_EDITOR,
  legalContactLabel,
} from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Mentions légales - ATELIER',
  description: "Mentions légales de l'application ATELIER.",
}

export default function LegalPage() {
  return (
    <LegalPageShell
      eyebrow="Mentions légales"
      title="Éditeur, hébergement et contact"
      description="Cette page centralise les informations publiques minimales relatives à l'édition et à l'hébergement d'ATELIER."
      updatedAt="25 mai 2026"
    >
      <section className="space-y-4" id="contact">
        <h2 className="text-2xl font-bold">Éditeur</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
          <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
            <strong className="text-slate-900 dark:text-white">{LEGAL_EDITOR.publisherName}</strong>
            <br />
            {LEGAL_EDITOR.companyName}
            <br />
            Adresse : {LEGAL_EDITOR.address}
            <br />
            {LEGAL_EDITOR.registration}
            <br />
            TVA non applicable — article 293 B du CGI
            <br />
            {LEGAL_EDITOR.phone ? <>Téléphone : {LEGAL_EDITOR.phone}<br /></> : null}
            Email : {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            <br />
            Directeur de la publication : {LEGAL_EDITOR.publicationDirector}
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Hébergement</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Exécution applicative</p>
            <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              Cloudflare, Inc. — 101 Townsend St, San Francisco, CA 94107, USA
              <br />
              <a
                href="https://www.cloudflare.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 dark:text-white underline underline-offset-4"
              >
                cloudflare.com
              </a>
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Base de données et stockage</p>
            <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              Supabase, Inc. — 970 Toa Payoh North, Singapour (données stockées en région EU West — Frankfurt, Allemagne)
              <br />
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 dark:text-white underline underline-offset-4"
              >
                supabase.com
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Contacts utiles</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Support</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              {legalContactLabel(LEGAL_CONTACT.supportEmail)}
            </p>
          </div>
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Confidentialité</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              {legalContactLabel(LEGAL_CONTACT.privacyEmail)}
            </p>
          </div>
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Légal</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            </p>
          </div>
        </div>
      </section>
    </LegalPageShell>
  )
}
