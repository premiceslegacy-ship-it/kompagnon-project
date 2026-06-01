import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type React from 'react'

type Organization = {
  name: string
  logo_url?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

type Client = {
  company_name?: string | null
  first_name?: string | null
  last_name?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
}

type Intervention = {
  id: string
  date_intervention: string
  statut: string
  start_time: string | null
  end_time: string | null
  duration_hours: number | null
  rapport: string | null
  observations: string | null
  billable_notes: string | null
  cost_parts_ht: number | null
  cost_travel_ht: number | null
  cost_other_ht: number | null
  billable_amount_ht: number | null
  intervenant?: { prenom?: string | null; name?: string | null } | null
  intervenant_profile?: { full_name?: string | null; email?: string | null } | null
  invoice?: { number?: string | null; status?: string | null } | null
  contract?: {
    title: string
    frequence: string
    site_name?: string | null
    site_contact_name?: string | null
    site_contact_email?: string | null
    site_contact_phone?: string | null
    site_address_line1?: string | null
    site_postal_code?: string | null
    site_city?: string | null
    equipements: Array<{ nom: string; ref?: string; localisation?: string }>
    client?: Client | null
    chantier?: { title: string; address_line1?: string | null; postal_code?: string | null; city?: string | null } | null
  } | null
}

export type MaintenanceReportPhoto = {
  id: string
  url: string
  title: string | null
  caption: string | null
}

export default function MaintenanceInterventionPDF({
  intervention,
  organization,
  reportPhotos = [],
}: {
  intervention: Intervention
  organization: Organization
  reportPhotos?: MaintenanceReportPhoto[]
}) {
  const client = intervention.contract?.client
  const contract = intervention.contract
  const chantier = contract?.chantier
  const clientName = client
    ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client'
    : 'Client'
  const intervenantName = intervention.intervenant_profile?.full_name
    || [intervention.intervenant?.prenom, intervention.intervenant?.name].filter(Boolean).join(' ')
    || 'Non renseigné'

  return (
    <Document title={`Rapport d'intervention - ${intervention.contract?.title ?? intervention.id}`} author={organization.name} creator="Orsayn" language="fr-FR">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.orgBlock}>
            {organization.logo_url ? (
              <Image src={organization.logo_url} style={styles.logo} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>{organization.name.slice(0, 2).toUpperCase()}</Text>
              </View>
            )}
            <View>
              <Text style={styles.orgName}>{organization.name}</Text>
              <Text style={styles.muted}>{[organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')}</Text>
              <Text style={styles.muted}>{[organization.email, organization.phone].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Rapport d'intervention</Text>
          </View>
        </View>

        <Text style={styles.title}>{intervention.contract?.title ?? "Intervention d'entretien"}</Text>

        <View style={styles.grid}>
          <Info label="Client" value={clientName} />
          <Info label="Site" value={contract?.site_name ?? chantier?.title ?? intervention.contract?.title ?? '-'} />
          <Info label="Adresse" value={[contract?.site_address_line1 ?? chantier?.address_line1 ?? client?.address_line1, contract?.site_postal_code ?? chantier?.postal_code ?? client?.postal_code, contract?.site_city ?? chantier?.city ?? client?.city].filter(Boolean).join(', ') || '-'} />
          <Info label="Date" value={formatDate(intervention.date_intervention)} />
          <Info label="Intervenant" value={intervenantName} />
          <Info label="Horaires" value={formatTimes(intervention)} />
          <Info label="Contact site" value={[contract?.site_contact_name, contract?.site_contact_phone, contract?.site_contact_email].filter(Boolean).join(' · ') || '-'} />
        </View>

        {intervention.contract?.equipements?.length ? (
          <Section title="Équipements">
            {intervention.contract.equipements.map((eq, idx) => (
              <Text key={idx} style={styles.text}>
                {eq.nom}{eq.ref ? ` · ${eq.ref}` : ''}{eq.localisation ? ` · ${eq.localisation}` : ''}
              </Text>
            ))}
          </Section>
        ) : null}

        <Section title="Travaux réalisés">
          <Text style={styles.text}>{intervention.rapport || '-'}</Text>
        </Section>

        <Section title="Observations et recommandations">
          <Text style={styles.text}>{intervention.observations || '-'}</Text>
        </Section>

        {reportPhotos.length > 0 ? (
          <Section title={`Photos de l'intervention (${reportPhotos.length})`}>
            <View style={styles.photoGrid}>
              {reportPhotos.map((photo, i) => (
                <View key={photo.id} style={styles.photoCell} wrap={false}>
                  <Text style={styles.photoLabel}>{photo.title ?? `Photo ${i + 1}`}</Text>
                  <Image src={photo.url} style={styles.photoImg} />
                  {photo.caption ? <Text style={styles.photoCaption}>{photo.caption}</Text> : null}
                </View>
              ))}
            </View>
          </Section>
        ) : null}
      </Page>
    </Document>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')
}

function formatTimes(intervention: Intervention) {
  const parts = []
  if (intervention.start_time) parts.push(intervention.start_time.slice(0, 5))
  if (intervention.end_time) parts.push(intervention.end_time.slice(0, 5))
  const range = parts.length ? parts.join(' - ') : '-'
  return intervention.duration_hours ? `${range} · ${intervention.duration_hours}h` : range
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: '#111827', fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 24, marginBottom: 28, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  orgBlock: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  logo: { width: 44, height: 44, objectFit: 'contain' },
  logoPlaceholder: { width: 44, height: 44, backgroundColor: '#111827', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logoPlaceholderText: { color: '#ffffff', fontWeight: 700, fontSize: 12 },
  orgName: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  muted: { color: '#6b7280', fontSize: 9, marginTop: 2 },
  badge: { borderWidth: 1, borderColor: '#111827', paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' },
  badgeText: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  info: { width: '31.5%', borderWidth: 1, borderColor: '#e5e7eb', padding: 8, minHeight: 48 },
  infoLabel: { color: '#6b7280', fontSize: 8, marginBottom: 4, textTransform: 'uppercase' },
  infoValue: { fontSize: 10, fontWeight: 600 },
  section: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  text: { fontSize: 10, lineHeight: 1.5, marginBottom: 3 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  photoCell: { width: '47%', marginBottom: 10 },
  photoLabel: { fontSize: 9, fontWeight: 700, textAlign: 'center', marginBottom: 5 },
  photoImg: { width: '100%', height: 150, objectFit: 'cover', borderRadius: 4 },
  photoCaption: { fontSize: 8, color: '#6b7280', textAlign: 'center', lineHeight: 1.4, marginTop: 5 },
})
