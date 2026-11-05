'use client'
// @atelier-migrated

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import type { Client } from '@/lib/data/queries/clients'
import { convertToClient, convertToProspect, deleteClient } from '@/lib/data/mutations/clients'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import { markQuoteAccepted } from '@/lib/data/mutations/quotes'
import EmailComposerModal from '../EmailComposerModal'
import { EditClientSheet } from '../ClientSheets'
import { clientDisplayName, isLead } from '../clientsModel'
import screen from '@/components/layout/Screen.module.css'

type ClientActionsProps = {
  client: Client
  orgEmail: string | null
  orgName: string
  orgSignature: string | null
  hasAI: boolean
}

/** Menu de la fiche : modifier, écrire, convertir, archiver. */
export function ClientActions({ client, orgEmail, orgName, orgSignature, hasAI }: ClientActionsProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const name = clientDisplayName(client)

  const items: MenuItem[] = [
    { label: 'Modifier le contact', onSelect: () => setEditOpen(true) },
    ...(client.email ? [{ label: 'Envoyer un email', onSelect: () => setEmailOpen(true) }] : []),
    ...(isLead(client) ? [{
      label: 'Convertir en client',
      onSelect: () => startTransition(async () => {
        const { error: err } = await convertToClient(client.id)
        if (err) setError(err)
        else router.refresh()
      }),
    }] : []),
    { label: 'Archiver le contact', destructive: true, onSelect: () => setConfirmArchive(true) },
  ]

  return (
    <>
      <Menu
        title={name}
        items={items}
        trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
      />
      {error && <p className={screen.error} role="alert">{error}</p>}
      {editOpen && <EditClientSheet client={client} onClose={() => setEditOpen(false)} />}
      {emailOpen && (
        <EmailComposerModal
          isOpen={emailOpen}
          onClose={() => setEmailOpen(false)}
          allClients={[client]}
          orgEmail={orgEmail}
          orgName={orgName}
          orgSignature={orgSignature}
          hasAI={hasAI}
          preselectedClientId={client.id}
        />
      )}
      <AlertDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archiver « ${name} » ?`}
        description="Ce client sera archivé et n'apparaîtra plus dans la liste."
        confirmLabel="Archiver"
        onConfirm={() => {
          setConfirmArchive(false)
          startTransition(async () => {
            const { error: err } = await deleteClient(client.id)
            if (err) setError(err)
            else router.push('/clients')
          })
        }}
      />
    </>
  )
}

/** « Nouveau devis » : un lead passe en prospect dès qu'on lui prépare un devis. */
export function NewQuoteButton({ client, label = 'Nouveau devis' }: { client: Client; label?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="lg"
      loading={pending}
      onClick={() => startTransition(async () => {
        if (client.status === 'lead_hot' || client.status === 'lead_cold') await convertToProspect(client.id)
        router.push(`/finances/quote-editor?client=${client.id}&returnTo=${encodeURIComponent(`/clients/${client.id}`)}`)
      })}
    >
      {label}
    </Button>
  )
}

/** Action d'un document de l'historique : marquer payée ou acceptée. */
export function useDocumentAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const run = (type: 'quote' | 'invoice', id: string, onDone: () => void) => {
    startTransition(async () => {
      if (type === 'invoice') await markInvoicePaid(id)
      else await markQuoteAccepted(id)
      onDone()
      router.refresh()
    })
  }
  return { pending, run }
}
