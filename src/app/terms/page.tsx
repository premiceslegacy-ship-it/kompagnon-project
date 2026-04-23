import type { Metadata } from 'next'
import { LegalPageShell } from '@/components/legal/LegalPageShell'
import { PLATFORM_MODEL } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Conditions - ATELIER',
  description: "Conditions d'utilisation B2B d'ATELIER.",
}

export default function TermsPage() {
  return (
    <LegalPageShell
      eyebrow="Conditions d'utilisation"
      title="Cadre B2B de mise à disposition"
      description="Ces conditions résument le mode de fourniture d'ATELIER comme logiciel métier par client. Elles servent de socle public cohérent avec le contrat-cadre et l'annexe RGPD."
      updatedAt="23 avril 2026"
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
    </LegalPageShell>
  )
}
