import type { InvoiceDocumentClient, InvoiceDocumentRecord, PdfOrganizationData } from '@/lib/pdf/document-types'
import { fmtCapitalSocial, formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawAside, drawCardRow, drawCentered, drawLineTable, drawMeta, drawParties, drawTotals,
  flexWidth, infoCard, legalFooterLines, setupChrome, statusCard,
  TOTALS_W, type LineCell, type LineColumn, type LineRow, type RichParagraph, type TotalsCard,
} from '../engine/layout'
import { COLOR } from '../engine/theme'
import { decennaleText, itemDetailLines, quantityLabel } from './shared'

const INVOICE_SECTION_UNIT = '__section__'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function clientDisplayName(client: InvoiceDocumentClient): string {
  return client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || '-'
}

export type InvoicePdfData = {
  invoice: InvoiceDocumentRecord
  organization: PdfOrganizationData
  useStoredTotals?: boolean
}

export async function renderInvoicePdf(data: InvoicePdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderInvoicePdfWithFonts(data, fontBytes)
}

/**
 * Une page en priorité : la mise en page de la maquette (règlement et statut en
 * bas de page) d'abord ; si elle déborde, la version resserrée (règlement à
 * gauche des totaux, sans la carte de statut) quand elle économise une page.
 */
export async function renderInvoicePdfWithFonts(data: InvoicePdfData, fontBytes: FontBytes): Promise<Buffer> {
  const regular = await drawInvoice(data, fontBytes, false)
  if (regular.pages === 1) return regular.buffer
  const compact = await drawInvoice(data, fontBytes, true)
  return compact.pages < regular.pages ? compact.buffer : regular.buffer
}

async function drawInvoice(data: InvoicePdfData, fontBytes: FontBytes, compact: boolean): Promise<{ buffer: Buffer; pages: number }> {
  const { invoice, organization } = data
  const doc = await PdfDoc.create(fontBytes)

  const isVatSubject = organization.is_vat_subject !== false
  const isReverseCharge = invoice.is_reverse_charge === true
  const isClientPro = invoice.client?.type === 'company'

  const invoiceType = invoice.invoice_type ?? 'standard'
  const isSituation = invoiceType === 'situation' || invoiceType === 'solde'
  const invoiceTypeLabel =
    invoiceType === 'acompte'   ? "Facture d'acompte" :
    invoiceType === 'solde'     ? 'Facture de solde'  :
    invoiceType === 'situation' ? `Situation de travaux n° ${invoice.situation_number ?? ''}`.trim() :
    'Facture'

  const items = invoice.items.filter(i => !i.is_internal)
  const billableItems = items.filter(i => i.unit !== INVOICE_SECTION_UNIT)
  const currency = invoice.currency ?? 'EUR'

  const calculatedTotalHt = billableItems.reduce((s, i) => s + (i.quantity ?? 0) * i.unit_price, 0)
  const totalHt = data.useStoredTotals ? invoice.total_ht ?? calculatedTotalHt : calculatedTotalHt
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of billableItems) {
      const vatRate = item.vat_rate ?? 0
      const v = (item.quantity ?? 0) * item.unit_price * (vatRate / 100)
      vatMap[vatRate] = (vatMap[vatRate] ?? 0) + v
    }
  }
  const calculatedTotalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const calculatedTotalTtc = (isVatSubject && !isReverseCharge) ? calculatedTotalHt + calculatedTotalTva : calculatedTotalHt
  const totalTtc = data.useStoredTotals ? invoice.total_ttc ?? calculatedTotalTtc : calculatedTotalTtc

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  // En-tête réduit au logo ; nom, adresse et identifiants passent dans le bloc « De ».
  setupChrome(doc, {
    title: invoiceTypeLabel,
    reference: invoice.number,
    logo: logoImg,
    orgName: organization.name,
    footerLines: legalFooterLines(organization, {
      isVatSubject,
      capital: fmtCapitalSocial(organization.capital_social),
      decennale: decennaleText(organization),
    }),
  })
  doc.addPage()

  // ── Métadonnées (la situation de travaux y range son avancement et sa période) ──
  const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  const meta = [
    { label: 'Date', value: invoice.issue_date ? fmtDate(invoice.issue_date) : '' },
    { label: 'À régler avant le', value: invoice.due_date ? fmtDate(invoice.due_date) : '' },
  ]
  if (isSituation && invoice.quote_id) {
    meta.push({ label: 'Avancement cumulé', value: `${invoice.cumulative_pct ?? 0} %${invoice.quote_number ? `, devis ${invoice.quote_number}` : ''}` })
  }
  if (isSituation && invoice.period_from && invoice.period_to) {
    const from = new Date(invoice.period_from)
    const to = new Date(invoice.period_to)
    const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()
    meta.push({ label: "Période d'exécution", value: `${sameMonth ? from.getDate() : shortDate(invoice.period_from)} au ${shortDate(invoice.period_to)}` })
  }
  const objetInMeta = meta.length < 4
  if (objetInMeta) meta.push({ label: 'Objet', value: pdfText(invoice.title) })
  drawMeta(doc, meta)

  // ── De / Pour ──
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ')
  const invClient = invoice.client
  const clientPostalCity = invClient ? [invClient.postal_code, invClient.city].filter(Boolean).join(' ') : ''
  drawParties(doc,
    {
      label: 'De',
      name: organization.name,
      lines: [
        [organization.address_line1, orgPostalCity].filter(Boolean).join(', '),
        [organization.email, organization.phone ? `Tél. ${organization.phone}` : null].filter(Boolean).join(' · '),
        [
          organization.siret ? `SIRET ${organization.siret}` : organization.siren ? `SIREN ${organization.siren}` : null,
          isVatSubject && organization.vat_number ? `TVA ${organization.vat_number}` : null,
          !isVatSubject ? 'TVA non applicable, art. 293B du CGI' : null,
        ].filter(Boolean).join(' · '),
      ],
    },
    {
      label: 'Pour',
      name: invClient ? clientDisplayName(invClient) : '-',
      lines: invClient
        ? [
            [invClient.address_line1, clientPostalCity].filter(Boolean).join(', '),
            [invClient.email, invClient.phone].filter(Boolean).join(' · '),
            [
              invClient.siret ? `SIRET ${invClient.siret}` : invClient.siren ? `SIREN ${invClient.siren}` : null,
              invClient.vat_number ? `TVA ${invClient.vat_number}` : null,
            ].filter(Boolean).join(' · '),
          ]
        : [],
    },
  )

  // ── Situation de travaux : objet et marché (avancement et période sont dans le bandeau) ──
  if (isSituation) {
    const lines: string[] = []
    if (!objetInMeta && invoice.title) lines.push(`Objet : ${pdfText(invoice.title)}`)
    if (invoice.market_reference) lines.push(`Référence marché : ${invoice.market_reference}`)
    if (lines.length) drawCentered(doc, null, lines.join(' · '), { marginTop: 13.5 })
  }

  // ── Notes client ──
  if (invoice.notes_client && !isSituation) drawCentered(doc, null, invoice.notes_client, { marginTop: 13.5 })

  // ── Tableau ──
  const withVat = isVatSubject
  const fixed = withVat ? [52.5, 61.5, 33, 69] : [52.5, 61.5, 69]
  const cols: LineColumn[] = [
    { header: 'Désignation', width: flexWidth(fixed) },
    { header: 'Qté', width: 52.5 },
    { header: 'P.U. HT', width: 61.5 },
    ...(withVat ? [{ header: 'TVA', width: 33 }] : []),
    { header: 'Total HT', width: 69 },
  ]

  const rows: LineRow[] = items.map((item): LineRow => {
    if (item.unit === INVOICE_SECTION_UNIT) return { kind: 'section', title: pdfText(item.description) }
    const parts = splitItemDescription(item.description)
    const cells: (LineCell | string)[] = [
      { text: parts.title, detail: itemDetailLines(parts.details, formatDimDetail(item)) },
      quantityLabel(item.quantity, item.unit),
      fmt(item.unit_price, currency),
    ]
    if (withVat) cells.push(item.vat_rate == null ? '' : `${item.vat_rate} %`)
    cells.push({ text: fmt((item.quantity ?? 0) * item.unit_price, currency), bold: true })
    return { cells }
  })
  drawLineTable(doc, cols, rows)

  // ── Totaux ──
  const lines: TotalsCard['lines'] = [{ label: 'Total HT', value: fmt(totalHt, currency) }]
  if (isReverseCharge) {
    lines.push({ label: 'TVA', value: 'Autoliquidation', color: COLOR.ink3 })
  } else if (isVatSubject) {
    for (const [rate, amount] of Object.entries(vatMap)) lines.push({ label: `TVA ${rate} %`, value: fmt(amount, currency) })
  } else {
    lines.push({ label: 'TVA', value: 'Non applicable', color: COLOR.ink3 })
  }
  const mainLabel = isReverseCharge ? 'Total net HT' : isVatSubject ? 'Total TTC' : 'Total HT'
  const grands: TotalsCard['grands'] = []
  const hasAid = Boolean(invoice.aid_label && invoice.aid_amount != null && invoice.aid_amount > 0)
  const hasRetention = isSituation && (invoice.retention_pct ?? 0) > 0
  if (hasAid) {
    lines.push({ label: mainLabel, value: fmt(totalTtc, currency) })
    lines.push({ label: pdfText(invoice.aid_label), value: `−${fmt(invoice.aid_amount!, currency)}`, color: COLOR.okInk })
    grands.push({ label: 'Reste à charge', value: fmt(Math.max(0, totalTtc - invoice.aid_amount!), currency) })
  } else {
    grands.push({ label: mainLabel, value: fmt(totalTtc, currency) })
  }
  if (hasRetention) {
    grands.push({
      label: 'Net à payer HT',
      value: fmt(Math.max(0, totalHt - (invoice.retention_amount ?? 0)), currency),
      lines: [{ label: `Retenue de garantie ${invoice.retention_pct} %`, value: `−${fmt(invoice.retention_amount ?? 0, currency)}`, color: COLOR.warnInk }],
    })
  }
  const totals: TotalsCard = { lines, grands }

  // ── Règlement + statut, en bas de la dernière page ──
  const payment: RichParagraph[] = []
  if (organization.iban || organization.payment_terms_days || invoice.payment_conditions) {
    if (invoice.payment_conditions) payment.push(pdfText(invoice.payment_conditions))
    else if (organization.payment_terms_days) payment.push(`Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.`)
    if (organization.iban) {
      payment.push([
        { text: 'Virement', bold: true },
        { text: ` · IBAN ${organization.iban}${organization.bic ? ` · BIC ${organization.bic}` : ''}${organization.bank_name ? ` · ${organization.bank_name}` : ''}${invoice.number ? ` · Référence ${invoice.number}` : ''}` },
      ])
    }
  }
  if (organization.late_penalty_rate) {
    payment.push(`Pénalités de retard : ${organization.late_penalty_rate} % par an exigibles dès le lendemain de la date d'échéance, sans mise en demeure préalable.`
      + (isClientPro ? ` ${organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}` : '')
      + (organization.court_competent ? ` En cas de litige : ${organization.court_competent}.` : ''))
  }
  const statusLabel = invoice.status === 'paid' ? 'Payée' : invoice.status === 'cancelled' ? 'Annulée' : 'À payer'
  const statusNote = invoice.status === 'paid' || invoice.status === 'cancelled' || !invoice.due_date
    ? null
    : `avant le ${fmtDate(invoice.due_date)}`
  const paymentCard = payment.length ? infoCard(doc, 'Règlement', payment, { weight: 1.25 }) : null
  const status = statusCard(doc, 'Statut', statusLabel, statusNote)

  if (compact) {
    // Le statut reprend l'échéance du bandeau : il cède sa place pour tenir sur une page.
    drawTotals(doc, totals, { left: paymentCard ?? undefined })
    if (!isVatSubject) drawAside(doc, 'TVA non applicable, art. 293B du CGI')
  } else {
    drawTotals(doc, totals)
    if (!isVatSubject) drawAside(doc, 'TVA non applicable, art. 293B du CGI')
    // En bas de la dernière page, comme la maquette.
    drawCardRow(doc, paymentCard ? [paymentCard, status] : [status], { pin: true, width: paymentCard ? undefined : TOTALS_W })
  }

  const pages = doc.pageCount
  return { buffer: await doc.save(), pages }
}
