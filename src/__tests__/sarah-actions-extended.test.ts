import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

function switchCaseBody(src: string, caseName: string) {
  const start = src.indexOf(`case '${caseName}':`)
  expect(start, `case '${caseName}' should exist in executeProposalSideEffect`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf(`\n    case '`, start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

// Les nouvelles actions de Sarah (clients, chantiers, facturation) doivent
// toutes passer par des mutations protégées par permission, être déclarées
// dans le prompt système, et rediriger vers la bonne page après exécution.
describe('Sarah extended actions', () => {
  const actions = source('src/lib/sarah/actions.ts')
  const route = source('src/app/api/ai/sarah-secretary/route.ts')

  const expectations: Array<{ type: string; mutation: RegExp; deepLink: RegExp }> = [
    { type: 'client_create', mutation: /createClientInline\(/, deepLink: /\/clients\/\$\{result\.id\}/ },
    { type: 'chantier_create', mutation: /createChantier\(/, deepLink: /\/chantiers\/\$\{result\.chantierId\}/ },
    { type: 'task_create', mutation: /createTache\(/, deepLink: /\/chantiers\/\$\{chantierId\}/ },
    { type: 'chantier_note_add', mutation: /createChantierNote\(/, deepLink: /\/chantiers\/\$\{chantierId\}/ },
    { type: 'expense_record', mutation: /createChantierExpense\(/, deepLink: /\/chantiers\/\$\{chantierId\}/ },
    { type: 'invoice_mark_paid', mutation: /markInvoicePaid\(/, deepLink: /\/finances/ },
    { type: 'invoice_send', mutation: /sendInvoice\(/, deepLink: /\/finances/ },
    { type: 'quote_send', mutation: /sendQuote\(/, deepLink: /\/finances/ },
    { type: 'quote_mark_accepted', mutation: /markQuoteAccepted\(/, deepLink: /\/finances/ },
    { type: 'quote_mark_refused', mutation: /markQuoteRefused\(/, deepLink: /\/finances/ },
    { type: 'quote_followup', mutation: /sendQuoteFollowup\(/, deepLink: /\/reminders/ },
  ]

  it.each(expectations)('handles $type via a permission-gated mutation with a precise deep link', ({ type, mutation, deepLink }) => {
    const body = switchCaseBody(actions, type)
    expect(body).toMatch(mutation)
    expect(body).toMatch(deepLink)
  })

  it('declares every extended action type in the system prompt', () => {
    for (const { type } of expectations) {
      expect(route, `system prompt should document "${type}"`).toContain(`"${type}"`)
    }
  })

  it('gates quote_mark_refused and quote_followup with explicit permission checks', () => {
    expect(switchCaseBody(actions, 'quote_mark_refused')).toContain("hasPermission('quotes.edit')")
    expect(switchCaseBody(actions, 'quote_followup')).toMatch(/reminders\.send_manual|quotes\.send/)
  })

  it('accepts chat attachments only for whitelisted mime types with a size cap', () => {
    expect(route).toContain('sanitizeSarahAttachment')
    expect(route).toContain("'application/pdf'")
    expect(route).toContain('SARAH_ATTACHMENT_MAX_DATAURL')
    // Le data URL doit être préfixé par le mime déclaré, sinon rejet.
    expect(route).toContain('data:${mimeType};base64,')
  })

  it('keeps outbound sends (quote/invoice/followup) marked as explicit-demand actions in the prompt', () => {
    expect(route).toMatch(/"invoice_send"[^\n]*Uniquement si l'utilisateur le demande explicitement/)
    expect(route).toMatch(/"quote_send"[^\n]*Uniquement si l'utilisateur le demande explicitement/)
  })
})
