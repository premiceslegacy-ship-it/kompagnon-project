import type { ReactNode } from 'react'

/**
 * Socle des pages vues par les clients des artisans (signature, demande de devis, espace intervenant).
 * Mise en page seulement : colonne centrée, en-tête de l'entreprise, confirmation et notes.
 * Les contrôles viennent tous de `src/components/ui/`.
 */
export function PublicPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-dvh bg-fond text-encre">
      <div className={`mx-auto w-full px-espace-16 pb-espace-48 pt-espace-8 ${wide ? 'max-w-[640px]' : 'max-w-[560px]'}`}>
        {children}
      </div>
    </main>
  )
}

export function PublicHeader({ name, address, subtitle, logoUrl }: { name: string; address?: string | null; subtitle?: string | null; logoUrl?: string | null }) {
  return (
    <header className="flex flex-col items-center gap-[2px] pb-[18px] pt-espace-48 text-center">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- logo de l'entreprise, hôte arbitraire
        <img src={logoUrl} alt="" className="mb-espace-8 h-12 max-w-full object-contain" />
      )}
      <p className="m-0 text-titre-2 font-atelier-bold [overflow-wrap:anywhere]">{name}</p>
      {address && <p className="m-0 text-note text-encre-2 [overflow-wrap:anywhere]">{address}</p>}
      {subtitle && <p className="m-0 mt-[10px] text-sous-titre font-atelier-medium text-encre-2 [overflow-wrap:anywhere]">{subtitle}</p>}
    </header>
  )
}

export function PublicTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <>
      <h1 className="mx-espace-4 my-0 text-titre-1 font-atelier-bold [text-wrap:balance]">{children}</h1>
      {description && <p className="mx-espace-4 mb-[14px] mt-[6px] text-sous-titre text-encre-2 [text-wrap:pretty]">{description}</p>}
    </>
  )
}

/** Confirmation d'une action réussie : coche, titre, phrase, puis les suites éventuelles. */
export function PublicSuccess({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <section className="pb-[6px] pt-[18px] text-center" aria-labelledby="public-success-title">
      <div className="mx-auto mb-[14px] mt-[18px] grid size-16 place-items-center rounded-full bg-[color-mix(in_srgb,var(--at-hausse)_16%,transparent)] text-hausse" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-[30px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h1 id="public-success-title" className="m-0 text-titre-2 font-atelier-bold">{title}</h1>
      <p className="mx-0 mb-[18px] mt-espace-4 text-sous-titre text-encre-2 [text-wrap:pretty]">{description}</p>
      {children && <div className="text-left">{children}</div>}
    </section>
  )
}

export function PublicNote({ children, centered = false }: { children: ReactNode; centered?: boolean }) {
  return <p className={`mx-espace-16 mb-0 mt-[12px] text-note text-encre-2 ${centered ? 'text-center' : ''}`}>{children}</p>
}

/** Message d'erreur de formulaire, annoncé aux lecteurs d'écran. */
export function PublicError({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p role="alert" className="mx-espace-4 mb-[12px] mt-[12px] text-sous-titre font-atelier-medium text-[color-mix(in_srgb,var(--at-baisse)_75%,var(--at-encre))]">{children}</p>
}
