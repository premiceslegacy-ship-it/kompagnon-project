import type { PdfOrganizationData, QuoteDocumentClient, QuoteDocumentItem, QuoteDocumentRecord } from '@/lib/pdf/document-types'
import { fmtCapitalSocial, formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawAside, drawCardRow, drawCentered, drawLineTable, drawMeta, drawParties, drawTotals,
  flexWidth, infoCard, legalFooterLines, setupChrome, signatureCard,
  TOTALS_W, type LineCell, type LineColumn, type LineRow, type RichParagraph, type TotalsCard,
} from '../engine/layout'
import { COLOR } from '../engine/theme'
import { decennaleText, itemDetailLines, quantityLabel } from './shared'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function clientDisplayName(client: QuoteDocumentClient): string {
  return client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || ''
}

export type QuotePdfData = {
  quote: QuoteDocumentRecord
  organization: PdfOrganizationData
  client: QuoteDocumentClient | null
}

export async function renderQuotePdf(data: QuotePdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderQuotePdfWithFonts(data, fontBytes)
}

/**
 * Une page en priorité : la mise en page de la maquette (conditions et signature
 * en bas de page) d'abord ; si elle déborde, la version resserrée (conditions à
 * gauche des totaux, signature dessous) quand elle économise une page.
 */
export async function renderQuotePdfWithFonts(data: QuotePdfData, fontBytes: FontBytes): Promise<Buffer> {
  const regular = await drawQuote(data, fontBytes, false)
  if (regular.pages === 1) return regular.buffer
  const compact = await drawQuote(data, fontBytes, true)
  return compact.pages < regular.pages ? compact.buffer : regular.buffer
}

async function drawQuote(data: QuotePdfData, fontBytes: FontBytes, compact: boolean): Promise<{ buffer: Buffer; pages: number }> {
  const { quote, organization, client } = data
  const doc = await PdfDoc.create(fontBytes)

  const isVatSubject = organization.is_vat_subject !== false
  const isClientPro = client?.type === 'company'
  const currency = quote.currency

  const visibleSections = quote.sections.map(s => ({
    ...s,
    items: s.items.filter(i => !i.is_internal),
  })).filter(s => s.items.length > 0)
  const visibleUnsectioned = quote.unsectionedItems.filter(i => !i.is_internal)

  const totalHt = [...visibleSections.flatMap(s => s.items), ...visibleUnsectioned]
    .reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_price ?? 0), 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of [...visibleSections.flatMap(s => s.items), ...visibleUnsectioned]) {
      if (item.quantity == null || item.unit_price == null || item.vat_rate == null) continue
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const validUntil = quote.valid_until ? quote.valid_until : addDays(quote.created_at, quote.validity_days ?? 30)
  const hasClientSignature = Boolean(quote.signed_at && quote.client_signature_image)

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const signatureImg = quote.client_signature_image ? await embedImage(doc.doc, quote.client_signature_image) : null

  // En-tête réduit au logo ; nom, adresse et identifiants passent dans le bloc « De ».
  setupChrome(doc, {
    title: 'Devis',
    reference: quote.number,
    logo: logoImg,
    orgName: organization.name,
    footerLines: legalFooterLines(organization, {
      isVatSubject,
      capital: fmtCapitalSocial(organization.capital_social),
      decennale: decennaleText(organization),
    }),
  })
  doc.addPage()

  // ── Métadonnées ──
  drawMeta(doc, [
    { label: 'Date', value: fmtDate(quote.created_at) },
    { label: "Valable jusqu'au", value: fmtDate(validUntil) },
    { label: 'Objet', value: pdfText(quote.title) },
  ])

  // ── De / Pour ──
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ')
  const clientPostalCity = client ? [client.postal_code, client.city].filter(Boolean).join(' ') : ''
  drawParties(doc,
    {
      label: 'De',
      name: organization.name,
      lines: [
        [organization.address_line1, orgPostalCity].filter(Boolean).join(', '),
        [organization.email, organization.phone ? `Tél. ${organization.phone}` : null].filter(Boolean).join(' · '),
        [
          organization.siret ? `SIRET ${organization.siret}` : null,
          isVatSubject && organization.vat_number ? `TVA ${organization.vat_number}` : null,
          !isVatSubject ? 'TVA non applicable, art. 293B du CGI' : null,
        ].filter(Boolean).join(' · '),
      ],
    },
    {
      label: 'Pour',
      name: client ? clientDisplayName(client) : '-',
      lines: client
        ? [
            [client.address_line1, clientPostalCity].filter(Boolean).join(', '),
            [client.email, client.phone].filter(Boolean).join(' · '),
            client.siret ? `SIRET ${client.siret}` : '',
          ]
        : [],
    },
  )

  // ── Votre demande, texte d'introduction ──
  const showRequest = Boolean(quote.client_request_description && quote.client_request_visible_on_pdf)
  if (showRequest) drawCentered(doc, 'Votre demande', quote.client_request_description!, { marginTop: 13.5 })
  if (quote.notes_client) drawCentered(doc, null, quote.notes_client, { marginTop: showRequest ? 7.5 : 13.5 })

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

  function itemRow(item: QuoteDocumentItem): LineRow {
    const legacy = splitItemDescription(item.description)
    const title = pdfText(item.designation?.trim() || legacy.title)
    const detailLines = item.details?.trim()
      ? item.details.split('\n').map(l => pdfText(l.replace(/^\s*[-•]\s*/, '').trim())).filter(Boolean)
      : legacy.details
    const cells: (LineCell | string)[] = [
      { text: title, detail: itemDetailLines(detailLines, formatDimDetail(item)) },
      quantityLabel(item.quantity, item.unit),
      item.price_pending
        ? { text: '-', color: COLOR.ink3 }
        : item.unit_price == null ? '' : fmt(item.unit_price, currency),
    ]
    if (withVat) cells.push(item.price_pending || item.vat_rate == null ? '' : `${item.vat_rate} %`)
    cells.push(
      item.price_pending
        ? { text: 'À confirmer', color: COLOR.ink3 }
        : item.quantity == null || item.unit_price == null
          ? ''
          : { text: fmt(item.quantity * item.unit_price, currency), bold: true },
    )
    return { cells }
  }

  const rows: LineRow[] = []
  for (const section of visibleSections) {
    if (section.title) {
      const subtotal = section.items.filter(i => !i.price_pending).reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_price ?? 0), 0)
      rows.push({
        kind: 'section',
        title: section.title,
        right: quote.show_section_subtotals ? fmt(subtotal, currency) : undefined,
      })
    }
    for (const item of section.items) rows.push(itemRow(item))
  }
  for (const item of visibleUnsectioned) rows.push(itemRow(item))

  drawLineTable(doc, cols, rows)

  // ── Totaux ──
  const lines: TotalsCard['lines'] = [{ label: 'Total HT', value: fmt(totalHt, currency) }]
  if (isVatSubject) {
    for (const [rate, amount] of Object.entries(vatMap)) lines.push({ label: `TVA ${rate} %`, value: fmt(amount, currency) })
  } else {
    lines.push({ label: 'TVA', value: 'Non applicable', color: COLOR.ink3 })
  }
  const totals: TotalsCard = {
    lines,
    grands: [{ label: isVatSubject ? 'Total TTC' : 'Total HT', value: fmt(totalTtc, currency) }],
  }

  // ── Conditions + Bon pour accord ──
  const conditions: RichParagraph[] = []
  const paymentTerms = [
    quote.payment_conditions ? pdfText(quote.payment_conditions) : null,
    organization.payment_terms_days ? `Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.` : null,
  ].filter(Boolean).join(' ')
  if (paymentTerms) conditions.push(paymentTerms)
  if (organization.iban) {
    conditions.push([
      { text: 'Virement', bold: true },
      { text: ` · IBAN ${organization.iban}${organization.bic ? ` · BIC ${organization.bic}` : ''}${organization.bank_name ? ` · ${organization.bank_name}` : ''}` },
    ])
  }
  if (organization.iban || organization.payment_terms_days) {
    const penalties: string[] = []
    if (organization.late_penalty_rate) {
      penalties.push(`Pénalités de retard : ${organization.late_penalty_rate} % par an.`)
      if (isClientPro) {
        penalties.push(organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement.")
      }
    }
    if (organization.court_competent) penalties.push(`En cas de litige : ${organization.court_competent}.`)
    if (penalties.length) conditions.push(penalties.join(' '))
  }
  const conditionsCard = conditions.length ? infoCard(doc, 'Conditions', conditions, { weight: 1.25 }) : null

  const signature = signatureCard(doc, 'Bon pour accord', 'Date, signature précédée de « Lu et approuvé »', {
    signed: hasClientSignature
      ? {
          lines: [
            `Nom : ${pdfText(quote.client_signatory_name ?? '')}`,
            quote.client_signatory_role ? `Qualité : ${pdfText(quote.client_signatory_role)}` : '',
            `Date : ${quote.signed_at ? fmtDate(quote.signed_at) : ''}`,
          ],
          image: signatureImg,
        }
      : undefined,
  })

  if (compact) {
    drawTotals(doc, totals, { left: conditionsCard ?? undefined, below: signature })
    if (!isVatSubject) drawAside(doc, 'TVA non applicable, art. 293B du CGI')
  } else {
    drawTotals(doc, totals)
    if (!isVatSubject) drawAside(doc, 'TVA non applicable, art. 293B du CGI')
    // En bas de la dernière page, comme la maquette.
    drawCardRow(doc, conditionsCard ? [conditionsCard, signature] : [signature], { pin: true, width: conditionsCard ? undefined : TOTALS_W })
  }

  const pages = doc.pageCount
  return { buffer: await doc.save(), pages }
}
