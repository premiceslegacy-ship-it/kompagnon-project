import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCompactHeader, drawHeader, drawKitTable, drawKpiHero, drawKpiTiles, drawMeta, drawSectionHeading, installFooter,
  type KitColumn, type KitRow,
} from '../engine/kit'
import { CONTENT_WIDTH } from '../engine/theme'

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
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: 'Rapport mensuel', number: fmtMonth(month) }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, [[organization.name, organization.siret ? `SIRET ${organization.siret}` : null, organization.email].filter(Boolean).join(' · ')].map(pdfText))
  doc.addPage()

  drawMeta(doc, [
    { label: 'Période', value: fmtMonth(month) },
    { label: 'Édité le', value: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) },
    { label: 'Société', value: organization.name },
  ])

  // ── Chiffres clés ──
  drawKpiHero(doc, 'Encaissé HT', fmt(encaisseHt, currency), `TTC : ${fmt(encaisseTtc, currency)}`)
  drawKpiTiles(doc, [
    { label: 'Montant facturé HT', value: fmt(caHt, currency), note: `${sentPaidCount} facture${sentPaidCount > 1 ? 's' : ''}` },
    { label: 'Reste à recouvrer', value: fmt(resteHt, currency), note: `${sentCount} facture${sentCount > 1 ? 's' : ''} en attente` },
    { label: 'TVA collectée', value: fmt(tvaTotale, currency), note: 'sur le TTC encaissé' },
    { label: 'Devis émis', value: String(qEmis) },
    { label: 'Devis acceptés', value: String(qAccepted), note: `${fmt(qAcceptedHt, currency)} HT` },
    { label: 'Taux de conversion', value: `${qConvRate} %` },
    ...(hasMargin ? [{ label: 'Bénéfice prévu', value: `${margePct} %`, note: `${fmt(margeHt, currency)} HT · coûts lignes` }] : []),
  ])

  // ── Factures ──
  if (invoices.length > 0) {
    drawSectionHeading(doc, 'Détail des factures', 18)
    const gap = 7.5
    const fixed = 68 + 54 + 56 + 46 + 56 + 58
    const cols: KitColumn[] = [
      { width: 68, header: 'N°' },
      { width: CONTENT_WIDTH - fixed - gap * 6, header: 'Client' },
      { width: 54, header: 'Date' },
      { width: 56, header: 'HT' },
      { width: 46, header: 'TVA' },
      { width: 56, header: 'TTC' },
      { width: 58, header: 'Statut', align: 'right' },
    ]
    const rows: KitRow[] = invoices.map(inv => ({
      cells: [
        { value: inv.number ?? '—' },
        { value: pdfText(inv.client_name ?? '—') },
        { value: fmtDate(inv.issue_date ?? inv.created_at) },
        { value: fmt(inv.total_ht, inv.currency), bold: true },
        { value: fmt(inv.total_tva, inv.currency) },
        { value: fmt(inv.total_ttc, inv.currency) },
        { value: STATUS_LABELS[inv.status] ?? inv.status, pill: inv.status === 'paid' ? 'green' : inv.status === 'overdue' ? 'red' : inv.status === 'draft' || inv.status === 'cancelled' ? 'neutral' : 'amber' },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, textColumns: 2, gapTop: 4 })
  }

  // ── Devis ──
  if (quotes.length > 0) {
    drawSectionHeading(doc, 'Détail des devis', 18)
    const gap = 7.5
    const fixed = 68 + 54 + 62 + 56
    const remaining = CONTENT_WIDTH - fixed - gap * 5
    const cols: KitColumn[] = [
      { width: 68, header: 'N°' },
      { width: remaining * 0.56, header: 'Titre' },
      { width: remaining * 0.44, header: 'Client' },
      { width: 54, header: 'Date' },
      { width: 62, header: 'HT' },
      { width: 56, header: 'Statut', align: 'right' },
    ]
    const rows: KitRow[] = quotes.map(q => ({
      cells: [
        { value: q.number ?? '—' },
        { value: pdfText(q.title ?? 'Sans titre') },
        { value: pdfText(q.client_name ?? '—') },
        { value: fmtDate(q.created_at) },
        { value: fmt(q.total_ht, q.currency), bold: true },
        { value: QUOTE_STATUS_LABELS[q.status] ?? q.status, pill: q.status === 'accepted' || q.status === 'fully_invoiced' || q.status === 'converted' ? 'green' : q.status === 'refused' || q.status === 'expired' ? 'red' : q.status === 'draft' ? 'neutral' : 'amber' },
      ],
    }))
    drawKitTable(doc, cols, rows, { gap, textColumns: 3, gapTop: 4 })
  }

  return doc.save()
}
