export type BusinessProfile = 'btp' | 'cleaning' | 'industry'

export type AccountingEntry = {
  debit: string
  debitLib: string
  credit: string
  creditLib: string
}

export type AccountingPlan = {
  // Factures émises
  invoiceSale: AccountingEntry        // HT prestation
  invoiceSaleGoods: AccountingEntry   // HT vente de biens (industrie)
  invoiceTva: (rate: number) => AccountingEntry
  // Encaissements
  payment: AccountingEntry
  // Avoirs
  creditNoteSale: AccountingEntry
  creditNoteSaleGoods: AccountingEntry
  creditNoteTva: (rate: number) => AccountingEntry
  // Acomptes
  depositReceived: AccountingEntry    // émission acompte
  depositApplied: AccountingEntry     // apurement acompte
  // Factures reçues
  purchaseCharge: AccountingEntry
  purchaseTva: AccountingEntry
}

const ACCOUNT_LIBS: Record<string, string> = {
  '401': 'Fournisseurs',
  '411': 'Clients',
  '4191': 'Clients — avances et acomptes reçus',
  '44566': 'TVA déductible sur autres biens et services',
  '4457': 'TVA collectée',
  '44571': 'TVA collectée 20%',
  '44572': 'TVA collectée 10%',
  '44573': 'TVA collectée 5,5%',
  '512': 'Banques',
  '706': 'Prestations de services',
  '707': 'Ventes de marchandises',
  '6068': 'Autres achats',
}

function tvaAccount(rate: number): { num: string; lib: string } {
  if (rate === 10) return { num: '44572', lib: 'TVA collectée 10%' }
  if (rate === 5.5) return { num: '44573', lib: 'TVA collectée 5,5%' }
  return { num: '44571', lib: 'TVA collectée 20%' }
}

export function getAccountingPlan(profile: BusinessProfile, preferGoods = false): AccountingPlan {
  const saleAccount = profile === 'industry' && preferGoods ? '707' : '706'
  const saleLib = ACCOUNT_LIBS[saleAccount]

  return {
    invoiceSale: {
      debit: '411', debitLib: ACCOUNT_LIBS['411'],
      credit: '706', creditLib: ACCOUNT_LIBS['706'],
    },
    invoiceSaleGoods: {
      debit: '411', debitLib: ACCOUNT_LIBS['411'],
      credit: '707', creditLib: ACCOUNT_LIBS['707'],
    },
    invoiceTva: (rate: number) => {
      const tva = tvaAccount(rate)
      return {
        debit: '411', debitLib: ACCOUNT_LIBS['411'],
        credit: tva.num, creditLib: tva.lib,
      }
    },
    payment: {
      debit: '512', debitLib: ACCOUNT_LIBS['512'],
      credit: '411', creditLib: ACCOUNT_LIBS['411'],
    },
    creditNoteSale: {
      debit: saleAccount, debitLib: saleLib,
      credit: '411', creditLib: ACCOUNT_LIBS['411'],
    },
    creditNoteSaleGoods: {
      debit: '707', debitLib: ACCOUNT_LIBS['707'],
      credit: '411', creditLib: ACCOUNT_LIBS['411'],
    },
    creditNoteTva: (rate: number) => {
      const tva = tvaAccount(rate)
      return {
        debit: tva.num, debitLib: tva.lib,
        credit: '411', creditLib: ACCOUNT_LIBS['411'],
      }
    },
    depositReceived: {
      debit: '411', debitLib: ACCOUNT_LIBS['411'],
      credit: '4191', creditLib: ACCOUNT_LIBS['4191'],
    },
    depositApplied: {
      debit: '4191', debitLib: ACCOUNT_LIBS['4191'],
      credit: '411', creditLib: ACCOUNT_LIBS['411'],
    },
    purchaseCharge: {
      debit: '6068', debitLib: ACCOUNT_LIBS['6068'],
      credit: '401', creditLib: ACCOUNT_LIBS['401'],
    },
    purchaseTva: {
      debit: '44566', debitLib: ACCOUNT_LIBS['44566'],
      credit: '401', creditLib: ACCOUNT_LIBS['401'],
    },
  }
}
