// Générateur XML CII (Cross Industry Invoice) - profil EN 16931
// Spécification : Factur-X 1.0 / ZUGFeRD 2.3 / norme EN 16931
// Validateur officiel : https://services.fnfe-mpe.org

import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'

const INVOICE_SECTION_UNIT = '__section__'
import { facturxGuidelineId } from '@/lib/pdf/facturx-profile'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Factur-X exige YYYYMMDD (format "102"), pas ISO 8601
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// Montants : toujours 2 décimales, point comme séparateur
function fmtAmount(n: number | null | undefined): string {
  return (n ?? 0).toFixed(2)
}

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

function sirenFrom(value: string | null | undefined): string | null {
  const digits = digitsOnly(value)
  if (digits.length >= 9) return digits.slice(0, 9)
  return null
}

function siretFrom(value: string | null | undefined): string | null {
  const digits = digitsOnly(value)
  return digits.length === 14 ? digits : null
}

function sellerSiren(org: Organization): string | null {
  return sirenFrom(org.siren) ?? sirenFrom(org.siret)
}

function buyerSiren(client: NonNullable<InvoiceWithItems['client']>): string | null {
  return sirenFrom(client.siren) ?? sirenFrom(client.siret)
}

function buyerSiret(client: NonNullable<InvoiceWithItems['client']>): string | null {
  return siretFrom(client.siret)
}

function partyFiscalId(siret: string | null | undefined, siren: string | null | undefined): string | null {
  return siretFrom(siret) ?? sirenFrom(siren)
}

// Détermine le code TypeCode selon invoice_type
// 380 = Commercial Invoice, 384 = Credit Note
function invoiceTypeCode(type: string | null | undefined): string {
  return type === 'avoir' ? '384' : '380'
}

// Mapping des unités vers les codes UN/ECE Rec 20 (codelist 8 du Factur-X)
// C62 = pièce (unité sans dimension) - valeur par défaut
const UNIT_CODE_MAP: Record<string, string> = {
  'u': 'C62', 'unite': 'C62', 'unité': 'C62', 'unit': 'C62', 'pc': 'C62', 'piece': 'C62', 'pièce': 'C62',
  'h': 'HUR', 'heure': 'HUR', 'hr': 'HUR', 'hour': 'HUR',
  'j': 'DAY', 'jour': 'DAY', 'jours': 'DAY', 'day': 'DAY',
  'min': 'MIN', 'minute': 'MIN',
  'm': 'MTR', 'ml': 'MTR', 'mètre': 'MTR', 'metre': 'MTR', 'meter': 'MTR',
  'm2': 'MTK', 'm²': 'MTK',
  'm3': 'MTQ', 'm³': 'MTQ',
  'mm': 'MMT',
  'cm': 'CMT',
  'km': 'KMT',
  'kg': 'KGM', 'kilo': 'KGM', 'kilogramme': 'KGM',
  'g': 'GRM', 'gramme': 'GRM',
  't': 'TNE', 'tonne': 'TNE',
  'l': 'LTR', 'litre': 'LTR',
  'ml_vol': 'MLT',
  'forfait': 'C62', 'ft': 'C62', 'lot': 'LO',
  'pourcent': 'P1', '%': 'P1',
}

function toUnitCode(unit: string | null | undefined): string {
  if (!unit) return 'C62'
  const key = unit.toLowerCase().trim()
  return UNIT_CODE_MAP[key] ?? 'C62'
}

// ─── Sections XML ─────────────────────────────────────────────────────────────

// Ordre XSD strict dans TradeAddressType (CII D16B) :
// PostcodeCode → LineOne → LineTwo → LineThree → CityName → CountryID
// Chaque élément est conditionnel mais émis dans l'ordre fixe de la séquence XSD
function xmlAddress(fields: {
  line1?: string | null
  line2?: string | null
  postcode?: string | null
  city?: string | null
  country?: string | null
}): string {
  const country = (fields.country ?? 'FR').trim().toUpperCase().slice(0, 2)
  return [
    fields.postcode ? `<ram:PostcodeCode>${esc(fields.postcode)}</ram:PostcodeCode>` : '',
    fields.line1 ? `<ram:LineOne>${esc(fields.line1)}</ram:LineOne>` : '',
    fields.line2 ? `<ram:LineTwo>${esc(fields.line2)}</ram:LineTwo>` : '',
    fields.city ? `<ram:CityName>${esc(fields.city)}</ram:CityName>` : '',
    `<ram:CountryID>${country}</ram:CountryID>`,
  ].filter(Boolean).join('\n        ')
}

function xmlSeller(org: Organization): string {
  const siren = sellerSiren(org)
  const fiscalId = partyFiscalId(org.siret, org.siren)
  const siret = siretFrom(org.siret)

  // GlobalID schemeID="0225" (SIRET, annuaire Peppol France) : voir le même
  // ajout côté xmlBuyer pour le contexte complet.
  const globalIdBlock = siret
    ? `<ram:GlobalID schemeID="0225">${esc(siret)}</ram:GlobalID>`
    : ''
  const legalOrgBlock = siren
    ? `<ram:SpecifiedLegalOrganization>
        <ram:ID schemeID="0002">${esc(siren)}</ram:ID>
      </ram:SpecifiedLegalOrganization>`
    : ''

  // BT-31 (numéro TVA intracommunautaire) ou BT-32 (SIRET/SIREN, schemeID="FC")
  // L'un ou l'autre est obligatoire quand des lignes ont une TVA > 0 (BR-S-02)
  const vatBlock = org.vat_number
    ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${esc(org.vat_number)}</ram:ID>
      </ram:SpecifiedTaxRegistration>`
    : fiscalId
    ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="FC">${esc(fiscalId)}</ram:ID>
      </ram:SpecifiedTaxRegistration>`
    : ''

  return `<ram:SellerTradeParty>
      ${globalIdBlock}
      <ram:Name>${esc(org.name)}</ram:Name>
      ${legalOrgBlock}
      <ram:PostalTradeAddress>
        ${xmlAddress({ line1: org.address_line1, line2: org.address_line2, postcode: org.postal_code, city: org.city, country: org.country })}
      </ram:PostalTradeAddress>
      ${org.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(org.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
      ${vatBlock}
    </ram:SellerTradeParty>`
}

function xmlBuyer(client: NonNullable<InvoiceWithItems['client']>): string {
  const name = client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || 'Client'

  const siren = buyerSiren(client)
  const siret = buyerSiret(client)
  // GlobalID schemeID="0225" (SIRET, annuaire Peppol France) : identifiant B2B
  // reconnu par Super PDP, absent jusqu'ici alors que la facture de test qu'ils
  // génèrent eux-mêmes en contient un — sans lui, une facture avec seulement
  // SpecifiedLegalOrganization (SIREN) a été classée B2C côté Super PDP malgré
  // un client marqué "company" (voir docs/atelier-facturation-electronique.md §15).
  const globalIdBlock = siret
    ? `<ram:GlobalID schemeID="0225">${esc(siret)}</ram:GlobalID>`
    : ''
  const legalOrgBlock = siren
    ? `<ram:SpecifiedLegalOrganization>
        <ram:ID schemeID="0002">${esc(siren)}</ram:ID>
      </ram:SpecifiedLegalOrganization>`
    : ''

  const vatBlock = client.vat_number
    ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${esc(client.vat_number)}</ram:ID>
      </ram:SpecifiedTaxRegistration>`
    : ''

  return `<ram:BuyerTradeParty>
      ${globalIdBlock}
      <ram:Name>${esc(name)}</ram:Name>
      ${legalOrgBlock}
      <ram:PostalTradeAddress>
        ${xmlAddress({ line1: client.address_line1, postcode: client.postal_code, city: client.city })}
      </ram:PostalTradeAddress>
      ${client.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(client.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
      ${vatBlock}
    </ram:BuyerTradeParty>`
}

function xmlTradeLines(items: InvoiceWithItems['items']): string {
  return items
    .filter(item => !item.is_internal && item.unit !== INVOICE_SECTION_UNIT)
    .map((item, idx) => {
      const lineHt = (item.quantity * item.unit_price).toFixed(2)
      const isVatExempt = item.vat_rate === 0
      const taxCategoryCode = isVatExempt ? 'E' : 'S'

      return `<ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${idx + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${esc(item.description ?? 'Prestation')}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${fmtAmount(item.unit_price)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${toUnitCode(item.unit)}">${fmtAmount(item.quantity)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${taxCategoryCode}</ram:CategoryCode>
          <ram:RateApplicablePercent>${fmtAmount(item.vat_rate)}</ram:RateApplicablePercent>
          ${isVatExempt ? '<ram:ExemptionReason>TVA non applicable, art. 293B du CGI</ram:ExemptionReason>' : ''}
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${lineHt}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
    })
    .join('\n  ')
}

function xmlVatBreakdown(items: InvoiceWithItems['items'], isVatSubject: boolean): string {
  if (!isVatSubject) {
    return `<ram:ApplicableTradeTax>
      <ram:CalculatedAmount>0.00</ram:CalculatedAmount>
      <ram:TypeCode>VAT</ram:TypeCode>
      <ram:ExemptionReason>TVA non applicable, art. 293B du CGI</ram:ExemptionReason>
      <ram:BasisAmount>${fmtAmount(items.filter(i => !i.is_internal && i.unit !== INVOICE_SECTION_UNIT).reduce((s, i) => s + i.quantity * i.unit_price, 0))}</ram:BasisAmount>
      <ram:CategoryCode>E</ram:CategoryCode>
      <ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`
  }

  const vatMap: Record<number, { basis: number; amount: number }> = {}
  for (const item of items.filter(i => !i.is_internal && i.unit !== INVOICE_SECTION_UNIT)) {
    const ht = item.quantity * item.unit_price
    const vat = ht * (item.vat_rate / 100)
    if (!vatMap[item.vat_rate]) vatMap[item.vat_rate] = { basis: 0, amount: 0 }
    vatMap[item.vat_rate].basis += ht
    vatMap[item.vat_rate].amount += vat
  }

  return Object.entries(vatMap).map(([rate, { basis, amount }]) => {
    const r = parseFloat(rate)
    const categoryCode = r === 0 ? 'E' : 'S'
    return `<ram:ApplicableTradeTax>
      <ram:CalculatedAmount>${fmtAmount(amount)}</ram:CalculatedAmount>
      <ram:TypeCode>VAT</ram:TypeCode>
      <ram:BasisAmount>${fmtAmount(basis)}</ram:BasisAmount>
      <ram:CategoryCode>${categoryCode}</ram:CategoryCode>
      <ram:RateApplicablePercent>${fmtAmount(r)}</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`
  }).join('\n  ')
}

function legalNote(subjectCode: 'PMT' | 'PMD' | 'AAB', content: string): string {
  return `<ram:IncludedNote>
      <ram:Content>${esc(content)}</ram:Content>
      <ram:SubjectCode>${subjectCode}</ram:SubjectCode>
    </ram:IncludedNote>`
}

function invoiceNotes(invoice: InvoiceWithItems, organization: Organization, isClientPro: boolean): string {
  const notes: string[] = []
  if (invoice.notes_client) notes.push(`<ram:IncludedNote><ram:Content>${esc(invoice.notes_client)}</ram:Content></ram:IncludedNote>`)

  const lateRate = organization.late_penalty_rate != null
    ? `${organization.late_penalty_rate}% par an`
    : "au taux legal applicable"
  notes.push(legalNote(
    'PMD',
    `Penalites de retard exigibles des le lendemain de la date d'echeance, sans mise en demeure prealable : ${lateRate}.`,
  ))

  notes.push(legalNote(
    'PMT',
    isClientPro
      ? organization.recovery_indemnity_text
        ?? "Indemnite forfaitaire de 40 EUR pour frais de recouvrement due de plein droit en cas de retard de paiement, conformement a l'article L441-10 du Code de commerce."
      : "Indemnite forfaitaire pour frais de recouvrement non applicable aux particuliers.",
  ))

  notes.push(legalNote('AAB', "Aucun escompte n'est accorde pour paiement anticipe."))

  return notes.join('\n    ')
}

// ─── Export principal ──────────────────────────────────────────────────────────

export function generateFacturXml(
  invoice: InvoiceWithItems,
  organization: Organization,
): string {
  const isVatSubject = organization.is_vat_subject !== false
  const visibleItems = invoice.items.filter(i => !i.is_internal && i.unit !== INVOICE_SECTION_UNIT)

  const totalHt = invoice.total_ht ?? visibleItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const totalTva = invoice.total_tva ?? (isVatSubject ? visibleItems.reduce((s, i) => s + i.quantity * i.unit_price * (i.vat_rate / 100), 0) : 0)
  const totalTtc = invoice.total_ttc ?? (totalHt + totalTva)

  const issueDate = fmtDate(invoice.issue_date ?? invoice.created_at)
  const dueDate = fmtDate(invoice.due_date ?? invoice.issue_date ?? invoice.created_at)
  const guidelineId = facturxGuidelineId('EN 16931')

  const client = invoice.client
  const isClientPro = client?.type === 'company'

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>S1</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guidelineId}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.number ?? invoice.id)}</ram:ID>
    <ram:TypeCode>${invoiceTypeCode(invoice.invoice_type)}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issueDate}</udt:DateTimeString>
    </ram:IssueDateTime>
    ${invoiceNotes(invoice, organization, isClientPro)}
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>

    ${xmlTradeLines(invoice.items)}

    <ram:ApplicableHeaderTradeAgreement>
      ${xmlSeller(organization)}
      ${client ? xmlBuyer(client) : '<ram:BuyerTradeParty><ram:Name>Client</ram:Name></ram:BuyerTradeParty>'}
    </ram:ApplicableHeaderTradeAgreement>

    <ram:ApplicableHeaderTradeDelivery>
      <ram:ShipToTradeParty>
        <ram:Name>${client ? esc(client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client') : 'Client'}</ram:Name>
      </ram:ShipToTradeParty>
    </ram:ApplicableHeaderTradeDelivery>

    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${esc(invoice.currency ?? 'EUR')}</ram:InvoiceCurrencyCode>

      ${organization.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:Information>Virement bancaire</ram:Information>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(organization.iban)}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
        ${organization.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution>
          <ram:BICID>${esc(organization.bic)}</ram:BICID>
        </ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>` : ''}

      ${xmlVatBreakdown(invoice.items, isVatSubject)}

      ${invoice.payment_conditions ? `<ram:SpecifiedTradePaymentTerms>
        <ram:Description>${esc(invoice.payment_conditions)}</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>` : `<ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${dueDate}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>`}

      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${fmtAmount(totalHt)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${fmtAmount(totalHt)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(invoice.currency ?? 'EUR')}">${fmtAmount(totalTva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${fmtAmount(totalTtc)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${fmtAmount(totalTtc)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>

  </rsm:SupplyChainTradeTransaction>

</rsm:CrossIndustryInvoice>`
}
