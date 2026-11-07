// Script de vérification locale des documents pdf-lib.
// Usage : npx tsx scripts/render-pdf-samples.mts
// Écrit les PDF générés dans .scratch/pdf/ (gitignoré) pour inspection visuelle.
//
// Ne dépend pas de Supabase : les données sont des fixtures en dur, et les
// polices viennent des modules embarqués (engine/font-data), comme au runtime.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sampleChantier, sampleContract, sampleDgd, sampleIntervention, sampleMemberHours, sampleMonthlyReport, sampleRapportKpi, sampleTournee, sampleClient as client, sampleInvoice as invoice, sampleOrganization as organization, sampleQuote as quote } from '../src/lib/pdf/samples'
import { renderQuotePdfWithFonts } from '../src/lib/pdf/documents/quote'
import { renderChantierPdfWithFonts } from '../src/lib/pdf/documents/chantier'
import { renderMaintenanceInterventionPdfWithFonts } from '../src/lib/pdf/documents/maintenance-intervention'
import { renderMemberHoursReportPdfWithFonts } from '../src/lib/pdf/documents/member-hours-report'
import { renderMonthlyReportPdfWithFonts } from '../src/lib/pdf/documents/monthly-report'
import { renderRapportKpiPdfWithFonts } from '../src/lib/pdf/documents/rapport-kpi'
import { renderTourneePdfWithFonts } from '../src/lib/pdf/documents/tournee'
import { renderContractPdfWithFonts } from '../src/lib/pdf/documents/contract'
import { renderDgdPdfWithFonts } from '../src/lib/pdf/documents/dgd'
import { renderInvoicePdfWithFonts } from '../src/lib/pdf/documents/invoice'
import { loadFontBytes } from '../src/lib/pdf/engine/fonts'

const OUT_DIR = join(process.cwd(), '.scratch', 'pdf')
mkdirSync(OUT_DIR, { recursive: true })

async function main() {
  const fontBytes = await loadFontBytes('')

  console.log('Génération QuotePDF...')
  const quoteBuffer = await renderQuotePdfWithFonts({ quote, organization, client }, fontBytes)
  const quotePath = join(OUT_DIR, 'quote.pdf')
  writeFileSync(quotePath, quoteBuffer)
  console.log(`  -> ${quotePath} (${quoteBuffer.length} bytes)`)

  const base = quote.sections[0]
  const longQuote = { ...quote, sections: Array.from({ length: 10 }, (_, i) => ({ ...base, id: `s-${i}`, title: `Lot ${i + 1}`, items: base.items.map(item => ({ ...item, id: `${item.id}-${i}`, section_id: `s-${i}` })) })) }
  const longBuffer = await renderQuotePdfWithFonts({ quote: longQuote, organization, client }, fontBytes)
  writeFileSync(join(OUT_DIR, 'quote-long.pdf'), longBuffer)

  console.log('Génération InvoicePDF (situation de travaux)...')
  const invoiceBuffer = await renderInvoicePdfWithFonts({ invoice, organization }, fontBytes)
  const invoicePath = join(OUT_DIR, 'invoice.pdf')
  writeFileSync(invoicePath, invoiceBuffer)
  console.log(`  -> ${invoicePath} (${invoiceBuffer.length} bytes)`)

  writeFileSync(join(OUT_DIR, 'contract.pdf'), await renderContractPdfWithFonts(sampleContract, fontBytes))
  writeFileSync(join(OUT_DIR, 'dgd.pdf'), await renderDgdPdfWithFonts(sampleDgd, fontBytes))

  writeFileSync(join(OUT_DIR, 'chantier.pdf'), await renderChantierPdfWithFonts(sampleChantier, fontBytes))
  writeFileSync(join(OUT_DIR, 'monthly.pdf'), await renderMonthlyReportPdfWithFonts(sampleMonthlyReport, fontBytes))
  writeFileSync(join(OUT_DIR, 'intervention.pdf'), await renderMaintenanceInterventionPdfWithFonts(sampleIntervention, fontBytes))
  writeFileSync(join(OUT_DIR, 'hours.pdf'), await renderMemberHoursReportPdfWithFonts(sampleMemberHours, fontBytes))
  writeFileSync(join(OUT_DIR, 'tournee.pdf'), await renderTourneePdfWithFonts(sampleTournee, fontBytes))
  writeFileSync(join(OUT_DIR, 'kpi.pdf'), await renderRapportKpiPdfWithFonts(sampleRapportKpi, fontBytes))

  console.log('\nTerminé. Ouvrir les PDF dans .scratch/pdf/ pour inspection visuelle.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
