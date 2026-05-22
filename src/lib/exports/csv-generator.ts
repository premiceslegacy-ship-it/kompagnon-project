import { round2 } from './vat-rules'

export type CsvInvoice = {
  number: string
  issue_date: string | null
  invoice_type: string
  client_name: string | null
  client_siret: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  paid_at: string | null
  status: string
  chantier_title: string | null
  tva_sur_debits: boolean
  is_vat_subject: boolean
  has_auto_liquidation: boolean
  pa_message_id: string | null
  vat_breakdown: Array<{ rate: number; base_ht: number; vat_amount: number }>
}

type CsvRow = Record<string, string>

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  return dateStr.substring(0, 10)
}

function fmtNumber(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function invoiceTypeLabel(t: string): string {
  switch (t) {
    case 'acompte': return 'Acompte'
    case 'situation': return 'Situation de travaux'
    case 'solde': return 'Solde'
    case 'avoir': return 'Avoir'
    default: return 'Facture'
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'draft': return 'Brouillon'
    case 'sent': return 'Envoyée'
    case 'viewed': return 'Vue'
    case 'paid': return 'Payée'
    case 'partial': return 'Partiellement payée'
    case 'overdue': return 'En retard'
    case 'cancelled': return 'Annulée'
    case 'refunded': return 'Remboursée'
    default: return s
  }
}

export function generateCsv(invoices: CsvInvoice[], isVatSubject: boolean, includePayments = true): string {
  const VAT_RATES = [20, 10, 5.5]

  const headers: string[] = [
    'Numéro',
    'Date',
    'Type',
    'Client',
    'SIRET client',
    'Montant HT',
  ]

  if (isVatSubject) {
    for (const r of VAT_RATES) {
      headers.push(`Base ${r}%`)
    }
    for (const r of VAT_RATES) {
      headers.push(`TVA ${r}%`)
    }
    headers.push('Total TVA')
  }

  headers.push(
    'Montant TTC',
    'Montant encaissé',
    'Reste dû',
    'Statut',
    'Date paiement',
    'Mode TVA',
    'Chantier',
  )

  if (isVatSubject) {
    headers.push('Auto-liquidation')
  }
  headers.push('Référence Peppol')

  const rows: CsvRow[] = invoices.map(inv => {
    const restedu = round2(inv.total_ttc - inv.total_paid)

    const row: CsvRow = {
      'Numéro': inv.number,
      'Date': fmtDate(inv.issue_date),
      'Type': invoiceTypeLabel(inv.invoice_type),
      'Client': inv.client_name ?? '',
      'SIRET client': inv.client_siret ?? '',
      'Montant HT': fmtNumber(inv.total_ht),
    }

    if (isVatSubject) {
      for (const r of VAT_RATES) {
        const vb = inv.vat_breakdown.find(v => v.rate === r)
        row[`Base ${r}%`] = vb ? fmtNumber(vb.base_ht) : ''
      }
      for (const r of VAT_RATES) {
        const vb = inv.vat_breakdown.find(v => v.rate === r)
        row[`TVA ${r}%`] = vb ? fmtNumber(vb.vat_amount) : ''
      }
      row['Total TVA'] = fmtNumber(inv.total_tva)
    }

    row['Montant TTC'] = fmtNumber(inv.total_ttc)
    row['Montant encaissé'] = includePayments ? fmtNumber(inv.total_paid) : ''
    row['Reste dû'] = includePayments ? fmtNumber(restedu < 0 ? 0 : restedu) : ''
    row['Statut'] = statusLabel(inv.status)
    row['Date paiement'] = includePayments ? fmtDate(inv.paid_at) : ''
    row['Mode TVA'] = inv.is_vat_subject
      ? (inv.tva_sur_debits ? 'Débits' : 'Encaissements')
      : 'Franchise art. 293 B CGI'
    row['Chantier'] = inv.chantier_title ?? ''

    if (isVatSubject) {
      row['Auto-liquidation'] = inv.has_auto_liquidation ? 'Oui' : ''
    }
    row['Référence Peppol'] = inv.pa_message_id ?? ''

    return row
  })

  const escapeCell = (v: string): string => {
    if (v.includes(';') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }

  const headerLine = headers.map(escapeCell).join(';')
  const dataLines = rows.map(row =>
    headers.map(h => escapeCell(row[h] ?? '')).join(';'),
  )

  const footerParts: string[] = []
  if (!isVatSubject) {
    footerParts.push('TVA non applicable, art. 293 B CGI')
  }
  footerParts.push('Conservez ce fichier 6 ans minimum (art. L. 102 B LPF).')

  const lines = [headerLine, ...dataLines, '', footerParts.join(' — ')]
  // UTF-8 avec BOM pour ouverture Excel correcte
  return '﻿' + lines.join('\r\n')
}

export function buildCsvFilename(
  siren: string,
  from: string,
  to: string,
): string {
  const fromMm = from.substring(0, 7)
  const toMm = to.substring(0, 7)
  return `${siren}_${fromMm}_${toMm}_factures.csv`
}
