import RequestAccessForm from './RequestAccessForm'

export default function RequestAccessPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const errorLabel = searchParams.error === 'invalid_token'
    ? "Le lien est expiré ou invalide. Demandez-en un nouveau ci-dessous."
    : null

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-7 space-y-5">
        <div className="space-y-1">
          <p className="text-xs text-secondary uppercase tracking-wider font-semibold">Espace intervenant</p>
          <h1 className="text-2xl font-bold text-primary">Recevoir mon lien d&apos;accès</h1>
          <p className="text-sm text-secondary">
            Saisissez l&apos;adresse email que votre entreprise vous a enregistrée. Vous recevrez un lien d&apos;accès personnel valide 30 jours.
          </p>
        </div>
        {errorLabel && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            {errorLabel}
          </div>
        )}
        <RequestAccessForm />
      </div>
    </div>
  )
}
