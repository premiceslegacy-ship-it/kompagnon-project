'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type ActionResult = { type: 'success' | 'error'; message: string } | null

type Props = {
  action: (formData: FormData) => Promise<void>
  className?: string
  feedbackClassName?: string
  children: React.ReactNode
  successMessage?: string
  successHref?: string
}

/**
 * Wrapper autour d'un <form action={serverAction}> qui affiche explicitement
 * le résultat (succès/erreur) — un <form action={fn}> natif ne donne aucun
 * retour visuel si fn ne throw pas (ex: échec réseau/HMAC avalé et stocké en
 * base plutôt que relancé), laissant l'utilisateur sans savoir si le clic a
 * réellement fonctionné. Même pattern useTransition que EmailsTab.tsx.
 */
export default function ActionForm({ action, className, feedbackClassName, children, successMessage = 'Enregistré.', successHref }: Props) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setResult(null)
    const fd = new FormData(formRef.current!)
    startTransition(async () => {
      try {
        await action(fd)
        setResult({ type: 'success', message: successMessage })
        if (successHref) router.replace(successHref)
      } catch (err) {
        setResult({ type: 'error', message: err instanceof Error ? err.message : 'Erreur inattendue' })
      } finally {
        router.refresh()
      }
    })
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={className}>
      <fieldset disabled={isPending} className="contents">
        {children}
      </fieldset>
      <div aria-live="polite" className={feedbackClassName}>
        {isPending && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-secondary">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Envoi en cours…
          </p>
        )}
        {!isPending && result?.type === 'success' && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-green-600">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {result.message}
          </p>
        )}
        {!isPending && result?.type === 'error' && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600">
            <AlertCircle className="w-3.5 h-3.5" />
            {result.message}
          </p>
        )}
      </div>
    </form>
  )
}
