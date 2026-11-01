import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCockpitData } from '../data'
import EmailsTab from '../EmailsTab'

export default async function OperatorEmailsPage() {
  const data = await getCockpitData()
  if (!data) notFound()

  return (
    <main className="cockpit-shell">
      <header className="cockpit-header">
        <div>
          <p className="cockpit-kicker">Pilotage Orsayn</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-primary">Emails clients</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-secondary">
            Consulte les alertes et l’historique, ou prépare un message pour un client.
          </p>
        </div>
        <Link href="/orsayn" className="cockpit-button cockpit-button-outline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Vue d’ensemble
        </Link>
      </header>
      <EmailsTab pendingAlerts={data.pendingAlerts} sentEmails={data.sentEmails} clients={data.emailClients} />
    </main>
  )
}
