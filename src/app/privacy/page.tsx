import type { Metadata } from 'next'
import { LegalPageShell, LegalSection } from '@/components/legal/LegalPageShell'
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
      <div className="grid gap-espace-12 md:grid-cols-3">
        <div className="rounded-groupe-liste bg-carte p-espace-16">
          <p className="text-sous-titre font-atelier-medium text-encre">{PLATFORM_MODEL.ownershipTitle}</p>
          <p className="mt-espace-4 text-sous-titre text-encre-2">{PLATFORM_MODEL.ownershipBody}</p>
        </div>
        <div className="rounded-groupe-liste bg-carte p-espace-16">
          <p className="text-sous-titre font-atelier-medium text-encre">{PLATFORM_MODEL.dataTitle}</p>
          <p className="mt-espace-4 text-sous-titre text-encre-2">{PLATFORM_MODEL.dataBody}</p>
        </div>
        <div className="rounded-groupe-liste bg-carte p-espace-16">
          <p className="text-sous-titre font-atelier-medium text-encre">{PLATFORM_MODEL.privacyTitle}</p>
          <p className="mt-espace-4 text-sous-titre text-encre-2">{PLATFORM_MODEL.privacyBody}</p>
        </div>
      </div>

      <LegalSection title="Rôles de traitement">
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Dans le cadre des données métier hébergées pour le compte de chaque client, Orsayn intervient
          généralement comme sous-traitant et agit selon les instructions contractuelles du client.
          Pour ses propres traitements de compte, support, sécurité, journalisation et facturation,
          Orsayn peut agir comme responsable de traitement. Cette qualification est appréciée au cas
          par cas selon les finalités et moyens réellement déterminés.
        </p>
      </LegalSection>

      <LegalSection title="Catégories de données">
        <div className="grid gap-espace-12 md:grid-cols-2">
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Données métier client</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              Comptes utilisateurs du client, fiches clients, devis, factures, demandes entrantes,
              données de chantier, historique d&apos;actions et paramètres d&apos;organisation.
            </p>
          </div>
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Données propres à Orsayn</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              Logs techniques de sécurité, suivi de support, informations nécessaires à la gestion
              contractuelle, à la prévention des abus et à la facturation de la prestation.
            </p>
          </div>
        </div>
      </LegalSection>

      <LegalSection title="Finalités et bases juridiques">
        <div className="overflow-x-auto rounded-groupe-liste bg-carte">
          <table className="w-full text-note">
            <thead>
              <tr className="border-b border-trait">
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Traitement</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Finalité</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Base légale (RGPD art. 6)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { traitement: 'Données métier (devis, factures, chantiers, clients)', finalite: 'Fourniture du service contractualisé', base: 'Exécution du contrat (art. 6(1)(b))' },
                { traitement: 'Authentification et sessions', finalite: 'Sécurité des accès', base: 'Intérêt légitime (art. 6(1)(f))' },
                { traitement: 'Logs d\'activité et d\'audit', finalite: 'Sécurité, détection d\'abus, conformité', base: 'Intérêt légitime (art. 6(1)(f))' },
                { traitement: 'Facturation et gestion contractuelle', finalite: 'Exécution du contrat entre Orsayn et l\'artisan', base: 'Exécution du contrat (art. 6(1)(b))' },
                { traitement: 'Conservation des pièces comptables', finalite: 'Obligation légale de conservation 10 ans', base: 'Obligation légale (art. 6(1)(c))' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-trait last:border-0">
                  <td className="px-espace-16 py-espace-12 text-encre">{row.traitement}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.finalite}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="suppression" title="Conservation, sauvegarde et suppression">
        <p className="text-sous-titre leading-[23px] text-encre-2">{LEGAL_COPY.deletion}</p>
        <div className="rounded-groupe-liste bg-carte p-espace-16">
          <p className="text-sous-titre font-atelier-medium text-encre">Principe appliqué dans ATELIER</p>
          <p className="mt-espace-4 text-sous-titre text-encre-2">
            Une demande de suppression fait l&apos;objet d&apos;une confirmation, puis d&apos;un export complet des données pour le client. 
            Les données sans obligation de conservation sont ensuite supprimées ou anonymisées de nos serveurs. 
            Les pièces soumises à des obligations comptables, fiscales ou probatoires (factures, devis signés) sont conservées pendant
            la durée strictement légale requise avant destruction définitive.
          </p>
        </div>
      </LegalSection>

      <LegalSection id="retention" title="Durées de conservation par type de données">
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Les durées ci-dessous s&apos;appliquent à compter de la dernière interaction ou de la fermeture du compte selon le type de donnée.
        </p>
        <div className="overflow-x-auto rounded-groupe-liste bg-carte">
          <table className="w-full text-note">
            <thead>
              <tr className="border-b border-trait">
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Type de données</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Durée de conservation</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Base légale</th>
              </tr>
            </thead>
            <tbody>
              {DATA_RETENTION_TABLE.map((row, i) => (
                <tr key={i} className="border-b border-trait last:border-0">
                  <td className="px-espace-16 py-espace-12 text-encre">{row.type}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.duration}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.base}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="suppression-compte" title="Suppression de compte">
        <p className="text-sous-titre leading-[23px] text-encre-2">{LEGAL_COPY.deletion}</p>
      </LegalSection>

      <LegalSection title="Sous-traitants et transferts hors UE">
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Orsayn fait appel aux prestataires techniques suivants pour fournir le service.
          Les transferts vers des sociétés américaines sont encadrés par leur certification
          au Data Privacy Framework UE-USA (décision d&apos;adéquation 2023/1795 de la Commission européenne)
          ou par des clauses contractuelles types.
        </p>
        <div className="overflow-x-auto rounded-groupe-liste bg-carte">
          <table className="w-full text-note">
            <thead>
              <tr className="border-b border-trait">
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Prestataire</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Pays</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Rôle</th>
                <th className="px-espace-16 py-espace-12 text-left font-atelier-medium text-encre">Garantie</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Supabase, Inc.', pays: 'USA (données EU Frankfurt)', role: 'Base de données, authentification, stockage', garantie: 'Data Privacy Framework' },
                { name: 'Cloudflare, Inc.', pays: 'USA (CDN mondial)', role: 'Exécution applicative, réseau', garantie: 'Data Privacy Framework' },
                { name: 'Mistral AI', pays: 'France (UE)', role: 'Transcription audio (saisie vocale)', garantie: 'Entité UE' },
                { name: 'OpenRouter, Inc.', pays: 'USA', role: 'Routage des appels LLM (IA)', garantie: 'Clauses contractuelles types' },
                { name: 'Resend, Inc.', pays: 'USA', role: 'Emails transactionnels', garantie: 'Clauses contractuelles types' },
              ].map((row, i) => (
                <tr key={i} className="border-b border-trait last:border-0">
                  <td className="px-espace-16 py-espace-12 font-atelier-medium text-encre">{row.name}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.pays}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.role}</td>
                  <td className="px-espace-16 py-espace-12 text-encre-2">{row.garantie}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Aucune vente de données à des tiers. Aucune utilisation des données métier à des fins d&apos;entraînement de modèles ou de publicité.
        </p>
      </LegalSection>

      <LegalSection title="Cookies et sécurité">
        <p className="text-sous-titre leading-[23px] text-encre-2">{LEGAL_COPY.cookies}</p>
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Orsayn met en œuvre des mesures techniques et organisationnelles poussées pour protéger les
          données contre l&apos;accès non autorisé, la perte, l&apos;altération ou la divulgation, notamment au
          niveau de l&apos;hébergement privé, des accès restreints et des sauvegardes journalières.
        </p>
      </LegalSection>

      <LegalSection title="Exercice des droits et contact">
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Conformément au RGPD (articles 15 à 22), vous disposez des droits suivants : accès, rectification,
          effacement, limitation, portabilité, opposition. Les demandes peuvent être adressées
          à {legalContactLabel(LEGAL_CONTACT.privacyEmail)}. Délai de réponse : 30 jours calendaires.
        </p>
        <p className="text-sous-titre leading-[23px] text-encre-2">
          Si la demande concerne des données métier traitées pour le compte d&apos;un artisan (ses propres clients
          ou collaborateurs), elle sera coordonnée avec cet artisan en sa qualité de responsable de traitement.
        </p>
        <div className="grid gap-espace-12 md:grid-cols-2">
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Éditeur de la solution</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              {LEGAL_EDITOR.publisherName} · {LEGAL_EDITOR.companyName}
              <br />
              {LEGAL_EDITOR.address}
              <br />
              Contact : {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            </p>
          </div>
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Autorité de contrôle</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              Commission Nationale de l&apos;Informatique et des Libertés (CNIL)
              <br />
              3 Place de Fontenoy, 75334 Paris Cedex 07
              <br />
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="font-atelier-medium text-accent-texte underline underline-offset-4"
              >
                Déposer une réclamation sur cnil.fr
              </a>
            </p>
          </div>
        </div>
      </LegalSection>
    </LegalPageShell>
  )
}
