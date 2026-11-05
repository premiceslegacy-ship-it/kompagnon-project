// Registre des échantillons : un document, une variante (courte ou longue), un rendu.
// Partagé par les tests de génération et scripts/render-pdf-samples.mts.
import type { FontBytes } from '../engine/fonts'
import { renderChantierPdfWithFonts } from '../documents/chantier'
import { renderContractPdfWithFonts } from '../documents/contract'
import { renderDgdPdfWithFonts } from '../documents/dgd'
import { renderInvoicePdfWithFonts } from '../documents/invoice'
import { renderMaintenanceInterventionPdfWithFonts } from '../documents/maintenance-intervention'
import { renderMemberHoursReportPdfWithFonts } from '../documents/member-hours-report'
import { renderMonthlyReportPdfWithFonts } from '../documents/monthly-report'
import { renderQuotePdfWithFonts } from '../documents/quote'
import { renderRapportKpiPdfWithFonts } from '../documents/rapport-kpi'
import { renderTourneePdfWithFonts } from '../documents/tournee'
import { SAMPLE_LOGO_PNG } from './logo'
import { invoiceRecord, organization, quoteClient, quoteRecord } from './samples'
import { chantierData, contractSnapshot, dgdData } from './samples-chantier'
import { maintenanceData, memberHoursData, monthlyReportData, rapportKpiData, tourneeData } from './samples-reports'

export type PdfSample = {
  /** Nom de fichier, sans extension. */
  file: string
  /** Document de src/lib/pdf/documents/. */
  document: string
  long: boolean
  /** Nombre de pages attendu au plus (une page en priorité pour les jeux courts). */
  maxPages?: number
  render: (fonts: FontBytes) => Promise<Buffer>
}

export const PDF_SAMPLES: PdfSample[] = [
  { file: 'devis-court', document: 'quote', long: false, maxPages: 1, render: f => renderQuotePdfWithFonts({ quote: quoteRecord(false), organization, client: quoteClient }, f) },
  { file: 'devis-long', document: 'quote', long: true, render: f => renderQuotePdfWithFonts({ quote: quoteRecord(true), organization: { ...organization, logo_url: SAMPLE_LOGO_PNG }, client: quoteClient }, f) },
  { file: 'facture-courte', document: 'invoice', long: false, maxPages: 1, render: f => renderInvoicePdfWithFonts({ invoice: invoiceRecord(false), organization: { ...organization, logo_url: SAMPLE_LOGO_PNG } }, f) },
  { file: 'facture-longue', document: 'invoice', long: true, render: f => renderInvoicePdfWithFonts({ invoice: invoiceRecord(true), organization }, f) },
  { file: 'facture-situation', document: 'invoice', long: false, maxPages: 1, render: f => renderInvoicePdfWithFonts({ invoice: invoiceRecord(false, 'situation'), organization }, f) },
  { file: 'contrat-court', document: 'contract', long: false, render: f => renderContractPdfWithFonts(contractSnapshot(false), f) },
  { file: 'contrat-long', document: 'contract', long: true, render: f => renderContractPdfWithFonts(contractSnapshot(true), f) },
  { file: 'dgd-court', document: 'dgd', long: false, maxPages: 1, render: f => renderDgdPdfWithFonts(dgdData(false), f) },
  { file: 'dgd-long', document: 'dgd', long: true, maxPages: 1, render: f => renderDgdPdfWithFonts(dgdData(true), f) },
  { file: 'chantier-court', document: 'chantier', long: false, maxPages: 1, render: f => renderChantierPdfWithFonts(chantierData(false), f) },
  { file: 'chantier-long', document: 'chantier', long: true, render: f => renderChantierPdfWithFonts(chantierData(true), f) },
  { file: 'rapport-mensuel-court', document: 'monthly-report', long: false, maxPages: 1, render: f => renderMonthlyReportPdfWithFonts(monthlyReportData(false), f) },
  { file: 'rapport-mensuel-long', document: 'monthly-report', long: true, render: f => renderMonthlyReportPdfWithFonts(monthlyReportData(true), f) },
  { file: 'intervention-courte', document: 'maintenance-intervention', long: false, maxPages: 1, render: f => renderMaintenanceInterventionPdfWithFonts(maintenanceData(false), f) },
  { file: 'intervention-longue', document: 'maintenance-intervention', long: true, render: f => renderMaintenanceInterventionPdfWithFonts(maintenanceData(true), f) },
  { file: 'heures-court', document: 'member-hours-report', long: false, maxPages: 1, render: f => renderMemberHoursReportPdfWithFonts(memberHoursData(false), f) },
  { file: 'heures-long', document: 'member-hours-report', long: true, maxPages: 1, render: f => renderMemberHoursReportPdfWithFonts(memberHoursData(true), f) },
  { file: 'tournee-courte', document: 'tournee', long: false, maxPages: 1, render: f => renderTourneePdfWithFonts(tourneeData(false), f) },
  { file: 'tournee-longue', document: 'tournee', long: true, maxPages: 1, render: f => renderTourneePdfWithFonts(tourneeData(true), f) },
  { file: 'indicateurs-mois', document: 'rapport-kpi', long: false, maxPages: 1, render: f => renderRapportKpiPdfWithFonts(rapportKpiData(false), f) },
  { file: 'indicateurs-annee', document: 'rapport-kpi', long: true, render: f => renderRapportKpiPdfWithFonts(rapportKpiData(true), f) },
]
