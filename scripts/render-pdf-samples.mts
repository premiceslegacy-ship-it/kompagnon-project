// Script de vérification locale des documents pdf-lib.
// Usage : npx tsx scripts/render-pdf-samples.mts [dossier] [--facturx]
// Écrit chaque document en version courte et longue dans .scratch/pdf/ (gitignoré)
// pour inspection visuelle (ex. : pdftoppm -png -r 110 .scratch/pdf/devis-court.pdf).
// --facturx : écrit aussi la facture courte avec son XML Factur-X intégré.
//
// Ne dépend pas de Supabase : les données viennent de src/lib/pdf/__fixtures__/.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadFontBytes } from '../src/lib/pdf/engine/fonts'
import { PDF_SAMPLES } from '../src/lib/pdf/__fixtures__/registry'
import { invoiceRecord, organization } from '../src/lib/pdf/__fixtures__/samples'
import { renderInvoicePdfWithFonts } from '../src/lib/pdf/documents/invoice'
import { generateFacturXml } from '../src/lib/pdf/facturx-xml'
import { embedFacturXml } from '../src/lib/pdf/facturx-embed'

const args = process.argv.slice(2)
const OUT_DIR = args.find(a => !a.startsWith('--')) ?? join(process.cwd(), '.scratch', 'pdf')
mkdirSync(OUT_DIR, { recursive: true })

async function main() {
  const fonts = await loadFontBytes('')
  for (const sample of PDF_SAMPLES) {
    const buffer = await sample.render(fonts)
    const path = join(OUT_DIR, `${sample.file}.pdf`)
    writeFileSync(path, buffer)
    console.log(`${sample.file.padEnd(32)} ${buffer.length} octets`)
  }
  if (args.includes('--facturx')) {
    const invoice = invoiceRecord(false)
    const pdf = await renderInvoicePdfWithFonts({ invoice, organization }, fonts)
    const out = await embedFacturXml(pdf, generateFacturXml(invoice, organization), { conformanceLevel: 'EN 16931', language: 'fr-FR' })
    writeFileSync(join(OUT_DIR, 'facture-facturx.pdf'), out)
    console.log(`facture-facturx                  ${out.length} octets`)
  }
  console.log(`\nTerminé : ${OUT_DIR}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
