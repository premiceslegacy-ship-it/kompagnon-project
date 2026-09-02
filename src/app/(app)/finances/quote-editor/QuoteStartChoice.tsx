'use client'

import { ChevronRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { IconDevis, IconPropose } from '@/components/ui/icons'
import { AssistantAvatar } from '@/components/ai/AssistantAvatar'
import { AI_NAME } from '@/lib/brand'

/**
 * Écran de choix à la création d'un nouveau devis : soit l'artisan remplit
 * lui-même, soit il confie l'analyse d'un document/dictée à Chloé. Une fois
 * le choix fait, le bouton Chloé disparaît de l'éditeur (voir QuoteEditorClient).
 */
export function QuoteStartChoice({ onSelectManual, onSelectAI }: { onSelectManual: () => void; onSelectAI: () => void }) {
  return (
    <Modal open onClose={onSelectManual} title="Nouveau devis" subtitle="Comment voulez-vous le préparer ?" size="lg" dismissible={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={onSelectManual}
          className="card p-5 text-left hover:border-accent/50 hover:bg-accent/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <IconDevis className="w-10 h-10 mb-4" />
          <p className="text-sm font-bold text-primary">Je fais le devis moi-même</p>
          <p className="text-xs text-secondary mt-1">Ajoutez vos lignes, prix et conditions directement dans l'éditeur.</p>
          <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent">
            Commencer <ChevronRight className="w-4 h-4" />
          </span>
        </button>

        <button
          type="button"
          onClick={onSelectAI}
          className="card p-5 text-left hover:border-accent/50 hover:bg-accent/5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <IconPropose className="w-10 h-10 mb-4" />
          <p className="text-sm font-bold text-primary">Assisté par {AI_NAME}</p>
          <p className="text-xs text-secondary mt-1">Décrivez le besoin à l'oral, collez un email ou importez un document : {AI_NAME} prépare les lignes.</p>
          <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent">
            <AssistantAvatar assistant="chloe" size={16} /> Confier à {AI_NAME}
          </span>
        </button>
      </div>
    </Modal>
  )
}
