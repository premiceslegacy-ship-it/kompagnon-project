import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { PLATFORM_MODEL } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Conditions générales - ATELIER',
  description: "Conditions générales de vente et d'utilisation B2B d'ATELIER.",
}

export default function TermsPage() {
  return (
    <LegalPageShell
      eyebrow="Conditions générales"
      title="CGV et conditions d'utilisation"
      description="Ces conditions régissent la fourniture d'ATELIER comme logiciel métier B2B. Elles valent conditions générales de vente au sens de l'article L.441-1 du Code de commerce."
      updatedAt="25 mai 2026"
    >
      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Objet du service</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          ATELIER est une application métier B2B destinée à la gestion commerciale, financière et
          opérationnelle d&apos;organisations clientes. Le service est fourni dans un modèle par client,
          hébergé, maintenu et opéré par Orsayn.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Comptes et accès</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Le client désigne les personnes autorisées à accéder à l&apos;application. Chaque utilisateur doit
          protéger ses identifiants, maintenir des informations exactes et signaler sans délai tout accès
          non autorisé ou incident de sécurité.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Licence et propriété intellectuelle</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{PLATFORM_MODEL.ownershipTitle}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{PLATFORM_MODEL.ownershipBody}</p>
        </div>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Le client dispose d&apos;un droit d&apos;usage non exclusif, non cessible et strictement limité à la
          durée de la relation contractuelle, sous réserve du respect des présentes conditions et du
          contrat-cadre applicable.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Données du client</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les données, documents et contenus métier importés ou générés dans ATELIER appartiennent au
          client. Orsayn héberge et traite ces données pour fournir le service, en appliquant le cadre
          contractuel et RGPD convenu avec le client.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Support, maintenance et évolution</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn assure la maintenance corrective, la sécurisation et l&apos;évolution du socle logiciel.
          Cette organisation fait partie du modèle de service et garantit stabilité, sécurité et
          évolutivité du système mis à disposition du client.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Suspension et usage acceptable</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn peut suspendre tout ou partie du service en cas d&apos;usage contraire à la loi, d&apos;atteinte
          à la sécurité, de tentative de détournement technique ou de non-respect grave des obligations
          contractuelles, sous réserve des notifications appropriées lorsque cela est possible.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Fin de contrat et réversibilité</h2>
        <div className="rounded-3xl border border-[var(--elevation-border)] p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{PLATFORM_MODEL.dataTitle}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{PLATFORM_MODEL.dataBody}</p>
        </div>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          La fermeture ne prend pas la forme d&apos;une suppression immédiate en self-service. Le processus
          de sortie comprend une demande formelle, une confirmation, un export lorsque prévu, puis une
          suppression de l&apos;instance ou des données selon le calendrier contractuel et les obligations
          légales applicables.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Données personnelles</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les traitements de données personnelles sont encadrés par la politique de confidentialité et, le
          cas échéant, par une annexe RGPD ou un accord de sous-traitance conforme à l&apos;article 28 du
          RGPD. Les obligations de conservation légales, notamment en matière comptable et fiscale,
          demeurent applicables.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Conditions de paiement</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Le setup one-shot est payable intégralement à la commande, avant le début du déploiement.
          L&apos;abonnement mensuel est facturé à terme échu, avec un délai de règlement de 15 jours
          à compter de la date de facture.
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Conformément à l&apos;article L.441-10 du Code de commerce, tout retard de paiement entraîne
          de plein droit, sans mise en demeure préalable, des pénalités au taux de 3 fois le taux
          d&apos;intérêt légal ainsi qu&apos;une indemnité forfaitaire de 40 euros pour frais de recouvrement
          (article D.441-5 du Code de commerce).
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn est entrepreneur individuel en franchise de TVA — article 293 B du CGI. La TVA
          n&apos;est pas applicable aux factures émises à la date des présentes conditions.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Résiliation</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          L&apos;abonnement mensuel est sans engagement de durée minimale. Chaque partie peut y mettre
          fin avec un préavis de 30 jours calendaires notifié par email. Le setup one-shot n&apos;est
          pas remboursé en cas de résiliation.
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          En cas de manquement grave — notamment non-paiement répété ou usage contraire à la loi —
          Orsayn peut résilier le service après mise en demeure restée sans effet pendant 15 jours.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Responsabilité</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn est soumis à une obligation de moyens dans la fourniture du service. Sa responsabilité
          est limitée aux préjudices directs et prévisibles. Les dommages indirects — perte de
          chiffre d&apos;affaires, manque à gagner, atteinte à l&apos;image — sont exclus.
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          La responsabilité totale d&apos;Orsayn est plafonnée au montant des sommes versées par le
          client au cours des 12 mois précédant le fait générateur du dommage. Ces limitations
          ne s&apos;appliquent pas en cas de faute lourde ou dolosive.
        </p>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Orsayn n&apos;est pas responsable des interruptions de service imputables à ses fournisseurs
          d&apos;infrastructure (Supabase, Cloudflare, Twilio, OpenRouter) ni aux événements de force
          majeure au sens de l&apos;article 1218 du Code civil.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Facturation électronique</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          ATELIER génère des factures au format Factur-X (norme EN 16931), conformes aux exigences
          de la réforme française de facturation électronique.
        </p>
        <div className="rounded-3xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Orsayn est opérateur de dématérialisation (OD), non PDP</p>
          <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">
            Orsayn n&apos;est pas une Plateforme de Dématérialisation Partenaire (PDP) au sens du Décret
            2022-1299. En mode export, la transmission du fichier Factur-X vers une plateforme est
            de la responsabilité du client. En mode B2Brouter, la transmission est assurée par
            B2Brouter, PDP immatriculée par la DGFiP. La conformité légale de la transmission
            incombe à B2Brouter et au client.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Loi applicable et juridiction</h2>
        <p className="text-sm leading-7 text-slate-700 dark:text-zinc-300">
          Les présentes conditions sont soumises au droit français. Tout litige non résolu
          amiablement dans un délai de 30 jours sera porté devant les tribunaux compétents
          du ressort du siège d&apos;Orsayn.
        </p>
      </section>
    </LegalPageShell>
  )
}
