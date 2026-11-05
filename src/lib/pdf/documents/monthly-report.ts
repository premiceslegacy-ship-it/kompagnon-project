import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawBarChart, drawHeroKpi, drawKpiGrid, drawLineTable, drawMeta, drawSectionTitle, flexWidth,
  setupChrome, type Kpi, type LineRow, type Tone,
} from '../engine/layout'
import { COLOR } from '../engine/theme'

export type ReportInvoice = {
  id: string
  number: string | null
  title: string | null
  status: string
  invoice_type: string
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  currency: string
  issue_date: string | null
  due_date: string | null
  paid_at: string | null
  created_at: string
  client_name: string | null
  items_cost_total: number
  payments: Array<{
    id: string
    amount: number
    payment_date: string | null
  }>
}

export type ReportQuote = {
  id: string
  number: string | null
  title: string | null
  status: string
  total_ht: number
  currency: string
  created_at: string
  client_name: string | null
}

export type MonthlyReportData = {
  month: string
  organization: Pick<PdfOrganizationData, 'name' | 'logo_url' | 'siret' | 'email'>
  invoices: ReportInvoice[]
  quotes: ReportQuote[]
  /** Date d'édition (défaut : maintenant). */
  editedAt?: string | null
}

const ISSUED_INVOICE_STATUS: Record<string, true> = { sent: true, viewed: true, partial: true, paid: true, overdue: true }
const WAITING_INVOICE_STATUS: Record<string, true> = { sent: true, viewed: true, partial: true, overdue: true }
const UNPAID_INVOICE_STATUS: Record<string, true> = { sent: true, viewed: true, overdue: true }

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FR[m - 1]} ${y}`
}

function fmt(amount: number, currency = 'EUR'): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount))
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return pdfText(new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }))
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', viewed: 'Vue', partial: 'Partielle', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée', refunded: 'Remboursée',
}
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', viewed: 'Consulté',
  accepted: 'Accepté', refused: 'Refusé', expired: 'Expiré', converted: 'Converti',
  fully_invoiced: 'Facturé',
}

export async function renderMonthlyReportPdf(data: MonthlyReportData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderMonthlyReportPdfWithFonts(data, fontBytes)
}

export async function renderMonthlyReportPdfWithFonts(data: MonthlyReportData, fontBytes: FontBytes): Promise<Buffer> {
  const { organization, invoices, quotes, month } = data
  const doc = await PdfDoc.create(fontBytes)

  const currency = invoices[0]?.currency ?? quotes[0]?.currency ?? 'EUR'

  const invoicesIssuedInMonth = invoices.filter(inv => inv.issue_date?.startsWith(month))
  const sentPaid = invoicesIssuedInMonth.filter(inv => Object.hasOwn(ISSUED_INVOICE_STATUS, inv.status))
  const caHt = sentPaid.reduce((s, inv) => s + inv.total_ht, 0)
  const paidTtcTotal = (inv: ReportInvoice) => inv.status === 'paid' ? inv.total_ttc : inv.status === 'partial' ? inv.total_paid : 0
  const paidTtcInMonth = (inv: ReportInvoice) => {
    const fromPayments = inv.payments.reduce((sum, payment) => payment.payment_date?.startsWith(month) ? sum + payment.amount : sum, 0)
    if (fromPayments > 0) return fromPayments
    if (inv.status === 'paid' && inv.paid_at?.startsWith(month)) return inv.total_ttc
    return 0
  }
  const htFromTtc = (inv: ReportInvoice, amountTtc: number) =>
    inv.total_ttc > 0 ? Math.min(inv.total_ht, inv.total_ht * (amountTtc / inv.total_ttc)) : 0
  const tvaFromTtc = (inv: ReportInvoice, amountTtc: number) =>
    inv.total_ttc > 0 ? Math.min(inv.total_tva, inv.total_tva * (amountTtc / inv.total_ttc)) : 0
  const remainingHt = (inv: ReportInvoice) => Object.hasOwn(UNPAID_INVOICE_STATUS, inv.status) ? inv.total_ht : inv.status === 'partial' ? Math.max(0, inv.total_ht - htFromTtc(inv, paidTtcTotal(inv))) : 0
  let encaisseHt = 0
  let encaisseTtc = 0
  let tvaTotale = 0
  for (const invoice of invoices) {
    const paidInMonth = paidTtcInMonth(invoice)
    encaisseHt += htFromTtc(invoice, paidInMonth)
    encaisseTtc += paidInMonth
    tvaTotale += tvaFromTtc(invoice, paidInMonth)
  }
  const resteHt = invoicesIssuedInMonth.reduce((s, inv) => s + remainingHt(inv), 0)
  const totalInternalCost = invoicesIssuedInMonth.reduce((s, inv) => s + inv.items_cost_total, 0)
  const margeHt = caHt - totalInternalCost
  const margePct = caHt > 0 ? Math.round((margeHt / caHt) * 100) : 0
  const hasMargin = totalInternalCost > 0


  const qEmis = quotes.length
  const qAccepted = quotes.filter(q => q.status === 'accepted').length
  const qAcceptedHt = quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total_ht, 0)
  const qConvRate = qEmis > 0 ? Math.round((qAccepted / qEmis) * 100) : 0

  const sentPaidCount = sentPaid.length
  const sentCount = invoicesIssuedInMonth.reduce((count, invoice) => count + Number(Object.hasOwn(WAITING_INVOICE_STATUS, invoice.status)), 0)

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  // ── Encaissé par semaine (jours 1-7, 8-14, 15-21, 22-28, 29 et suivants) ──
  const weeks = [0, 0, 0, 0, 0]
  const weekOf = (date: string) => Math.min(4, Math.floor((Number(date.slice(8, 10)) - 1) / 7))
  for (const invoice of invoices) {
    const inMonth = invoice.payments.filter(p => p.payment_date?.startsWith(month))
    if (inMonth.length) {
      for (const p of inMonth) weeks[weekOf(p.payment_date!)] += htFromTtc(invoice, p.amount)
    } else if (invoice.status === 'paid' && invoice.paid_at?.startsWith(month)) {
      weeks[weekOf(invoice.paid_at)] += htFromTtc(invoice, invoice.total_ttc)
    }
  }
  const [year, monthNum] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  const weekCount = daysInMonth > 28 ? 5 : 4

  setupChrome(doc, {
    title: 'Rapport mensuel',
    reference: fmtMonth(month),
    logo: logoImg,
    orgName: organization.name,
    footerLines: [[organization.name, organization.siret ? `SIRET ${organization.siret}` : null, organization.email].filter(Boolean).join(' · ')].map(l => pdfText(l)),
  })
  doc.addPage()

  drawMeta(doc, [
    { label: 'Période', value: `1 au ${daysInMonth} ${MONTHS_FR[monthNum - 1].toLowerCase()} ${year}` },
    { label: 'Édité le', value: fmtDate(data.editedAt ?? new Date().toISOString()) },
    { label: 'Société', value: pdfText(organization.name) },
  ])

  // ── Synthèse ──
  drawHeroKpi(doc, { label: 'Encaissé HT', value: fmt(encaisseHt, currency), note: `TTC : ${fmt(encaisseTtc, currency)}`, noteColor: COLOR.ink3 })
  const kpis: Kpi[] = [
    { label: 'Devis émis', value: String(qEmis) },
    { label: 'Devis acceptés', value: String(qAccepted), note: `${fmt(qAcceptedHt, currency)} HT` },
    { label: 'Taux de conversion', value: `${qConvRate} %` },
    { label: 'Montant facturé HT', value: fmt(caHt, currency), note: `${sentPaidCount} facture${sentPaidCount > 1 ? 's' : ''}` },
    { label: 'Reste à recouvrer', value: fmt(resteHt, currency), note: `${sentCount} facture${sentCount > 1 ? 's' : ''} en attente` },
    { label: 'TVA collectée', value: fmt(tvaTotale, currency), note: `Calculée sur ${fmt(encaisseTtc, currency)} TTC encaissé` },
  ]
  if (hasMargin) kpis.push({ label: 'Bénéfice prévu', value: `${margePct} %`, note: `${fmt(margeHt, currency)} HT · coûts lignes` })
  drawKpiGrid(doc, kpis, { columns: kpis.length > 6 ? 4 : 3 })

  if (weeks.some(w => w > 0)) {
    const max = Math.max(...weeks.slice(0, weekCount))
    drawBarChart(doc, 'Encaissé HT par semaine', weeks.slice(0, weekCount).map((v, i) => ({
      label: `Sem. ${i + 1}`,
      value: v,
      highlight: v === max && v > 0,
      valueLabel: v > 0 ? fmt(Math.round(v), currency).replace(/,00\s/, ' ') : undefined,
    })), { height: 75 })
  }

  // ── Détail des factures ──
  if (invoices.length > 0) {
    drawSectionTitle(doc, 'Détail des factures')
    const fixed = [52.5, 52.5, 61.5, 52.5, 61.5, 63]
    const rows: LineRow[] = invoices.map(inv => ({
      cells: [
        inv.number ?? '-',
        pdfText(inv.client_name ?? '-'),
        fmtDate(inv.issue_date ?? inv.created_at),
        { text: fmt(inv.total_ht, inv.currency), bold: true },
        fmt(inv.total_tva, inv.currency),
        fmt(inv.total_ttc, inv.currency),
        { text: STATUS_LABELS[inv.status] ?? inv.status, pill: invoiceTone(inv.status) },
      ],
    }))
    drawLineTable(doc, [
      { header: 'N°', width: 52.5 },
      { header: 'Client', width: flexWidth(fixed) },
      { header: 'Date', width: 52.5, align: 'left' },
      { header: 'HT', width: 61.5 },
      { header: 'TVA', width: 52.5 },
      { header: 'TTC', width: 61.5 },
      { header: 'État', width: 63 },
    ], rows, { marginTop: 4.5, leftColumns: 2, tight: true })
  }

  // ── Détail des devis ──
  if (quotes.length > 0) {
    drawSectionTitle(doc, 'Détail des devis')
    const fixed = [52.5, 105, 52.5, 61.5, 63]
    const rows: LineRow[] = quotes.map(q => ({
      cells: [
        q.number ?? '-',
        pdfText(q.title ?? 'Sans titre'),
        pdfText(q.client_name ?? '-'),
        fmtDate(q.created_at),
        { text: fmt(q.total_ht, q.currency), bold: true },
        { text: QUOTE_STATUS_LABELS[q.status] ?? q.status, pill: quoteTone(q.status) },
      ],
    }))
    drawLineTable(doc, [
      { header: 'N°', width: 52.5 },
      { header: 'Titre', width: flexWidth(fixed) },
      { header: 'Client', width: 105 },
      { header: 'Date', width: 52.5, align: 'left' },
      { header: 'HT', width: 61.5 },
      { header: 'État', width: 63 },
    ], rows, { marginTop: 4.5, leftColumns: 3, tight: true })
  }

  return doc.save()
}

function invoiceTone(status: string): Tone {
  if (status === 'paid') return 'ok'
  if (status === 'overdue') return 'alert'
  if (status === 'sent' || status === 'viewed' || status === 'partial') return 'warn'
  return 'neutral'
}

function quoteTone(status: string): Tone {
  if (status === 'accepted' || status === 'converted' || status === 'fully_invoiced') return 'ok'
  if (status === 'refused' || status === 'expired') return 'alert'
  if (status === 'sent' || status === 'viewed') return 'warn'
  return 'neutral'
}
