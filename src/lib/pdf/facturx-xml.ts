// Générateur XML CII (Cross Industry Invoice) — profil EN 16931
// Spécification : Factur-X 1.0 / ZUGFeRD 2.3 / norme EN 16931
// Validateur officiel : https://services.fnfe-mpe.org

import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'

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

// Détermine le code TypeCode selon invoice_type
// 380 = Commercial Invoice, 384 = Credit Note
function invoiceTypeCode(type: string | null | undefined): string {
  return type === 'avoir' ? '384' : '380'
}

// ─── Sections XML ─────────────────────────────────────────────────────────────

function xmlSeller(org: Organization): string {
  const address = [
    org.address_line1 ? `<ram:LineOne>${esc(org.address_line1)}</ram:LineOne>` : '',
    org.address_line2 ? `<ram:LineTwo>${esc(org.address_line2)}</ram:LineTwo>` : '',
    org.postal_code ? `<ram:PostcodeCode>${esc(org.postal_code)}</ram:PostcodeCode>` : '',
    org.city ? `<ram:CityName>${esc(org.city)}</ram:CityName>` : '',
  ].filter(Boolean).join('\n        ')

  const siretBlock = org.siret
    ? `<ram:ID schemeID="0002">${esc(org.siret)}</ram:ID>`
    : org.siren
      ? `<ram:ID schemeID="0002">${esc(org.siren)}</ram:ID>`
      : ''

  const vatBlock = org.vat_number
    ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${esc(org.vat_number)}</ram:ID>
      </ram:SpecifiedTaxRegistration>`
    : ''

  return `<ram:SellerTradeParty>
      ${siretBlock}
      <ram:Name>${esc(org.name)}</ram:Name>
      ${org.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(org.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
      <ram:PostalTradeAddress>
        ${address}
        <ram:CountryID>${esc(org.country ?? 'FR')}</ram:CountryID>
      </ram:PostalTradeAddress>
      ${vatBlock}
    </ram:SellerTradeParty>`
}

function xmlBuyer(client: NonNullable<InvoiceWithItems['client']>): string {
  const name = client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || 'Client'

  const siretBlock = client.siret
    ? `<ram:ID schemeID="0002">${esc(client.siret)}</ram:ID>`
    : client.siren
      ? `<ram:ID schemeID="0002">${esc(client.siren)}</ram:ID>`
      : ''

  const vatBlock = client.vat_number
    ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${esc(client.vat_number)}</ram:ID>
      </ram:SpecifiedTaxRegistration>`
    : ''

  const address = [
    client.address_line1 ? `<ram:LineOne>${esc(client.address_line1)}</ram:LineOne>` : '',
    client.postal_code ? `<ram:PostcodeCode>${esc(client.postal_code)}</ram:PostcodeCode>` : '',
    client.city ? `<ram:CityName>${esc(client.city)}</ram:CityName>` : '',
  ].filter(Boolean).join('\n        ')

  return `<ram:BuyerTradeParty>
      ${siretBlock}
      <ram:Name>${esc(name)}</ram:Name>
      ${client.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(client.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
      ${address ? `<ram:PostalTradeAddress>
        ${address}
        <ram:CountryID>FR</ram:CountryID>
      </ram:PostalTradeAddress>` : ''}
      ${vatBlock}
    </ram:BuyerTradeParty>`
}

function xmlTradeLines(items: InvoiceWithItems['items']): string {
  return items
    .filter(item => !item.is_internal)
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
        <ram:BilledQuantity unitCode="${esc(item.unit ?? 'C62')}">${fmtAmount(item.quantity)}</ram:BilledQuantity>
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
      <ram:BasisAmount>${fmtAmount(items.filter(i => !i.is_internal).reduce((s, i) => s + i.quantity * i.unit_price, 0))}</ram:BasisAmount>
      <ram:CategoryCode>E</ram:CategoryCode>
      <ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>`
  }

  const vatMap: Record<number, { basis: number; amount: number }> = {}
  for (const item of items.filter(i => !i.is_internal)) {
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

// ─── Export principal ──────────────────────────────────────────────────────────

export function generateFacturXml(
  invoice: InvoiceWithItems,
  organization: Organization,
): string {
  const isVatSubject = organization.is_vat_subject !== false
  const visibleItems = invoice.items.filter(i => !i.is_internal)

  const totalHt = invoice.total_ht ?? visibleItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const totalTva = invoice.total_tva ?? (isVatSubject ? visibleItems.reduce((s, i) => s + i.quantity * i.unit_price * (i.vat_rate / 100), 0) : 0)
  const totalTtc = invoice.total_ttc ?? (totalHt + totalTva)

  const issueDate = fmtDate(invoice.issue_date ?? invoice.created_at)
  const dueDate = fmtDate(invoice.due_date ?? invoice.issue_date ?? invoice.created_at)

  const client = invoice.client

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <rsm:ExchangedDocumentContext>
    <ram:SpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:SpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.number ?? invoice.id)}</ram:ID>
    <ram:TypeCode>${invoiceTypeCode(invoice.invoice_type)}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${issueDate}</udt:DateTimeString>
    </ram:IssueDateTime>
    ${invoice.notes_client ? `<ram:IncludedNote><ram:Content>${esc(invoice.notes_client)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>

    ${xmlTradeLines(invoice.items)}

    <ram:ApplicableHeaderTradeAgreement>
      ${xmlSeller(organization)}
      ${client ? xmlBuyer(client) : '<ram:BuyerTradeParty><ram:Name>Client</ram:Name></ram:BuyerTradeParty>'}
    </ram:ApplicableHeaderTradeAgreement>

    <ram:ApplicableHeaderTradeDelivery/>

    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${esc(invoice.currency ?? 'EUR')}</ram:InvoiceCurrencyCode>

      ${xmlVatBreakdown(invoice.items, isVatSubject)}

      ${organization.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:Information>Virement bancaire</ram:Information>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(organization.iban)}</ram:IBANID>
          ${organization.bic ? `<ram:ProprietaryID>${esc(organization.bic)}</ram:ProprietaryID>` : ''}
        </ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>` : ''}

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
        <ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
        <ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
        <ram:TaxBasisTotalAmount>${fmtAmount(totalHt)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${esc(invoice.currency ?? 'EUR')}">${fmtAmount(totalTva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${fmtAmount(totalTtc)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${fmtAmount(totalTtc)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>

  </rsm:SupplyChainTradeTransaction>

</rsm:CrossIndustryInvoice>`
}
