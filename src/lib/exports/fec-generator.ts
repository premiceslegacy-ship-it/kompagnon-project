import { getAccountingPlan, type AccountingEntry, type BusinessProfile } from './accounting-plan'
import { AccountingExportAuthorityError, computeVatBreakdowns, fmtAmount, fmtDate, round2, type IssuedVatBucket, type VatBreakdown, type VatTiming } from './vat-rules'

// ─── Types d'entrée ────────────────────────────────────────────────────────────

export type FecInvoice = {
  id: string
  number: string
  invoice_type: 'standard' | 'acompte' | 'situation' | 'solde' | 'avoir'
  issue_date: string
  total_ht: number
  total_tva: number
  total_ttc: number
  is_vat_subject: boolean
  is_reverse_charge: boolean
  vat_breakdown: readonly IssuedVatBucket[] | null
  applied_acompte_ht: number | null
  credit_note_source: {
    invoice_type: FecInvoice['invoice_type']
    paid_amount_before_credit: number
  } | null
  tva_sur_debits: boolean
  business_profile: BusinessProfile | null
  pa_message_id: string | null
  client: {
    id: string
    display_name: string
    siret: string | null
  } | null
  items: Array<{
    unit_price: number
    quantity: number
    vat_rate: number
  }>
  chantier_title: string | null
}

export type FecPayment = {
  id: string
  invoice: FecInvoice
  amount: number
  payment_date: string
  reference: string | null
  prior_paid_amount: number
}

export type FecReceivedInvoice = {
  id: string
  invoice_number: string
  invoice_date: string
  supplier_siret: string | null
  supplier_name: string
  total_ht: number
  total_tva: number
  total_ttc: number
}

export type FecOrgProfile = {
  siren: string
  is_vat_subject: boolean
  business_profile: BusinessProfile | null
}

// ─── Types FEC ─────────────────────────────────────────────────────────────────

export type FecLine = {
  JournalCode: string
  JournalLib: string
  EcritureNum: string
  EcritureDate: string
  CompteNum: string
  CompteLib: string
  CompteAuxNum: string
  CompteAuxLib: string
  PieceRef: string
  PieceDate: string
  EcritureLib: string
  Debit: string
  Credit: string
  EcritureLet: string
  DateLet: string
  ValidDate: string
  Montantdevise: string
  Idevise: string
}

const FEC_HEADERS: (keyof FecLine)[] = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
  'CompteNum', 'CompteLib', 'CompteAuxNum', 'CompteAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib',
  'Debit', 'Credit',
  'EcritureLet', 'DateLet', 'ValidDate',
  'Montantdevise', 'Idevise',
]

// ─── Compteurs de séquence ─────────────────────────────────────────────────────

type Counters = Record<string, number>

function nextNum(counters: Counters, journal: string, year: string): string {
  const key = `${journal}-${year}`
  counters[key] = (counters[key] ?? 0) + 1
  return `${journal}-${year}-${String(counters[key]).padStart(3, '0')}`
}

// ─── Construction d'une ligne FEC ─────────────────────────────────────────────

function line(
  journalCode: string,
  journalLib: string,
  ecritureNum: string,
  ecritureDate: string,
  compteNum: string,
  compteLib: string,
  compteAuxNum: string,
  compteAuxLib: string,
  pieceRef: string,
  pieceDate: string,
  ecritureLib: string,
  debit: number,
  credit: number,
): FecLine {
  return {
    JournalCode: journalCode,
    JournalLib: journalLib,
    EcritureNum: ecritureNum,
    EcritureDate: ecritureDate,
    CompteNum: compteNum,
    CompteLib: compteLib,
    CompteAuxNum: compteAuxNum,
    CompteAuxLib: compteAuxLib,
    PieceRef: pieceRef,
    PieceDate: pieceDate,
    EcritureLib: ecritureLib,
    Debit: debit > 0 ? fmtAmount(debit) : '',
    Credit: credit > 0 ? fmtAmount(credit) : '',
    EcritureLet: '',
    DateLet: '',
    ValidDate: '',
    Montantdevise: '',
    Idevise: 'EUR',
  }
}

function buildEcritureLib(inv: FecInvoice): string {
  const clientName = inv.client?.display_name ?? 'Client inconnu'
  const base = `${inv.number} — ${clientName}`
  if (inv.pa_message_id) return `${base} — Peppol:${inv.pa_message_id}`
  return base
}

function postInvoiceEntry(
  inv: FecInvoice,
  entry: AccountingEntry,
  amount: number,
  label: string,
  counters: Counters,
  lines: FecLine[],
  reverse = false,
) {
  if (amount === 0) return
  const journalCode = inv.invoice_type === 'avoir' ? 'AV' : 'VE'
  const journalLib = journalCode === 'AV' ? 'Avoirs' : 'Ventes'
  const date = fmtDate(inv.issue_date)
  const num = nextNum(counters, journalCode, inv.issue_date.substring(0, 4))
  const debit = reverse ? entry.credit : entry.debit
  const credit = reverse ? entry.debit : entry.credit
  const debitLib = reverse ? entry.creditLib : entry.debitLib
  const creditLib = reverse ? entry.debitLib : entry.creditLib
  const auxNum = inv.client?.id.substring(0, 8).toUpperCase() ?? ''
  const auxLib = inv.client?.display_name ?? ''
  const debitCustomer = debit === '411' || debit === '4191'
  const creditCustomer = credit === '411' || credit === '4191'
  lines.push(
    line(journalCode, journalLib, num, date, debit, debitLib,
      debitCustomer ? auxNum : '', debitCustomer ? auxLib : '',
      inv.number, date, label, amount, 0),
    line(journalCode, journalLib, num, date, credit, creditLib,
      creditCustomer ? auxNum : '', creditCustomer ? auxLib : '',
      inv.number, date, label, 0, amount),
  )
}

function invoiceVatBreakdowns(inv: FecInvoice, cache: Map<string, VatBreakdown[]>): VatBreakdown[] {
  const cached = cache.get(inv.id)
  if (cached) return cached
  const buckets = computeVatBreakdowns(inv.items, {
    isVatSubject: inv.is_vat_subject, isReverseCharge: inv.is_reverse_charge,
    issuedBreakdown: inv.vat_breakdown, issuedTotalHt: inv.total_ht, issuedTotalVat: inv.total_tva,
  })
  cache.set(inv.id, buckets)
  return buckets
}

// ─── Génération écritures facture émise ────────────────────────────────────────

function generateInvoiceLines(
  inv: FecInvoice,
  profile: BusinessProfile,
  vatTiming: VatTiming,
  counters: Counters,
  vatBreakdowns: readonly VatBreakdown[],
): FecLine[] {
  const plan = getAccountingPlan(profile)
  const lib = buildEcritureLib(inv)
  const lines: FecLine[] = []
  const isAvoir = inv.invoice_type === 'avoir'
  if (isAvoir && !inv.credit_note_source) {
    throw new AccountingExportAuthorityError('La facture d’origine de cet avoir doit être vérifiée avant son export comptable.')
  }
  const isDepositCredit = isAvoir && inv.credit_note_source?.invoice_type === 'acompte'
  const htEntry = inv.invoice_type === 'acompte' || isDepositCredit
    ? plan.depositReceived
    : isAvoir ? plan.creditNoteSale : plan.invoiceSale
  postInvoiceEntry(inv, htEntry, round2(inv.total_ht), lib, counters, lines, isDepositCredit)

  for (const vat of vatBreakdowns) {
    if (vat.vatAmount === 0) continue
    const label = `TVA ${vat.rate}% ${inv.number}`
    if (isAvoir) {
      const paidBefore = inv.credit_note_source!.paid_amount_before_credit
      const collectedVat = vatTiming === 'debits' ? vat.vatAmount
        : round2(vat.vatAmount * Math.min(paidBefore / inv.total_ttc, 1))
      postInvoiceEntry(inv, plan.creditNoteTva(vat.rate), collectedVat, label, counters, lines)
      postInvoiceEntry(inv, plan.creditNoteDeferredTva, round2(vat.vatAmount - collectedVat), label, counters, lines)
    } else {
      postInvoiceEntry(inv, vatTiming === 'debits' ? plan.invoiceTva(vat.rate) : plan.invoiceDeferredTva,
        vat.vatAmount, label, counters, lines)
    }
  }

  const appliedDeposit = round2(inv.applied_acompte_ht ?? 0)
  if (appliedDeposit > 0) {
    postInvoiceEntry(inv, plan.depositApplied, appliedDeposit,
      `Apurement des acomptes ${inv.number}`, counters, lines, isAvoir)
  }
  return lines
}

// ─── Génération écritures encaissement ─────────────────────────────────────────

function generatePaymentLines(
  payment: FecPayment,
  profile: BusinessProfile,
  vatTiming: VatTiming,
  counters: Counters,
  vatBreakdowns: readonly VatBreakdown[],
): FecLine[] {
  const inv = payment.invoice
  const plan = getAccountingPlan(profile)
  const year = payment.payment_date.substring(0, 4)
  const dateStr = fmtDate(payment.payment_date)
  const lib = `Encaissement ${inv.number}`
  const pieceRef = payment.reference || inv.number
  const clientAuxNum = inv.client?.id.substring(0, 8).toUpperCase() ?? ''
  const clientAuxLib = inv.client?.display_name ?? ''
  const lines: FecLine[] = []
  const totalPaid = round2(payment.amount)

  const bqEntry = plan.payment
  const bqNum = nextNum(counters, 'BQ', year)
  lines.push(
    line('BQ', 'Banque', bqNum, dateStr,
      bqEntry.debit, bqEntry.debitLib, '', '',
      pieceRef, dateStr, lib, totalPaid, 0),
    line('BQ', 'Banque', bqNum, dateStr,
      bqEntry.credit, bqEntry.creditLib, clientAuxNum, clientAuxLib,
      pieceRef, dateStr, lib, 0, totalPaid),
  )

  // TVA sur encaissements : générée à l'encaissement
  if (inv.is_vat_subject && !inv.is_reverse_charge && vatTiming === 'encaissements' && inv.invoice_type !== 'avoir') {
    for (const vat of vatBreakdowns) {
      const beforeVat = round2(vat.vatAmount * Math.min(payment.prior_paid_amount / inv.total_ttc, 1))
      const afterVat = round2(vat.vatAmount * Math.min((payment.prior_paid_amount + totalPaid) / inv.total_ttc, 1))
      const vatReceived = round2(afterVat - beforeVat)
      if (vatReceived === 0) continue
      const tvaEntry = plan.paymentTva(vat.rate)
      const tvaNum = nextNum(counters, 'BQ', year)
      lines.push(
        line('BQ', 'Banque', tvaNum, dateStr,
          tvaEntry.debit, tvaEntry.debitLib, '', '',
          pieceRef, dateStr, `TVA ${vat.rate}% ${inv.number}`, vatReceived, 0),
        line('BQ', 'Banque', tvaNum, dateStr,
          tvaEntry.credit, tvaEntry.creditLib, '', '',
          pieceRef, dateStr, `TVA ${vat.rate}% ${inv.number}`, 0, vatReceived),
      )
    }
  }

  return lines
}

// ─── Génération écritures factures reçues ──────────────────────────────────────

function generateReceivedInvoiceLines(
  ri: FecReceivedInvoice,
  isVatSubject: boolean,
  counters: Counters,
): FecLine[] {
  const year = ri.invoice_date.substring(0, 4)
  const dateStr = fmtDate(ri.invoice_date)
  const supplierAuxNum = (ri.supplier_siret ?? '').substring(0, 9)
  const supplierAuxLib = ri.supplier_name
  const lib = `${ri.invoice_number} — ${ri.supplier_name}`
  const lines: FecLine[] = []

  const acNum = nextNum(counters, 'AC', year)
  lines.push(
    line('AC', 'Achats', acNum, dateStr,
      '6068', 'Autres achats', '', '',
      ri.invoice_number, dateStr, lib, round2(ri.total_ht), 0),
    line('AC', 'Achats', acNum, dateStr,
      '401', 'Fournisseurs', supplierAuxNum, supplierAuxLib,
      ri.invoice_number, dateStr, lib, 0, round2(ri.total_ht)),
  )

  if (isVatSubject && ri.total_tva > 0) {
    const tvaNum = nextNum(counters, 'AC', year)
    lines.push(
      line('AC', 'Achats', tvaNum, dateStr,
        '44566', 'TVA déductible sur autres biens et services', '', '',
        ri.invoice_number, dateStr, `TVA ${lib}`, round2(ri.total_tva), 0),
      line('AC', 'Achats', tvaNum, dateStr,
        '401', 'Fournisseurs', supplierAuxNum, supplierAuxLib,
        ri.invoice_number, dateStr, `TVA ${lib}`, 0, round2(ri.total_tva)),
    )
  }

  return lines
}

// ─── Sérialisation FEC ─────────────────────────────────────────────────────────

// Le FEC est un format positionnel à séparateur `|` : un libellé contenant un
// pipe, une tabulation ou un saut de ligne décale toutes les colonnes de la
// ligne et rend le fichier rejeté par le comptable. On neutralise à la source.
function cleanFecField(value: string): string {
  return value.replace(/[|\r\n\t]+/g, ' ').trim()
}

function serializeFec(lines: FecLine[]): string {
  const header = FEC_HEADERS.join('|')
  const rows = lines.map(l => FEC_HEADERS.map(h => cleanFecField(l[h] ?? '')).join('|'))
  return [header, ...rows].join('\n')
}

// ─── Point d'entrée principal ──────────────────────────────────────────────────

export type GenerateFecInput = {
  invoices: FecInvoice[]
  payments: FecPayment[]
  receivedInvoices: FecReceivedInvoice[]
  orgProfile: FecOrgProfile
  includeInvoices: boolean
  includeAvoirs: boolean
  includePayments: boolean
  includeReceivedInvoices: boolean
}

export type GenerateFecResult = {
  content: string
  lineCount: number
  warnings: string[]
}

export function generateFec(input: GenerateFecInput): GenerateFecResult {
  const {
    invoices,
    payments,
    receivedInvoices,
    orgProfile,
    includeInvoices,
    includeAvoirs,
    includePayments,
    includeReceivedInvoices,
  } = input
  const profile: BusinessProfile = orgProfile.business_profile ?? 'btp'
  const counters: Counters = {}
  const vatCache = new Map<string, VatBreakdown[]>()
  const warnings: string[] = []

  // Vérification auto-liquidation
  const autoLiqCount = invoices.filter(inv =>
    inv.is_reverse_charge && inv.total_ttc > 0,
  ).length
  if (autoLiqCount > 0) {
    warnings.push(`${autoLiqCount} facture(s) sans TVA détectée(s). Vérifiez les cas d'auto-liquidation (sous-traitance BTP, art. 283-2 nonies CGI) avec votre comptable.`)
  }

  const allLines: FecLine[] = []

  // Trier les factures par date pour une numérotation cohérente
  const sorted = [...invoices].sort((a, b) =>
    (a.issue_date ?? '').localeCompare(b.issue_date ?? ''),
  )

  for (const inv of sorted) {
    if (!inv.number) continue
    const shouldIncludeInvoiceEntry = inv.invoice_type === 'avoir' ? includeAvoirs : includeInvoices
    const invoiceProfile = inv.business_profile ?? profile
    const invoiceVatTiming = inv.tva_sur_debits ? 'debits' : 'encaissements'
    if (shouldIncludeInvoiceEntry) {
      allLines.push(...generateInvoiceLines(inv, invoiceProfile, invoiceVatTiming, counters, invoiceVatBreakdowns(inv, vatCache)))
    }
  }

  if (includePayments) {
    const sortedPayments = [...payments].sort((a, b) =>
      a.payment_date.localeCompare(b.payment_date) || a.id.localeCompare(b.id))
    for (const payment of sortedPayments) {
      const inv = payment.invoice
      const invoiceProfile = inv.business_profile ?? profile
      allLines.push(...generatePaymentLines(payment, invoiceProfile,
        inv.tva_sur_debits ? 'debits' : 'encaissements', counters, invoiceVatBreakdowns(inv, vatCache)))
    }
  }

  if (includeReceivedInvoices) {
    const sortedRi = [...receivedInvoices].sort((a, b) =>
      (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''),
    )
    for (const ri of sortedRi) {
      allLines.push(...generateReceivedInvoiceLines(ri, orgProfile.is_vat_subject, counters))
    }
  }

  return {
    content: serializeFec(allLines),
    lineCount: allLines.length,
    warnings,
  }
}

// ─── Nommage du fichier ────────────────────────────────────────────────────────

export function buildFecFilename(
  siren: string,
  from: string,
  to: string,
  preset: 'fiscal_year' | 'period',
): string {
  if (preset === 'fiscal_year') {
    // Format DGFiP officiel : {SIREN}FEC{AAAAMMJJ}.txt (date de clôture)
    const closureDate = fmtDate(to)
    return `${siren}FEC${closureDate}.txt`
  }
  // Format usage courant : {SIREN}_{YYYY}_{MM_debut}_{MM_fin}_FEC.txt
  const fromMm = from.substring(0, 7).replace('-', '_')
  const toMm = to.substring(0, 7).replace('-', '_')
  const yyyy = from.substring(0, 4)
  return `${siren}_${yyyy}_${fromMm}_${toMm}_FEC.txt`
}
