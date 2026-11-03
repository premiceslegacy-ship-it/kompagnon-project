"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const liquidbuttonVariants = cva(
    "relative isolate inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--at-rayon-pilule)] font-body font-bold transition-all duration-[var(--at-duree-deplacement)] ease-[var(--at-courbe-deplacement)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--at-accent-texte)] disabled:pointer-events-none disabled:opacity-50 group cursor-pointer after:content-[''] after:absolute after:left-1/2 after:top-1/2 after:h-[max(100%,44px)] after:w-[max(100%,44px)] after:-translate-x-1/2 after:-translate-y-1/2 after:pointer-events-auto motion-reduce:transition-none motion-reduce:transform-none",
    {
        variants: {
            variant: {
                // Surface claire ou verre sombre, avec les rôles sémantiques Atelier.
                default: "bg-[var(--at-carte)] text-[var(--at-encre)] border border-[var(--at-trait)] shadow-[0_1px_2px_color-mix(in_srgb,var(--at-encre)_4%,transparent),0_2px_8px_color-mix(in_srgb,var(--at-encre)_6%,transparent)] hover:shadow-[0_0_30px_color-mix(in_srgb,var(--at-accent)_30%,transparent)] hover:scale-[1.02] active:scale-95 dark:bg-[color-mix(in_srgb,var(--at-carte)_5%,transparent)] dark:backdrop-blur-sm",
                // CTA accentuée, avec un texte de contraste dédié.
                accent: "bg-[var(--at-accent)] text-[var(--at-sur-accent)] hover:brightness-110 hover:scale-[1.02] active:scale-95 shadow-[0_0_30px_color-mix(in_srgb,var(--at-accent)_30%,transparent)] font-extrabold",
                // Capsule translucide fondée sur la carte du thème courant.
                glass: "bg-[color-mix(in_srgb,var(--at-carte)_10%,transparent)] backdrop-blur-sm text-[var(--at-encre)] border border-[color-mix(in_srgb,var(--at-trait)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--at-carte)_15%,transparent)] hover:scale-[1.02] active:scale-95",
            },
            size: {
                default: "h-12 px-6 py-3 text-sm",
                sm: "h-9 px-4 py-2 text-xs",
                lg: "h-14 px-8 py-4 text-base",
                icon: "h-12 w-12 text-sm",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface LiquidButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidbuttonVariants> {
    asChild?: boolean
}

const LiquidButton = React.forwardRef<HTMLButtonElement, LiquidButtonProps>(
    ({ className, variant, size, asChild = false, children, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        const child = asChild
            ? React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode }>
            : null

        const content = (
            <>
                {/* Le halo reste contenu dans la forme sans rogner la zone tactile. */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--at-rayon-pilule)]" aria-hidden="true">
                    <span className="absolute inset-0 h-full w-full transform scale-110 opacity-0 transition-opacity duration-[var(--at-duree-apparition)] ease-[var(--at-courbe-couleur)] group-hover:opacity-100 motion-reduce:transition-none"
                        style={{ filter: "url(#liquid-glass-filter)" }}>
                        <span className="absolute inset-0 bg-gradient-to-r from-[var(--at-accent)] via-[color-mix(in_srgb,var(--at-accent)_50%,transparent)] to-transparent mix-blend-overlay"></span>
                    </span>
                </span>

                {/* Bordure lumineuse au survol. */}
                <span className="pointer-events-none absolute inset-0 rounded-[var(--at-rayon-pilule)] border border-transparent transition-colors duration-[var(--at-duree-couleur)] group-hover:border-[color-mix(in_srgb,var(--at-accent)_50%,transparent)] motion-reduce:transition-none" aria-hidden="true"></span>

                {/* Contenu */}
                <span className="relative z-10 flex h-full w-full items-center justify-center gap-2">
                    {child ? child.props.children : children}
                </span>
            </>
        )

        return (
            <Comp
                className={cn(liquidbuttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            >
                {child ? React.cloneElement(child, undefined, content) : content}
            </Comp>
        )
    }
)
LiquidButton.displayName = "LiquidButton"

export { LiquidButton, liquidbuttonVariants }
