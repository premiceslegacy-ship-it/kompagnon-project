// @atelier-migrated
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { getClientById } from '@/lib/data/queries/clients'
import { getClientQuotes } from '@/lib/data/queries/quotes'
import { getClientInvoices } from '@/lib/data/queries/invoices'
import { getOrganization } from '@/lib/data/queries/organization'
import { isModuleEnabled } from '@/lib/data/queries/organization-modules'
import { formatAddress, getMapsDirectionsUrl } from '@/lib/address'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { ClientActions, NewQuoteButton } from './ClientActions'
import { HistoriqueClient } from './HistoriqueClient'
import { clientDisplayName, followupState, statusPill } from '../clientsModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './Fiche.module.css'

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)

export default async function ClientProfilePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise
  const [client, quotes, invoices, org, hasAI] = await Promise.all([
    getClientById(params.id),
    getClientQuotes(params.id),
    getClientInvoices(params.id),
    getOrganization(),
    isModuleEnabled('relances_ai'),
  ])

  if (!client) notFound()

  const documents = [
    ...quotes.map(q => ({ type: 'quote' as const, id: q.id, number: q.number, title: q.title, status: q.status, total_ttc: q.total_ttc, created_at: q.created_at, signed_at: q.signed_at })),
    ...invoices.map(inv => ({ type: 'invoice' as const, id: inv.id, number: inv.number, title: inv.title, status: inv.status, total_ttc: inv.total_ttc, created_at: inv.created_at, signed_at: null })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Suivi : devis en attente de réponse, ou dernier échange (le plus récent document).
  const pendingQuotes = quotes.filter(q => q.status === 'sent' || q.status === 'viewed').length
  const lastActivity = documents[0]?.created_at ?? null
  const followup = followupState({ ...client, pending_quotes: pendingQuotes, last_activity_at: lastActivity })
  const pill = statusPill(client.status)
  const address = formatAddress({ address_line1: client.address_line1, postal_code: client.postal_code, city: client.city })
  const name = clientDisplayName(client)
  const since = new Date(client.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <Link href="/clients" className={styles.back}>
          <ChevronLeft size={20} aria-hidden="true" />
          Clients
        </Link>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{client.type === 'company' ? 'Professionnel' : 'Particulier'}</p>
            <h1 className={screen.title}>{name}</h1>
          </div>
          <div className={styles.headerEnd}>
            <StatusPill status={pill.status}>{pill.label}</StatusPill>
            <ClientActions
              client={client}
              orgEmail={org?.email ?? null}
              orgName={org?.name ?? ''}
              orgSignature={org?.email_signature ?? null}
              hasAI={hasAI}
            />
          </div>
        </header>

        <div className={screen.cols}>
          <div className={styles.stack}>
            {client.company_name && client.contact_name && (
              <p className={fiche.referent}>Contact référent : <b>{client.contact_name}</b></p>
            )}
            {followup.kind !== 'ok' && (
              <p className={fiche.followup} data-late={followup.kind === 'idle_lead' ? 'true' : 'false'}>{followup.label}</p>
            )}
            <div className={fiche.primary}><NewQuoteButton client={client} /></div>

            <ListGroup title="Coordonnées">
              {client.email && <ListRow title="Email" description={client.email} href={`mailto:${client.email}`} />}
              {client.phone && <ListRow title="Téléphone" description={client.phone} href={`tel:${client.phone}`} />}
              {address && <ListRow title="Adresse" description={address} href={getMapsDirectionsUrl(address)} target="_blank" rel="noopener noreferrer" />}
              {client.siret && <ListRow title="SIRET" description={client.siret} />}
              {!client.email && !client.phone && !address && !client.siret && <li><p className={styles.notice}>Aucune coordonnée renseignée.</p></li>}
            </ListGroup>

            <section className={fiche.card} aria-label="Chiffre d'affaires">
              <p className={fiche.label}>Chiffre d&apos;affaires</p>
              <p className={fiche.big}>{formatCurrency(client.total_revenue ?? 0)}</p>
              <p className={fiche.sub}>Client depuis {since} · paiement à {client.payment_terms_days ?? 30} jours</p>
            </section>

            {client.internal_notes && (
              <ListGroup title="Notes internes" description="Non transmises au client.">
                <li><p className={styles.requestText}>{client.internal_notes}</p></li>
              </ListGroup>
            )}
          </div>

          <div className={styles.stack}>
            {documents.length === 0 ? (
              <section className={screen.empty}>
                <b>Aucun document pour l&apos;instant</b>
                Les devis et factures associés à ce client apparaîtront ici automatiquement.
              </section>
            ) : (
              <HistoriqueClient initialDocuments={documents} />
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
