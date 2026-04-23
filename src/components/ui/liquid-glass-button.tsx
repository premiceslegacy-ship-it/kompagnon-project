"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const liquidbuttonVariants = cva(
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-bold transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 overflow-hidden group cursor-pointer",
    {
        variants: {
            variant: {
                // Default: surface panel button - light mode opaque, dark mode glass
                default: "bg-surface text-primary border border-[var(--elevation-border)] shadow-kompagnon hover:shadow-glow-accent hover:scale-[1.02] active:scale-95 dark:bg-white/5 dark:text-white dark:backdrop-blur-sm",
                // Accent: amber filled CTA button - accessible in both modes
                accent: "bg-accent text-black hover:brightness-110 hover:scale-[1.02] active:scale-95 shadow-glow-accent font-extrabold",
                // Glass: translucent glass pill for secondary actions in dark environments
                glass: "bg-white/10 backdrop-blur-sm text-primary border border-[var(--elevation-border)] hover:bg-white/15 hover:scale-[1.02] active:scale-95",
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

        return (
            <Comp
                className={cn(liquidbuttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            >
                {/* The "Liquid" morphing background uses the globally injected filter */}
                <span className="absolute inset-0 w-full h-full transform scale-110 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-in-out pointer-events-none"
                    style={{ filter: "url(#liquid-glass-filter)" }}>
                    <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent/50 to-transparent dark:from-accent dark:via-accent/20 dark:to-transparent mix-blend-overlay"></span>
                </span>

                {/* Border glow on hover */}
                <span className="absolute inset-0 w-full h-full border border-accent/0 group-hover:border-accent/50 rounded-pill transition-all duration-500 pointer-events-none"></span>

                {/* Content */}
                <span className="relative z-10 flex items-center justify-center gap-2 w-full h-full">
                    {children}
                </span>
            </Comp>
        )
    }
)
LiquidButton.displayName = "LiquidButton"

export { LiquidButton, liquidbuttonVariants }
