'use client'

import { Children, isValidElement, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BrandWordmark } from '@/components/brand/BrandMonogram'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { APP_SIGNATURE } from '@/lib/brand'
import { LEGAL_PATHS } from '@/lib/legal'

type Props = {
  eyebrow: string
  title: string
  description: string
  updatedAt: string
  children: ReactNode
}

type LegalSectionProps = {
  title: string
  id?: string
  children: ReactNode
}

const LEGAL_PAGES = [
  { href: LEGAL_PATHS.legal, label: 'Mentions légales' },
  { href: LEGAL_PATHS.terms, label: 'Conditions générales' },
  { href: LEGAL_PATHS.privacy, label: 'Politique de confidentialité' },
] as const

export function legalSectionId({ id, title }: Pick<LegalSectionProps, 'id' | 'title'>): string {
  if (id) return id
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Une section de texte juridique ; son titre alimente le sommaire de la page. */
export function LegalSection({ title, id, children }: LegalSectionProps) {
  return (
    <section
      id={legalSectionId({ id, title })}
      tabIndex={-1}
      className="mx-espace-4 mt-[26px] scroll-mt-espace-20 space-y-espace-12 outline-none"
    >
      <h2 className="m-0 text-titre-3 font-atelier-medium">{title}</h2>
      {children}
    </section>
  )
}

export function LegalPageShell({ eyebrow, title, description, updatedAt, children }: Props) {
  const router = useRouter()
  const sections = Children.toArray(children).flatMap((child) =>
    isValidElement<LegalSectionProps>(child) && child.type === LegalSection
      ? [{ id: legalSectionId(child.props), title: child.props.title }]
      : [],
  )

  const scrollTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
  }

  return (
    <main className="min-h-dvh bg-fond text-encre">
      <div className="mx-auto w-full max-w-[640px] px-espace-16 pb-espace-48">
        <div className="flex items-center justify-between gap-espace-12 pb-espace-8 pt-[36px]">
          <Link href="/login" className="inline-flex min-h-11 items-center" aria-label="Atelier, aller à la connexion">
            <BrandWordmark background="light" alt="" className="h-6 w-auto object-contain dark:hidden" />
            <BrandWordmark background="dark" alt="" className="hidden h-6 w-auto object-contain dark:block" />
          </Link>
          <Button variant="text" onClick={() => router.back()}>Retour</Button>
        </div>

        <p className="mx-espace-4 mb-espace-4 mt-[14px] text-note font-atelier-medium text-accent-texte">{eyebrow}</p>
        <h1 className="mx-espace-4 my-0 text-titre-1 font-atelier-bold [text-wrap:balance]">{title}</h1>
        <p className="mx-espace-4 mb-[14px] mt-[6px] text-sous-titre leading-[21px] text-encre-2 [text-wrap:pretty]">{description}</p>
        <p className="mx-espace-4 mb-[14px] mt-0 text-note text-encre-3">Dernière mise à jour : {updatedAt}</p>

        {sections.length > 1 && (
          <ListGroup title="Sommaire">
            {sections.map((section) => (
              <ListRow key={section.id} title={section.title} onClick={() => scrollTo(section.id)} />
            ))}
          </ListGroup>
        )}

        {Children.map(children, (child) =>
          isValidElement(child) && child.type === LegalSection
            ? child
            : <div className="mx-espace-4 mt-[26px]">{child}</div>,
        )}

        <footer className="mx-espace-4 mt-[34px] border-t border-trait pt-espace-16">
          <nav aria-label="Liens légaux" className="flex flex-wrap gap-x-[18px] gap-y-espace-4">
            {LEGAL_PAGES.map((page) => (
              <Link key={page.href} href={page.href} className="inline-flex min-h-11 items-center text-sous-titre text-accent-texte">
                {page.label}
              </Link>
            ))}
          </nav>
          <p className="mb-0 mt-espace-8 text-note text-encre-3">© {new Date().getFullYear()} {APP_SIGNATURE}. Tous droits réservés.</p>
        </footer>
      </div>
    </main>
  )
}
