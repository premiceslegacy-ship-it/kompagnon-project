import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import {
  LEGAL_CONTACT,
  LEGAL_COPY,
  LEGAL_EDITOR,
  PLATFORM_MODEL,
  DATA_RETENTION_TABLE,
  legalContactLabel,
} from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Confidentialité - ATELIER',
  description: 'Politique de confidentialité et traitement des données dans ATELIER.',
}

export default function PrivacyPage() {
  return (
    <LegalPageShell
      eyebrow="Politique de confidentialité"
      title="Données, rôles et suppression"
      description="Cette politique explique comment ATELIER traite les données dans un contexte B2B par client. Elle est rédigée pour rester cohérente entre l'application, les contrats et les documents publics."
      updatedAt="23 avril 2026"
    >
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{PLATFORM_MODEL.ownershipTitle}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{PLATFORM_MODEL.ownershipBody}</p>
        </div>
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{PLATFORM_MODEL.dataTitle}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{PLATFORM_MODEL.dataBody}</p>
        </div>
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{PLATFORM_MODEL.privacyTitle}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{PLATFORM_MODEL.privacyBody}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Rôles de traitement</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Dans le cadre des données métier hébergées pour le compte de chaque client, Orsayn intervient
          généralement comme sous-traitant et agit selon les instructions contractuelles du client.
          Pour ses propres traitements de compte, support, sécurité, journalisation et facturation,
          Orsayn peut agir comme responsable de traitement. Cette qualification est appréciée au cas
          par cas selon les finalités et moyens réellement déterminés.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Catégories de données</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Données métier client</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              Comptes utilisateurs du client, fiches clients, devis, factures, demandes entrantes,
              données de chantier, historique d&apos;actions et paramètres d&apos;organisation.
            </p>
          </div>
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Données propres à Orsayn</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              Logs techniques de sécurité, suivi de support, informations nécessaires à la gestion
              contractuelle, à la prévention des abus et à la facturation de la prestation.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Finalités et bases juridiques</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les données sont traitées pour fournir le service, gérer l&apos;authentification, héberger les
          contenus métier, assurer la sécurité, répondre au support, exécuter le contrat et respecter
          les obligations légales applicables. Les bases juridiques mobilisées sont principalement
          l&apos;exécution du contrat, l&apos;intérêt légitime de sécurisation et de support, ainsi que le
          respect des obligations légales de conservation.
        </p>
      </section>

      <section id="suppression" className="space-y-4">
        <h2 className="text-2xl font-bold">Conservation, sauvegarde et suppression</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">{LEGAL_COPY.deletion}</p>
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Principe appliqué dans ATELIER</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
            Une demande de suppression fait l&apos;objet d&apos;une confirmation, puis d&apos;un export complet des données pour le client. 
            Les données sans obligation de conservation sont ensuite supprimées ou anonymisées de nos serveurs. 
            Les pièces soumises à des obligations comptables, fiscales ou probatoires (factures, devis signés) sont conservées pendant
            la durée strictement légale requise avant destruction définitive.
          </p>
        </div>
      </section>

      <section id="retention" className="space-y-4">
        <h2 className="text-2xl font-bold">Durées de conservation par type de données</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les durées ci-dessous s&apos;appliquent à compter de la dernière interaction ou de la fermeture du compte selon le type de donnée.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-[var(--elevation-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5">
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Type de données</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Durée de conservation</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Base légale</th>
              </tr>
            </thead>
            <tbody>
              {DATA_RETENTION_TABLE.map((row, i) => (
                <tr key={i} className="border-b border-[var(--elevation-border)] last:border-0">
                  <td className="px-4 py-3 text-slate-900 dark:text-white">{row.type}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-zinc-300">{row.duration}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-400">{row.base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="suppression" className="space-y-4">
        <h2 className="text-2xl font-bold">Suppression de compte</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">{LEGAL_COPY.deletion}</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Cookies et sécurité</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">{LEGAL_COPY.cookies}</p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn met en œuvre des mesures techniques et organisationnelles poussées pour protéger les
          données contre l&apos;accès non autorisé, la perte, l&apos;altération ou la divulgation, notamment au
          niveau de l&apos;hébergement privé, des accès restreints et des sauvegardes journalières.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Exercice des droits et contact</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les demandes relatives à l&apos;accès, la rectification, la limitation, l&apos;export ou la suppression
          peuvent être adressées à {legalContactLabel(LEGAL_CONTACT.privacyEmail)}. Si la demande concerne
          des données métier traitées pour le compte d&apos;un client (un artisan), elle pourra être coordonnée avec ce
          client en sa qualité de responsable de traitement de ses propres clients.
        </p>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Éditeur de la solution</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
            {LEGAL_EDITOR.publisherName} · {LEGAL_EDITOR.companyName}
            <br />
            {LEGAL_EDITOR.address}
            <br />
            Contact : {legalContactLabel(LEGAL_CONTACT.legalEmail)}
          </p>
        </div>
      </section>
    </LegalPageShell>
  )
}
