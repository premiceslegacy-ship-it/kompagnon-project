import type { ReactNode } from 'react'
import { BrandWordmark } from '@/components/brand/BrandMonogram'
import { LegalFooter } from './LegalFooter'

type Props = {
  eyebrow: string
  title: string
  description: string
  updatedAt: string
  children: ReactNode
}

export function LegalPageShell({ eyebrow, title, description, updatedAt, children }: Props) {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 md:px-10 lg:px-12">
        <div className="mb-10 flex justify-center">
          <a href="/login" className="inline-flex">
            <BrandWordmark background="light" className="h-8 w-auto object-contain dark:hidden" />
            <BrandWordmark background="dark" className="hidden h-8 w-auto object-contain dark:block" />
          </a>
        </div>

        <div className="rounded-[2rem] border border-black/5 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-xl dark:shadow-none">
          <div className="border-b border-black/5 dark:border-white/10 px-6 py-8 md:px-10">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500 dark:text-zinc-400">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-black dark:text-white md:text-5xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 !text-slate-900 dark:!text-zinc-300 md:text-base font-medium" style={{ opacity: 1, visibility: 'visible' }}>{description}</p>
            <p className="mt-4 text-xs font-medium uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">
              Mise à jour : {updatedAt}
            </p>
          </div>

          <div className="space-y-10 px-6 py-8 md:px-10 md:py-10">{children}</div>
        </div>

        <LegalFooter className="mt-8 pb-2" />
      </div>
    </main>
  )
}
