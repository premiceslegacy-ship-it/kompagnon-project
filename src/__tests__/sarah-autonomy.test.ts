// Non-régression de l'autonomie de Sarah (audit du 26/10/2026).
// Avant correctif, le `risk` déclaré par le modèle pilotait seul
// l'auto-exécution : un alias de type contournait le verrou, un `risk` absent
// valait « low », et un envoi d'email partait sans clic humain.

import { describe, expect, it } from 'vitest'
import { normalizeSarahActionType, resolveSarahActionRisk } from '@/lib/sarah/actions'

describe('resolveSarahActionRisk', () => {
  it('rétrograde en medium un type à effet externe déclaré low', () => {
    expect(resolveSarahActionRisk('draft_email', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('invoice_send', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('invoice_mark_paid', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('quote_send', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('pointage_reminder_prepare', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('catalog_item_create', 'low')).toBe('medium')
  })

  it('rétrograde aussi via un alias de type', () => {
    expect(normalizeSarahActionType('send_invoice')).toBe('invoice_send')
    expect(resolveSarahActionRisk('send_invoice', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('send_quote', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('mark_invoice_paid', 'low')).toBe('medium')
  })

  it('garde low sur les types purement locaux et réversibles', () => {
    expect(resolveSarahActionRisk('task_create', 'low')).toBe('low')
    expect(resolveSarahActionRisk('chantier_note_add', 'low')).toBe('low')
    expect(resolveSarahActionRisk('brief_nora', 'low')).toBe('low')
  })

  it('ne descend jamais un high ou medium déclaré', () => {
    expect(resolveSarahActionRisk('task_create', 'high')).toBe('high')
    expect(resolveSarahActionRisk('draft_email', 'high')).toBe('high')
  })

  it('traite un risk absent comme medium, jamais low', () => {
    expect(resolveSarahActionRisk('task_create', undefined)).toBe('medium')
    expect(resolveSarahActionRisk('task_create', 'n_importe_quoi')).toBe('medium')
    expect(resolveSarahActionRisk('draft_email', undefined)).toBe('medium')
  })

  it('refuse la création de fiche en auto, même en low', () => {
    expect(resolveSarahActionRisk('client_create', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('member_create', 'low')).toBe('medium')
    expect(resolveSarahActionRisk('create_client', 'low')).toBe('medium')
  })
})
