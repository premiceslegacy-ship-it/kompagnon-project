import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'
import { APP_NAME } from '@/lib/brand'
import { registerFonts, DS, pdfText } from '@/lib/pdf/pdf-design-system'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'

registerFonts()

const fmtMin = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

const fmtDate = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`)
  return pdfText(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
}

const fmtTime = (time: string | null): string => {
  if (!time) return '-'
  const [h, m] = time.slice(0, 5).split(':')
  return `${h} h ${m}`
}

export type TourneePDFProps = {
  organization: {
    name: string
    email?: string | null
    phone?: string | null
    siret?: string | null
    logo_url?: string | null
    address_line1?: string | null
    postal_code?: string | null
    city?: string | null
  }
  slots: TourneeSlot[]
  date: string
  routeLabel: string
  totalSiteMin: number
  totalTravelMin: number
  departureAddress?: string | null
  departurePostalCode?: string | null
  departureCity?: string | null
}

const S = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 42,
    fontFamily: DS.font.body,
    fontSize: DS.size.base,
    color: DS.color.body,
    backgroundColor: DS.color.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 22,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  logo: { width: 88, height: 42, objectFit: 'contain' },
  logoPlaceholder: {
    width: 88,
    height: 42,
    backgroundColor: DS.color.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholderText: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.lg,
    fontWeight: 800,
    color: DS.color.white,
  },
  companyBlock: { alignItems: 'flex-end', maxWidth: 235 },
  companyName: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.md,
    fontWeight: 800,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'right',
  },
  companyDetail: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 2,
    textAlign: 'right',
  },
  titleBlock: {
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: 12,
  },
  title: {
    fontFamily: DS.font.heading,
    fontSize: 23,
    fontWeight: 800,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  titleMetaRow: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 6,
  },
  titleMeta: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
  },
  accentLine: {
    width: 42,
    height: 3,
    backgroundColor: DS.color.accent,
    marginTop: 9,
  },
  summaryBand: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: DS.color.surface,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
  },
  summaryValue: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xl,
    fontWeight: 800,
    color: DS.color.black,
  },
  summaryLabel: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xxs,
    color: DS.color.secondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  infoBox: {
    marginBottom: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: DS.color.surface,
    borderWidth: 0.5,
    borderColor: DS.color.divider,
  },
  infoTitle: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xxs,
    fontWeight: 800,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 5,
  },
  infoText: {
    fontFamily: DS.font.body,
    fontSize: DS.size.sm,
    color: DS.color.body,
    lineHeight: 1.45,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: 7,
  },
  th: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xxs,
    fontWeight: 800,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: DS.color.divider,
  },
  rowAlt: { backgroundColor: '#FCFCFD' },
  colNum: { width: 24, paddingRight: 4 },
  colSite: { flex: 2.1, paddingRight: 8 },
  colAddress: { flex: 2.4, paddingRight: 8 },
  colTime: { width: 58, paddingRight: 6 },
  colDuration: { width: 50, paddingRight: 6 },
  colTravel: { width: 48 },
  indexBadge: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: DS.color.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexBadgeText: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xxs,
    fontWeight: 800,
    color: DS.color.white,
  },
  cellStrong: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.sm,
    fontWeight: 700,
    color: DS.color.black,
    lineHeight: 1.35,
  },
  cellText: {
    fontFamily: DS.font.body,
    fontSize: DS.size.sm,
    color: DS.color.body,
    lineHeight: 1.35,
  },
  cellMuted: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    lineHeight: 1.35,
    marginTop: 2,
  },
  notesSection: {
    marginTop: 18,
  },
  sectionTitle: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xxs,
    fontWeight: 800,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  noteItem: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: DS.color.surface,
    marginBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
  },
  departureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: DS.color.surface,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
  },
  departureLabel: {
    fontFamily: DS.font.heading,
    fontSize: DS.size.xxs,
    fontWeight: 800,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  departureValue: {
    fontFamily: DS.font.body,
    fontSize: DS.size.sm,
    color: DS.color.body,
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 42,
    right: 42,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: DS.color.divider,
    paddingTop: 6,
  },
  footerText: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xxs,
    color: DS.color.muted,
    lineHeight: 1.35,
  },
})

function addressForSlot(slot: TourneeSlot): string {
  return pdfText([slot.chantier_address_line1, slot.chantier_postal_code, slot.chantier_city].filter(Boolean).join(', '))
}

export function TourneePDF({ organization, slots, date, routeLabel, totalSiteMin, totalTravelMin, departureAddress, departurePostalCode, departureCity }: TourneePDFProps) {
  const orgAddress = [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')
  const departureLabel = [departureAddress, departurePostalCode, departureCity].filter(Boolean).join(', ')
  const generatedAt = pdfText(new Date().toLocaleDateString('fr-FR'))
  const slotsWithNotes = slots.filter(s => s.notes)
  const firstStart = slots[0]?.start_time ?? null
  const lastEnd = [...slots].reverse().find(s => s.end_time)?.end_time ?? null

  return (
    <Document
      title={`Feuille de route - ${fmtDate(date)} - ${organization.name}`}
      author={organization.name}
      creator={APP_NAME}
    >
      <Page size="A4" style={S.page}>
        <View style={S.header} fixed>
          <View>
            {organization.logo_url ? (
              <Image style={S.logo} src={organization.logo_url} />
            ) : (
              <View style={S.logoPlaceholder}>
                <Text style={S.logoPlaceholderText}>{pdfText(organization.name.slice(0, 2).toUpperCase())}</Text>
              </View>
            )}
          </View>
          <View style={S.companyBlock}>
            <Text style={S.companyName}>{pdfText(organization.name)}</Text>
            {orgAddress && <Text style={S.companyDetail}>{pdfText(orgAddress)}</Text>}
            {organization.phone && <Text style={S.companyDetail}>Tél. : {pdfText(organization.phone)}</Text>}
            {organization.email && <Text style={S.companyDetail}>{pdfText(organization.email)}</Text>}
            {organization.siret && <Text style={S.companyDetail}>SIRET : {pdfText(organization.siret)}</Text>}
          </View>
        </View>

        <View style={S.titleBlock}>
          <Text style={S.title}>Feuille de route</Text>
          <View style={S.titleMetaRow}>
            <Text style={S.titleMeta}>Date : {fmtDate(date)}</Text>
            <Text style={S.titleMeta}>Tournée : {pdfText(routeLabel)}</Text>
          </View>
          <View style={S.accentLine} />
        </View>

        {departureLabel ? (
          <View style={S.departureRow} wrap={false}>
            <View>
              <Text style={S.departureLabel}>Point de départ</Text>
              <Text style={S.departureValue}>{pdfText(departureLabel)}</Text>
            </View>
          </View>
        ) : null}

        <View style={S.summaryBand} wrap={false}>
          <View style={S.summaryItem}>
            <Text style={S.summaryValue}>{slots.length}</Text>
            <Text style={S.summaryLabel}>Sites à visiter</Text>
          </View>
          <View style={S.summaryItem}>
            <Text style={S.summaryValue}>{totalSiteMin > 0 ? fmtMin(totalSiteMin) : '-'}</Text>
            <Text style={S.summaryLabel}>Temps sur site</Text>
          </View>
          <View style={S.summaryItem}>
            <Text style={S.summaryValue}>{totalTravelMin > 0 ? `~${fmtMin(totalTravelMin)}` : '-'}</Text>
            <Text style={S.summaryLabel}>Trajet estimé</Text>
          </View>
          <View style={S.summaryItem}>
            <Text style={S.summaryValue}>{firstStart ? fmtTime(firstStart) : '-'}</Text>
            <Text style={S.summaryLabel}>Premier passage</Text>
          </View>
        </View>

        <View style={S.infoBox} wrap={false}>
          <Text style={S.infoTitle}>Consignes d'utilisation</Text>
          <Text style={S.infoText}>
            Les temps de trajet indiqués sont des estimations basées sur la proximité géographique des codes postaux. En cas d'imprévu terrain, l'ordre de passage peut être adapté par l'intervenant. Les heures réellement effectuées doivent être pointées depuis l'espace personnel ou depuis la fiche chantier.
          </Text>
        </View>

        <View style={S.tableHeader} fixed>
          <Text style={[S.th, S.colNum]}>#</Text>
          <Text style={[S.th, S.colSite]}>Site</Text>
          <Text style={[S.th, S.colAddress]}>Adresse</Text>
          <Text style={[S.th, S.colTime]}>Horaire</Text>
          <Text style={[S.th, S.colDuration]}>Durée</Text>
          <Text style={[S.th, S.colTravel]}>Trajet</Text>
        </View>

        {slots.map((slot, index) => (
          <View key={slot.id} style={[S.row, index % 2 === 1 ? S.rowAlt : {}]} wrap={false}>
            <View style={S.colNum}>
              <View style={S.indexBadge}>
                <Text style={S.indexBadgeText}>{index + 1}</Text>
              </View>
            </View>
            <View style={S.colSite}>
              <Text style={S.cellStrong}>{pdfText(slot.chantier_title)}</Text>
              {slot.label && <Text style={S.cellMuted}>{pdfText(slot.label)}</Text>}
            </View>
            <View style={S.colAddress}>
              <Text style={S.cellText}>{addressForSlot(slot) || '-'}</Text>
            </View>
            <View style={S.colTime}>
              <Text style={S.cellText}>{fmtTime(slot.start_time)}</Text>
              {slot.end_time && <Text style={S.cellMuted}>fin {fmtTime(slot.end_time)}</Text>}
            </View>
            <View style={S.colDuration}>
              <Text style={S.cellText}>{slot.duration_min ? fmtMin(slot.duration_min) : '-'}</Text>
            </View>
            <View style={S.colTravel}>
              <Text style={S.cellText}>
                {slot.travel_from_prev_min != null ? `~${fmtMin(slot.travel_from_prev_min)}` : '-'}
              </Text>
            </View>
          </View>
        ))}

        {slotsWithNotes.length > 0 && (
          <View style={S.notesSection}>
            <Text style={S.sectionTitle}>Notes terrain</Text>
            {slotsWithNotes.map((slot, index) => (
              <View key={slot.id} style={S.noteItem} wrap={false}>
                <Text style={S.cellStrong}>Passage {slot.route_order ?? index + 1} - {pdfText(slot.chantier_title)}</Text>
                <Text style={S.cellText}>{pdfText(slot.notes)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={S.footer} fixed>
          <Text style={S.footerText}>
            Généré le {generatedAt}{lastEnd ? ` - Fin prévisionnelle : ${fmtTime(lastEnd)}` : ''}
          </Text>
          <Text style={S.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
