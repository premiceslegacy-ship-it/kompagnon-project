import { getAccountingPlan, type BusinessProfile } from './accounting-plan'
import { computeVatBreakdowns, fmtAmount, fmtDate, round2, type VatTiming } from './vat-rules'

// ─── Types d'entrée ────────────────────────────────────────────────────────────

export type FecInvoice = {
  id: string
  number: string
  invoice_type: 'standard' | 'acompte' | 'situation' | 'solde' | 'avoir'
  issue_date: string
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  paid_at: string | null
  is_vat_subject: boolean
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
  tva_sur_debits: boolean
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

// ─── Génération écritures facture émise ────────────────────────────────────────

function generateInvoiceLines(
  inv: FecInvoice,
  profile: BusinessProfile,
  vatTiming: VatTiming,
  counters: Counters,
): FecLine[] {
  const plan = getAccountingPlan(profile)
  const year = inv.issue_date.substring(0, 4)
  const dateStr = fmtDate(inv.issue_date)
  const lib = buildEcritureLib(inv)
  const clientAuxNum = inv.client?.id.substring(0, 8).toUpperCase() ?? ''
  const clientAuxLib = inv.client?.display_name ?? ''
  const lines: FecLine[] = []

  const isAvoir = inv.invoice_type === 'avoir'
  const isAcompte = inv.invoice_type === 'acompte'
  const journalCode = isAvoir ? 'AV' : 'VE'
  const journalLib = isAvoir ? 'Avoirs' : 'Ventes'

  const totalHt = round2(inv.total_ht)
  const vatBreakdowns = inv.is_vat_subject
    ? computeVatBreakdowns(inv.items)
    : []

  if (isAcompte) {
    // Acompte : débit 411 / crédit 4191
    const num = nextNum(counters, journalCode, year)
    const htEntry = plan.depositReceived
    lines.push(
      line(journalCode, journalLib, num, dateStr,
        htEntry.debit, htEntry.debitLib, clientAuxNum, clientAuxLib,
        inv.number, dateStr, lib, totalHt, 0),
      line(journalCode, journalLib, num, dateStr,
        htEntry.credit, htEntry.creditLib, '', '',
        inv.number, dateStr, lib, 0, totalHt),
    )
    return lines
  }

  if (isAvoir) {
    // Avoir : débit 706/707, crédit 411
    const htEntry = plan.creditNoteSale
    const num = nextNum(counters, journalCode, year)
    lines.push(
      line(journalCode, journalLib, num, dateStr,
        htEntry.debit, htEntry.debitLib, '', '',
        inv.number, dateStr, lib, totalHt, 0),
      line(journalCode, journalLib, num, dateStr,
        htEntry.credit, htEntry.creditLib, clientAuxNum, clientAuxLib,
        inv.number, dateStr, lib, 0, totalHt),
    )

    // TVA
    if (inv.is_vat_subject && vatTiming === 'debits') {
      for (const vat of vatBreakdowns) {
        const tvaEntry = plan.creditNoteTva(vat.rate)
        const tvaNum = nextNum(counters, journalCode, year)
        lines.push(
          line(journalCode, journalLib, tvaNum, dateStr,
            tvaEntry.debit, tvaEntry.debitLib, '', '',
            inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, vat.vatAmount, 0),
          line(journalCode, journalLib, tvaNum, dateStr,
            tvaEntry.credit, tvaEntry.creditLib, clientAuxNum, clientAuxLib,
            inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, 0, vat.vatAmount),
        )
      }
    }
    return lines
  }

  // Facture standard, situation, solde
  const htEntry = plan.invoiceSale
  const num = nextNum(counters, journalCode, year)
  lines.push(
    line(journalCode, journalLib, num, dateStr,
      htEntry.debit, htEntry.debitLib, clientAuxNum, clientAuxLib,
      inv.number, dateStr, lib, totalHt, 0),
    line(journalCode, journalLib, num, dateStr,
      htEntry.credit, htEntry.creditLib, '', '',
      inv.number, dateStr, lib, 0, totalHt),
  )

  // TVA sur débits : générée à l'émission
  if (inv.is_vat_subject && vatTiming === 'debits') {
    for (const vat of vatBreakdowns) {
      const tvaEntry = plan.invoiceTva(vat.rate)
      const tvaNum = nextNum(counters, journalCode, year)
      lines.push(
        line(journalCode, journalLib, tvaNum, dateStr,
          tvaEntry.debit, tvaEntry.debitLib, clientAuxNum, clientAuxLib,
          inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, vat.vatAmount, 0),
        line(journalCode, journalLib, tvaNum, dateStr,
          tvaEntry.credit, tvaEntry.creditLib, '', '',
          inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, 0, vat.vatAmount),
      )
    }
  }

  return lines
}

// ─── Génération écritures encaissement ─────────────────────────────────────────

function generatePaymentLines(
  inv: FecInvoice,
  profile: BusinessProfile,
  vatTiming: VatTiming,
  counters: Counters,
): FecLine[] {
  if (!inv.paid_at || inv.total_paid <= 0) return []

  const plan = getAccountingPlan(profile)
  const year = inv.paid_at.substring(0, 4)
  const dateStr = fmtDate(inv.paid_at)
  const lib = `Encaissement ${inv.number}`
  const clientAuxNum = inv.client?.id.substring(0, 8).toUpperCase() ?? ''
  const clientAuxLib = inv.client?.display_name ?? ''
  const lines: FecLine[] = []
  const totalPaid = round2(inv.total_paid)

  const bqEntry = plan.payment
  const bqNum = nextNum(counters, 'BQ', year)
  lines.push(
    line('BQ', 'Banque', bqNum, dateStr,
      bqEntry.debit, bqEntry.debitLib, '', '',
      inv.number, dateStr, lib, totalPaid, 0),
    line('BQ', 'Banque', bqNum, dateStr,
      bqEntry.credit, bqEntry.creditLib, clientAuxNum, clientAuxLib,
      inv.number, dateStr, lib, 0, totalPaid),
  )

  // TVA sur encaissements : générée à l'encaissement
  if (inv.is_vat_subject && vatTiming === 'encaissements' && inv.invoice_type !== 'avoir') {
    const vatBreakdowns = computeVatBreakdowns(inv.items)
    for (const vat of vatBreakdowns) {
      const tvaEntry = plan.invoiceTva(vat.rate)
      const tvaNum = nextNum(counters, 'BQ', year)
      lines.push(
        line('BQ', 'Banque', tvaNum, dateStr,
          tvaEntry.debit, tvaEntry.debitLib, clientAuxNum, clientAuxLib,
          inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, vat.vatAmount, 0),
        line('BQ', 'Banque', tvaNum, dateStr,
          tvaEntry.credit, tvaEntry.creditLib, '', '',
          inv.number, dateStr, `TVA ${vat.rate}% ${inv.number}`, 0, vat.vatAmount),
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

function serializeFec(lines: FecLine[]): string {
  const header = FEC_HEADERS.join('|')
  const rows = lines.map(l => FEC_HEADERS.map(h => l[h]).join('|'))
  return [header, ...rows].join('\n')
}

// ─── Point d'entrée principal ──────────────────────────────────────────────────

export type GenerateFecInput = {
  invoices: FecInvoice[]
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
    receivedInvoices,
    orgProfile,
    includeInvoices,
    includeAvoirs,
    includePayments,
    includeReceivedInvoices,
  } = input
  const profile: BusinessProfile = orgProfile.business_profile ?? 'btp'
  const vatTiming = orgProfile.tva_sur_debits ? 'debits' : 'encaissements'
  const counters: Counters = {}
  const warnings: string[] = []

  // Vérification auto-liquidation
  const autoLiqCount = invoices.filter(inv =>
    !inv.is_vat_subject && inv.invoice_type !== 'avoir' && inv.total_ttc > 0,
  ).length
  if (autoLiqCount > 0) {
    warnings.push(`${autoLiqCount} facture(s) sans TVA détectée(s) — vérifiez les cas d'auto-liquidation (sous-traitance BTP art. 283-2 nonies CGI) avec votre comptable.`)
  }

  const allLines: FecLine[] = []

  // Trier les factures par date pour une numérotation cohérente
  const sorted = [...invoices].sort((a, b) =>
    (a.issue_date ?? '').localeCompare(b.issue_date ?? ''),
  )

  for (const inv of sorted) {
    if (!inv.number) continue
    const shouldIncludeInvoiceEntry = inv.invoice_type === 'avoir' ? includeAvoirs : includeInvoices
    if (shouldIncludeInvoiceEntry) {
      allLines.push(...generateInvoiceLines(inv, profile, vatTiming, counters))
    }
    if (includePayments) {
      allLines.push(...generatePaymentLines(inv, profile, vatTiming, counters))
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
