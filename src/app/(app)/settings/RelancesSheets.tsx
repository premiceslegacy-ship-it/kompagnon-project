'use client'
// @atelier-migrated
// Relances et emails : feuilles de l'expéditeur, de la signature et des CGV, d'un modèle d'email, d'un jour de relance.

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import type { EmailTemplateSlug } from '@/lib/data/queries/emailTemplates'
import { clampFirstDelay, normalizeReminderDay, removeReminderDay, setReminderDay } from './relancesModel'
import { useCloseOnSaved } from './useCloseOnSaved'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export type ReminderTarget = { kind: 'invoice' | 'quote'; index: number }

/** Un jour de relance : saisie immédiate dans le brouillon, enregistré par la barre de l'écran. */
export function ReminderDaySheet({ q, target, onClose }: { q: SettingsState; target: ReminderTarget | null; onClose: () => void }) {
  const isInvoice = target?.kind === 'invoice'
  const days = target ? (isInvoice ? q.autoReminder.invoiceDays : q.autoReminder.quoteDays) : []
  const field = isInvoice ? 'invoiceDays' : 'quoteDays'
  const update = (next: number[]) => q.setAutoReminder(a => ({ ...a, [field]: next }))
  const index = target?.index ?? 0
  return (
    <Sheet open={target !== null} onOpenChange={o => { if (!o) onClose() }} title={`Relance ${index + 1}`} cancelLabel="Fermer">
      {target && (
        <div className={local.sheetBody}>
          <div>
            <div className={styles.fields}>
              <Field type="number" label="Jours après l’envoi" min={1} max={365} decimals={0} allowEmpty={false}
                value={days[index] ?? null} onChange={n => update(setReminderDay(days, index, n, isInvoice))} />
            </div>
            <p className={styles.hint}>
              {isInvoice && index === 0 ? 'La première relance de facture part au plus tôt à J+3.' : `La relance part ${normalizeReminderDay(days[index], index, isInvoice)} jours après l’envoi.`}
            </p>
          </div>
          {days.length > 1 && (
            <ListGroup>
              <li className={styles.destructiveRow}><button type="button" onClick={() => { update(removeReminderDay(days, index)); onClose() }}>Supprimer cette relance</button></li>
            </ListGroup>
          )}
        </div>
      )}
    </Sheet>
  )
}

export function SenderSheet({ q, open, onClose }: { q: SettingsState; open: boolean; onClose: () => void }) {
  useCloseOnSaved(q.emailSaveStatus, open, onClose)
  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) onClose() }}
      title="Expéditeur"
      onConfirm={q.handleSaveEmailSettings}
      confirmLabel="Enregistrer"
      confirmLoading={q.emailSaveStatus === 'saving'}
    >
      <div className={local.sheetBody}>
        <div>
          <div className={styles.fields}>
            <Field type="text" label="Nom affiché" placeholder="Dupont BTP" value={q.emailSettings.from_name} onChange={e => q.setEmailSettings({ ...q.emailSettings, from_name: e.target.value })} />
            <Field type="text" inputType="email" label="Adresse" placeholder="contact@dupont-btp.fr" disabled={q.selfService} value={q.emailSettings.from_address} onChange={e => q.setEmailSettings({ ...q.emailSettings, from_address: e.target.value })} />
          </div>
          <p className={styles.hint}>
            {q.selfService ? 'Adresse gérée par Atelier BTP, en lecture seule.' : 'L’adresse doit être vérifiée sur votre compte Resend.'} Utilisée pour les invitations et les emails métier (devis, factures, relances). La réponse d’un client arrive toujours à votre « Email de contact » (Entreprise), jamais à ce domaine d’envoi.
          </p>
        </div>
        {q.emailSaveStatus === 'error' && <p className={screen.error} role="alert">Les réglages n’ont pas pu être enregistrés.</p>}
      </div>
    </Sheet>
  )
}

export function SignatureSheet({ q, open, onClose }: { q: SettingsState; open: boolean; onClose: () => void }) {
  useCloseOnSaved(q.signatureSaveStatus, open, onClose)
  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) onClose() }}
      title="Signature et CGV"
      onConfirm={q.handleSaveSignatureAndCGV}
      confirmLabel="Enregistrer"
      confirmLoading={q.signatureSaveStatus === 'saving'}
    >
      <div className={local.sheetBody}>
        <Field type="textarea" rows={4} label="Signature des emails" placeholder={'Cordialement,\nDupont BTP\n+33 6 12 34 56 78'}
          hint="Texte brut ajouté après le corps de chaque email."
          value={q.emailSignature} onChange={e => q.setEmailSignature(e.target.value)} />
        <Field type="textarea" rows={6} label="Conditions générales de vente" placeholder={'Article 1 - Objet\nLes présentes conditions…'}
          hint="Imprimées au verso des devis et factures (texte brut, 3 000 caractères au plus)."
          value={q.cgvText} onChange={e => q.setCgvText(e.target.value)} />
        <div>
          <div className={styles.fields}>
            <Field type="number" label="Première relance (jours)" min={3} max={90} decimals={0} allowEmpty={false}
              value={q.reminderFirstDelay} onChange={n => q.setReminderFirstDelay(clampFirstDelay(n))} />
          </div>
          <p className={styles.hint}>Jours après l’envoi avant la première relance de facture. Trois jours au minimum.</p>
        </div>
        {q.signatureSaveStatus === 'error' && <p className={screen.error} role="alert">Les réglages n’ont pas pu être enregistrés.</p>}
      </div>
    </Sheet>
  )
}

export function TemplateSheet({ q, slug, onClose }: { q: SettingsState; slug: EmailTemplateSlug | null; onClose: () => void }) {
  const tpl = slug ? q.emailTemplates.find(t => t.slug === slug) : null
  const draft = slug ? q.tplDraft[slug] : null
  const saveStatus = slug ? q.tplSaveStatus[slug] : 'idle'
  useCloseOnSaved(saveStatus, slug !== null, onClose)
  const set = (patch: Partial<{ subject: string; body_text: string }>) => slug && q.setTplDraft(d => ({ ...d, [slug]: { ...d[slug], ...patch } }))
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <>
      <Sheet
        open={slug !== null}
        onOpenChange={o => { if (!o) onClose() }}
        title={tpl?.name ?? 'Modèle'}
        onConfirm={() => slug && q.handleSaveEmailTemplate(slug)}
        confirmLabel="Enregistrer"
        confirmLoading={saveStatus === 'saving'}
      >
        {tpl && draft && slug && (
          <div className={local.sheetBody}>
            <div className={styles.fields}>
              <Field type="text" label="Sujet" value={draft.subject} onChange={e => set({ subject: e.target.value })} />
            </div>
            <Field type="textarea" rows={8} label="Corps" hint={`Variables remplacées à l’envoi : ${tpl.variables.join(' · ')}`} value={draft.body_text} onChange={e => set({ body_text: e.target.value })} />
            {saveStatus === 'error' && <p className={screen.error} role="alert">Le modèle n’a pas pu être enregistré.</p>}
            {tpl.is_custom && (
              <ListGroup>
                <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmReset(true)}>Revenir au modèle d’origine</button></li>
              </ListGroup>
            )}
          </div>
        )}
      </Sheet>
      <AlertDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Revenir au modèle d’origine ?"
        description="Votre texte personnalisé sera remplacé par le modèle fourni."
        confirmLabel="Rétablir"
        confirmLoading={slug ? q.tplResetStatus[slug] === 'pending' : false}
        onConfirm={() => { if (slug) { q.handleResetEmailTemplate(slug); setConfirmReset(false); onClose() } }}
      />
    </>
  )
}
