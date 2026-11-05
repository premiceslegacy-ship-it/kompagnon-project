import type { Metadata } from 'next'
import { LegalPageShell, LegalSection } from '@/components/legal/LegalPageShell'
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
      <LegalSection title="Éditeur" id="contact">
        <div className="rounded-groupe-liste bg-carte p-espace-16">
          <p className="text-sous-titre leading-[23px] text-encre-2">
            <strong className="text-encre">{LEGAL_EDITOR.publisherName}</strong>
            <br />
            {LEGAL_EDITOR.companyName}
            <br />
            Adresse : {LEGAL_EDITOR.address}
            <br />
            {LEGAL_EDITOR.registration}
            <br />
            TVA non applicable (article 293 B du CGI)
            <br />
            {LEGAL_EDITOR.phone ? <>Téléphone : {LEGAL_EDITOR.phone}<br /></> : null}
            Email : {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            <br />
            Directeur de la publication : {LEGAL_EDITOR.publicationDirector}
          </p>
        </div>
      </LegalSection>

      <LegalSection title="Hébergement">
        <div className="rounded-groupe-liste bg-carte p-espace-16 space-y-espace-12">
          <div>
            <p className="text-sous-titre font-atelier-medium text-encre">Exécution applicative</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA
              <br />
              <a
                href="https://www.cloudflare.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-atelier-medium text-accent-texte underline underline-offset-4"
              >
                cloudflare.com
              </a>
            </p>
          </div>
          <div>
            <p className="text-sous-titre font-atelier-medium text-encre">Base de données et stockage</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              Supabase, Inc., 970 Toa Payoh North, Singapour (données stockées en région EU West, Frankfurt, Allemagne)
              <br />
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-atelier-medium text-accent-texte underline underline-offset-4"
              >
                supabase.com
              </a>
            </p>
          </div>
        </div>
      </LegalSection>

      <LegalSection title="Contacts utiles">
        <div className="grid gap-espace-12 md:grid-cols-3">
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Support</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              {legalContactLabel(LEGAL_CONTACT.supportEmail)}
            </p>
          </div>
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Confidentialité</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              {legalContactLabel(LEGAL_CONTACT.privacyEmail)}
            </p>
          </div>
          <div className="rounded-groupe-liste bg-carte p-espace-16">
            <p className="text-sous-titre font-atelier-medium text-encre">Légal</p>
            <p className="mt-espace-4 text-sous-titre text-encre-2">
              {legalContactLabel(LEGAL_CONTACT.legalEmail)}
            </p>
          </div>
        </div>
      </LegalSection>
    </LegalPageShell>
  )
}
