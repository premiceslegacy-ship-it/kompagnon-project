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
      updatedAt="23 avril 2026"
    >
      <section className="space-y-4" id="contact">
        <h2 className="text-2xl font-bold">Éditeur</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
          <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
            <strong className="text-slate-900 dark:text-white">{LEGAL_EDITOR.publisherName}</strong>
            <br />
            Société : {LEGAL_EDITOR.companyName}
            <br />
            Adresse : {LEGAL_EDITOR.address}
            <br />
            Immatriculation : {LEGAL_EDITOR.registration}
            <br />
            {LEGAL_EDITOR.vatNumber ? <>TVA : {LEGAL_EDITOR.vatNumber}<br /></> : null}
            {LEGAL_EDITOR.phone ? <>Téléphone : {LEGAL_EDITOR.phone}<br /></> : null}
            Email : {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            <br />
            Directeur de la publication : {LEGAL_EDITOR.publicationDirector}
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Hébergement</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
          <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
            Hébergeur : {LEGAL_EDITOR.hostingProvider}
            <br />
            Site :{' '}
            <a
              href={LEGAL_EDITOR.hostingWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-900 dark:text-white underline underline-offset-4"
            >
              {LEGAL_EDITOR.hostingWebsite}
            </a>
          </p>
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
