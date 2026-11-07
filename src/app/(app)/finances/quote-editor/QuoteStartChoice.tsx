'use client'
// @atelier-migrated

import { Sheet } from '@/components/ui/Sheet'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { AI_NAME } from '@/lib/brand'

/**
 * Choix à la création d'un nouveau devis : soit l'artisan remplit lui-même,
 * soit il confie l'analyse d'un document ou d'une dictée à l'assistante.
 * Fermer la feuille revient à « Je fais le devis moi-même ».
 */
export function QuoteStartChoice({ onSelectManual, onSelectAI }: { onSelectManual: () => void; onSelectAI: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onSelectManual() }}
      title="Nouveau devis"
      description="Comment voulez-vous le préparer ?"
      cancelLabel="Fermer"
    >
      <ListGroup>
        <ListRow
          title="Je fais le devis moi-même"
          description="Ajoutez vos lignes, prix et conditions directement dans l'éditeur."
          onClick={onSelectManual}
        />
        <ListRow
          title={`Assisté par ${AI_NAME}`}
          description={`Décrivez le besoin à l'oral, collez un email ou importez un document : ${AI_NAME} prépare les lignes.`}
          onClick={onSelectAI}
        />
      </ListGroup>
    </Sheet>
  )
}
