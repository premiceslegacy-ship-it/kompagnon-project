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
      updatedAt="25 mai 2026"
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
        <div className="overflow-x-auto rounded-2xl border border-[var(--elevation-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5">
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Traitement</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Finalité</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Base légale (RGPD art. 6)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { traitement: 'Données métier (devis, factures, chantiers, clients)', finalite: 'Fourniture du service contractualisé', base: 'Exécution du contrat — art. 6(1)(b)' },
                { traitement: 'Authentification et sessions', finalite: 'Sécurité des accès', base: 'Intérêt légitime — art. 6(1)(f)' },
                { traitement: 'Logs d\'activité et d\'audit', finalite: 'Sécurité, détection d\'abus, conformité', base: 'Intérêt légitime — art. 6(1)(f)' },
                { traitement: 'Conversations WhatsApp', finalite: 'Traçabilité des échanges client, qualité du service', base: 'Intérêt légitime — art. 6(1)(f)' },
                { traitement: 'Facturation et gestion contractuelle', finalite: 'Exécution du contrat entre Orsayn et l\'artisan', base: 'Exécution du contrat — art. 6(1)(b)' },
                { traitement: 'Conservation des pièces comptables', finalite: 'Obligation légale de conservation 10 ans', base: 'Obligation légale — art. 6(1)(c)' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-[var(--elevation-border)] last:border-0">
                  <td className="px-4 py-3 text-slate-900 dark:text-white">{row.traitement}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-zinc-300">{row.finalite}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-400">{row.base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <h2 className="text-2xl font-bold">Sous-traitants et transferts hors UE</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn fait appel aux prestataires techniques suivants pour fournir le service.
          Les transferts vers des sociétés américaines sont encadrés par leur certification
          au Data Privacy Framework UE-USA (décision d&apos;adéquation 2023/1795 de la Commission européenne)
          ou par des clauses contractuelles types.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-[var(--elevation-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5">
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Prestataire</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Pays</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Rôle</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-white">Garantie</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Supabase, Inc.', pays: 'USA (données EU Frankfurt)', role: 'Base de données, authentification, stockage', garantie: 'Data Privacy Framework' },
                { name: 'Cloudflare, Inc.', pays: 'USA (CDN mondial)', role: 'Exécution applicative, réseau', garantie: 'Data Privacy Framework' },
                { name: 'Mistral AI', pays: 'France (UE)', role: 'Transcription audio (saisie vocale)', garantie: 'Entité UE' },
                { name: 'OpenRouter, Inc.', pays: 'USA', role: 'Routage des appels LLM (IA)', garantie: 'Clauses contractuelles types' },
                { name: 'Resend, Inc.', pays: 'USA', role: 'Emails transactionnels', garantie: 'Clauses contractuelles types' },
                { name: 'Twilio, Inc.', pays: 'USA', role: 'Messagerie WhatsApp', garantie: 'Data Privacy Framework' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-[var(--elevation-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.name}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-zinc-300">{row.pays}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-zinc-300">{row.role}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-400">{row.garantie}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Aucune vente de données à des tiers. Aucune utilisation des données métier à des fins d&apos;entraînement de modèles ou de publicité.
        </p>
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
          Conformément au RGPD (articles 15 à 22), vous disposez des droits suivants : accès, rectification,
          effacement, limitation, portabilité, opposition. Les demandes peuvent être adressées
          à {legalContactLabel(LEGAL_CONTACT.privacyEmail)}. Délai de réponse : 30 jours calendaires.
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Si la demande concerne des données métier traitées pour le compte d&apos;un artisan (ses propres clients
          ou collaborateurs), elle sera coordonnée avec cet artisan en sa qualité de responsable de traitement.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
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
          <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Autorité de contrôle</p>
            <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
              Commission Nationale de l&apos;Informatique et des Libertés (CNIL)
              <br />
              3 Place de Fontenoy — 75334 Paris Cedex 07
              <br />
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-900 dark:text-white underline underline-offset-4"
              >
                Déposer une réclamation — cnil.fr
              </a>
            </p>
          </div>
        </div>
      </section>
    </LegalPageShell>
  )
}
