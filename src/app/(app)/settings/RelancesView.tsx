'use client'
// @atelier-migrated
// Relances et emails : relances automatiques, rapport mensuel, expéditeur, signature, modèles d'email.

import { useState } from 'react'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import type { EmailTemplateSlug } from '@/lib/data/queries/emailTemplates'
import { ReminderDaySheet, SenderSheet, SignatureSheet, TemplateSheet, type ReminderTarget } from './RelancesSheets'
import { addReminderDay, hourLabel, MAX_REMINDERS, parisHint, reminderDayLabel, senderSummary } from './relancesModel'
import { useSavedDirty } from './useSavedDirty'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

function DaysGroup({ q, kind, title, description }: { q: SettingsState; kind: 'invoice' | 'quote'; title: string; description: string }) {
  const days = kind === 'invoice' ? q.autoReminder.invoiceDays : q.autoReminder.quoteDays
  const [target, setTarget] = useState<ReminderTarget | null>(null)
  const field = kind === 'invoice' ? 'invoiceDays' : 'quoteDays'
  return (
    <>
      <ListGroup title={title} description={description}>
        {days.map((day, index) => (
          <ListRow key={index} title={`Relance ${index + 1}`} description={`${reminderDayLabel(day)} après l’envoi`} onClick={() => setTarget({ kind, index })} />
        ))}
        {days.length < MAX_REMINDERS && (
          <ListRow title="Ajouter une relance" className={styles.accentRow}
            onClick={() => { q.setAutoReminder(a => ({ ...a, [field]: addReminderDay(a[field]) })); setTarget({ kind, index: days.length }) }} />
        )}
      </ListGroup>
      <ReminderDaySheet q={q} target={target} onClose={() => setTarget(null)} />
    </>
  )
}

export default function RelancesView({ q }: { q: SettingsState }) {
  const dirty = useSavedDirty(q.autoReminder, q.autoReminderSaveStatus)
  const saving = q.autoReminderSaveStatus === 'saving'
  const [sender, setSender] = useState(false)
  const [signature, setSignature] = useState(false)
  const [template, setTemplate] = useState<EmailTemplateSlug | null>(null)
  const enabled = q.autoReminder.enabled

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup title="Relances automatiques" description="Envoie les relances par email, sans intervention, à l’heure choisie.">
          <ListRow
            title="Relances automatiques"
            description={enabled ? 'Activées' : 'Désactivées'}
            trailing={<Switch label="Relances automatiques" checked={enabled} onChange={on => q.setAutoReminder(a => ({ ...a, enabled: on }))} />}
          />
        </ListGroup>

        {enabled && (
          <>
            <div>
              <div className={styles.fields}>
                <Field type="select" label="Heure d’envoi" value={String(q.autoReminder.reminderHour)} onChange={e => q.setAutoReminder(a => ({ ...a, reminderHour: parseInt(e.target.value, 10) }))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={String(h)}>{hourLabel(h)}</option>)}
                </Field>
              </div>
              <p className={styles.hint}>{parisHint(q.autoReminder.reminderHour)}</p>
            </div>
            <DaysGroup q={q} kind="invoice" title="Factures impayées" description="Jours après l’envoi de la facture. La première relance part au plus tôt à J+3." />
            <DaysGroup q={q} kind="quote" title="Devis sans réponse" description="Jours après l’envoi du devis." />
            <p className={styles.hint}>Les emails de relance sont rédigés automatiquement. Les clients sans adresse email sont ignorés. Marquez une facture comme payée dès réception du règlement pour bloquer les relances suivantes.</p>
          </>
        )}

        {q.canEditOrg && (
          <div>
            <ListGroup title="Rapport mensuel d’heures" description="Le 1er du mois, chaque intervenant ayant un email reçoit son rapport PDF des heures pointées le mois précédent. Les membres peuvent aussi le demander depuis leur espace personnel.">
              <ListRow
                title="Envoi automatique"
                description={q.autoMemberReportsSaveStatus === 'saved' ? 'Préférence enregistrée' : q.autoMemberReportsSaveStatus === 'saving' ? 'Enregistrement…' : q.autoMemberReports ? 'Activé' : 'Désactivé'}
                trailing={<Switch label="Rapport mensuel d’heures" checked={q.autoMemberReports} disabled={q.isPending || q.autoMemberReportsSaveStatus === 'saving'} onChange={q.handleSaveAutoMemberReports} />}
              />
            </ListGroup>
            {q.autoMemberReportsSaveStatus === 'error' && <p className={screen.error} role="alert">La préférence n’a pas pu être enregistrée.</p>}
          </div>
        )}

        <ListGroup title="Envoi des emails">
          <ListRow title="Expéditeur" description={senderSummary(q.emailSettings.from_name, q.emailSettings.from_address)} onClick={() => setSender(true)} />
          <ListRow title="Signature et CGV" description={q.emailSignature.trim() || q.cgvText.trim() ? 'Renseignées' : 'Non renseignées'} onClick={() => setSignature(true)} />
        </ListGroup>

        <ListGroup title="Modèles d’email" description="Sujet et corps de chaque email automatique. Les variables entre doubles accolades sont remplacées à l’envoi.">
          {q.emailTemplates.map(tpl => (
            <ListRow key={tpl.slug} title={tpl.name} trailing={tpl.is_custom ? <StatusPill status="success">Personnalisé</StatusPill> : undefined} onClick={() => setTemplate(tpl.slug)} />
          ))}
        </ListGroup>
      </div>

      {(dirty || saving) && (
        <Dock totalLabel="Relances" total="Modifié" actionLabel="Enregistrer" onAction={q.handleSaveAutoReminder} loading={saving} disabled={q.isPending} />
      )}
      {q.autoReminderSaveStatus === 'error' && <p className={screen.error} role="alert">Les réglages n’ont pas pu être enregistrés.</p>}

      <SenderSheet q={q} open={sender} onClose={() => setSender(false)} />
      <SignatureSheet q={q} open={signature} onClose={() => setSignature(false)} />
      <TemplateSheet q={q} slug={template} onClose={() => setTemplate(null)} />
    </div>
  )
}
