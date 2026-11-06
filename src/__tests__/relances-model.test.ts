import { describe, expect, it } from 'vitest'
import { addReminderDay, clampFirstDelay, hourLabel, normalizeReminderDay, parisHint, removeReminderDay, senderSummary, setReminderDay } from '@/app/(app)/settings/relancesModel'
import { clearType, countOfType, isPublicItemSelected, selectAllOfType, selectionSummary, type PublicItemRef } from '@/app/(app)/settings/publicFormModel'
import { iframeSnippet, publicFormUrl, widgetSnippet } from '@/app/(app)/settings/integrationModel'

describe('relances : jours', () => {
  it('impose J+3 au moins pour la première relance de facture seulement', () => {
    expect(normalizeReminderDay(1, 0, true)).toBe(3)
    expect(normalizeReminderDay(1, 1, true)).toBe(1)
    expect(normalizeReminderDay(1, 0, false)).toBe(1)
    expect(normalizeReminderDay(null, 2, false)).toBe(1)
    expect(setReminderDay([3, 7], 0, 2, true)).toEqual([3, 7])
    expect(setReminderDay([3, 7], 1, 12, true)).toEqual([3, 12])
  })

  it('ajoute 7 jours après la dernière, jusqu’à 4 relances, et garde au moins une relance', () => {
    expect(addReminderDay([3, 7])).toEqual([3, 7, 14])
    expect(addReminderDay([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
    expect(removeReminderDay([3, 7], 0)).toEqual([7])
    expect(removeReminderDay([3], 0)).toEqual([3])
  })

  it('libelle l’heure d’envoi et son équivalent à Paris', () => {
    expect(hourLabel(8)).toBe('08h00 UTC')
    expect(parisHint(8)).toBe('Soit 09h à Paris l’hiver, 10h l’été.')
    expect(parisHint(23)).toBe('Soit 00h à Paris l’hiver, 01h l’été.')
  })

  it('borne le délai de première relance et résume l’expéditeur', () => {
    expect(clampFirstDelay(1)).toBe(3)
    expect(clampFirstDelay(null)).toBe(3)
    expect(clampFirstDelay(10)).toBe(10)
    expect(senderSummary('Dupont BTP', 'c@d.fr')).toBe('Dupont BTP · c@d.fr')
    expect(senderSummary('', '')).toBe('Non configuré')
  })
})

describe('formulaire public : sélection', () => {
  const refs: PublicItemRef[] = [{ id: 'm1', item_type: 'material' }, { id: 'p1', item_type: 'prestation' }]

  it('coche ou décoche un type sans toucher aux autres', () => {
    const all = selectAllOfType(refs, 'material', ['m1', 'm2', 'm3'])
    expect(countOfType(all, 'material')).toBe(3)
    expect(isPublicItemSelected(all, 'p1', 'prestation')).toBe(true)
    expect(clearType(all, 'prestation')).toHaveLength(3)
    expect(isPublicItemSelected(refs, 'm1', 'prestation')).toBe(false)
  })

  it('décrit la sélection', () => {
    expect(selectionSummary(0, 5)).toBe('Aucun sélectionné')
    expect(selectionSummary(2, 5)).toBe('2 sur 5')
  })
})

describe('intégration : extraits', () => {
  it('construit le lien et les extraits avec la bonne adresse', () => {
    const url = publicFormUrl('https://app.example.fr', 'dupont')
    expect(url).toBe('https://app.example.fr/demande/dupont')
    expect(iframeSnippet(url)).toContain(`src="${url}"`)
    expect(widgetSnippet(url)).toContain(`btn.href = '${url}'`)
    expect(widgetSnippet(url)).toContain('</script>')
  })
})
