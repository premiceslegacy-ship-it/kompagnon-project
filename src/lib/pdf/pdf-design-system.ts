// Atelier by Orsayn — PDF Design System v1.0
// Polices chargées via chemin absolu fs (server-side uniquement, compatible Cloudflare Workers)

import path from 'path'
import { Font, StyleSheet } from '@react-pdf/renderer'

let fontsRegistered = false

function fontPath(name: string): string {
  // process.cwd() = racine du projet en dev et en prod Workers
  return path.join(process.cwd(), 'public', 'fonts', name)
}

export function registerFonts() {
  if (fontsRegistered) return
  fontsRegistered = true

  Font.register({
    family: 'Inter',
    fonts: [
      { src: fontPath('inter-regular.woff'), fontWeight: 400 },
      { src: fontPath('inter-bold.woff'), fontWeight: 700 },
    ],
  })

  Font.register({
    family: 'PlusJakartaSans',
    fonts: [
      { src: fontPath('plus-jakarta-sans-bold.ttf'), fontWeight: 700 },
      { src: fontPath('plus-jakarta-sans-extrabold.ttf'), fontWeight: 800 },
    ],
  })

  // Désactiver le découpage automatique des mots (casse les montants)
  Font.registerHyphenationCallback(word => [word])
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export const DS = {
  color: {
    black:   '#000000',
    secondary: '#71717A',
    accent:  '#FF9F1C',
    divider: '#E4E4E7',
    surface: '#F9FAFB',
    white:   '#FFFFFF',
    body:    '#52525B',
    muted:   '#A1A1AA',
  },
  font: {
    heading: 'PlusJakartaSans',
    body:    'Inter',
  },
  size: {
    xxs:  6,
    xs:   7,
    sm:   8,
    base: 9,
    md:   10,
    lg:   12,
    xl:   14,
    xxl:  18,
    xxxl: 24,
  },
  space: {
    xs:  4,
    sm:  8,
    md:  12,
    lg:  16,
    xl:  24,
    xxl: 36,
    page: 45,
  },
}

// ─── Styles partagés ─────────────────────────────────────────────────────────

export function makePageStyles() {
  return StyleSheet.create({
    page: {
      fontFamily: DS.font.body,
      fontSize: DS.size.base,
      color: DS.color.body,
      backgroundColor: DS.color.white,
      paddingTop: DS.space.xxl,
      paddingBottom: 50,
      paddingHorizontal: DS.space.page,
    },

    // Header
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: DS.space.xl,
      paddingBottom: DS.space.xl,
      borderBottomWidth: 1,
      borderBottomColor: DS.color.divider,
    },
    logo: { width: 90, height: 45, objectFit: 'contain' },
    logoPlaceholder: {
      width: 90, height: 45,
      backgroundColor: DS.color.black,
      justifyContent: 'center',
      alignItems: 'center',
    },
    logoPlaceholderText: {
      color: DS.color.white,
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.lg,
    },
    companyBlock: { alignItems: 'flex-end', maxWidth: 210 },
    companyName: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.md,
      color: DS.color.black,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    companyDetail: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.secondary,
      textAlign: 'right',
      marginBottom: 1.5,
    },

    // Title block (sans bannière de couleur)
    titleBlock: {
      marginBottom: DS.space.xl,
      borderBottomWidth: 1,
      borderBottomColor: DS.color.black,
      paddingBottom: DS.space.md,
    },
    titleLabel: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.xxxl,
      color: DS.color.black,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    titleMeta: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.secondary,
      marginTop: 4,
    },
    titleAccentLine: {
      height: 3,
      backgroundColor: DS.color.accent,
      marginTop: DS.space.sm,
      width: 40,
    },

    // Address blocks
    addressRow: {
      flexDirection: 'row',
      gap: DS.space.md,
      marginBottom: DS.space.xl,
    },
    addressBlock: {
      flex: 1,
      padding: DS.space.md,
      backgroundColor: DS.color.surface,
    },
    addressLabel: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.xxs,
      color: DS.color.secondary,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: DS.space.sm,
    },
    addressName: {
      fontFamily: DS.font.heading,
      fontWeight: 700,
      fontSize: DS.size.md,
      color: DS.color.black,
      marginBottom: 4,
    },
    addressLine: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.secondary,
      marginBottom: 2,
    },

    // Table
    tableHeader: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: DS.color.black,
      paddingHorizontal: 0,
      paddingBottom: DS.space.sm,
      marginBottom: 0,
    },
    tableHeaderText: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.xxs,
      color: DS.color.black,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    sectionRow: {
      flexDirection: 'row',
      paddingVertical: DS.space.sm,
      marginTop: DS.space.sm,
      borderBottomWidth: 0.5,
      borderBottomColor: DS.color.divider,
    },
    sectionTitle: {
      fontFamily: DS.font.heading,
      fontWeight: 700,
      fontSize: DS.size.sm,
      color: DS.color.black,
    },
    itemRow: {
      flexDirection: 'row',
      paddingVertical: DS.space.md,
      borderBottomWidth: 0.5,
      borderBottomColor: '#F4F4F5',
    },
    itemText: {
      fontFamily: DS.font.body,
      fontSize: DS.size.sm,
      color: DS.color.body,
    },
    itemTextRight: {
      fontFamily: DS.font.body,
      fontSize: DS.size.sm,
      color: DS.color.body,
      textAlign: 'right',
    },
    itemTextBold: {
      fontFamily: DS.font.heading,
      fontWeight: 700,
      fontSize: DS.size.sm,
      color: DS.color.black,
    },

    // Colonnes table
    colDesc:  { flex: 4 },
    colQty:   { width: 35, textAlign: 'right' },
    colUnit:  { width: 30, textAlign: 'center' },
    colPu:    { width: 65, textAlign: 'right' },
    colVat:   { width: 40, textAlign: 'right' },
    colTotal: { width: 72, textAlign: 'right' },

    // Totals
    totalsContainer: { marginTop: DS.space.xl, alignItems: 'flex-end' },
    totalsBox: { width: 250 },
    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: DS.space.sm,
      borderBottomWidth: 0.5,
      borderBottomColor: DS.color.divider,
    },
    totalsLabel: {
      fontFamily: DS.font.body,
      fontSize: DS.size.sm,
      color: DS.color.secondary,
    },
    totalsValue: {
      fontFamily: DS.font.heading,
      fontWeight: 700,
      fontSize: DS.size.sm,
      color: DS.color.black,
      textAlign: 'right',
    },
    totalTtcRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: DS.space.md,
      paddingHorizontal: DS.space.md,
      marginTop: DS.space.sm,
      backgroundColor: DS.color.black,
    },
    totalTtcLabel: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.md,
      color: DS.color.white,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    totalTtcValue: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.md,
      color: DS.color.white,
    },
    vatExemptNotice: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.muted,
      fontStyle: 'italic',
      textAlign: 'right',
      marginTop: 4,
    },

    // Intro / notes box
    introBox: {
      marginBottom: DS.space.lg,
      paddingVertical: DS.space.md,
      paddingHorizontal: DS.space.md,
      borderLeftWidth: 2,
      borderLeftColor: DS.color.accent,
      backgroundColor: DS.color.surface,
    },
    introText: {
      fontFamily: DS.font.body,
      fontSize: DS.size.sm,
      color: DS.color.body,
      lineHeight: 1.6,
    },

    // Client request box (formulaire public)
    clientRequestBox: {
      marginBottom: DS.space.lg,
      paddingVertical: DS.space.md,
      paddingHorizontal: DS.space.md,
      borderWidth: 0.5,
      borderColor: DS.color.divider,
      backgroundColor: DS.color.surface,
    },
    clientRequestLabel: {
      fontFamily: DS.font.heading,
      fontWeight: 800,
      fontSize: DS.size.xxs,
      color: DS.color.secondary,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginBottom: DS.space.sm,
    },
    clientRequestText: {
      fontFamily: DS.font.body,
      fontSize: DS.size.sm,
      color: DS.color.body,
      lineHeight: 1.6,
    },

    // Bottom section (conditions + signature)
    bottomSection: {
      marginTop: DS.space.xl,
      flexDirection: 'row',
      gap: DS.space.lg,
    },
    conditionsBox: { flex: 1 },
    conditionsTitle: {
      fontFamily: DS.font.heading,
      fontWeight: 700,
      fontSize: DS.size.xs,
      color: DS.color.black,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: DS.space.xs,
      marginTop: DS.space.sm,
    },
    conditionsText: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.secondary,
      lineHeight: 1.5,
      marginBottom: 2,
    },
    signatureBox: {
      width: 190,
      borderWidth: 0.5,
      borderColor: DS.color.divider,
      padding: DS.space.md,
      minHeight: 70,
      justifyContent: 'flex-end',
    },
    signatureLabel: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.muted,
      textAlign: 'center',
    },

    // Footer
    footer: {
      position: 'absolute',
      bottom: 22,
      left: DS.space.page,
      right: DS.space.page,
      borderTopWidth: 0.5,
      borderTopColor: DS.color.divider,
      paddingTop: DS.space.xs,
    },
    footerText: {
      fontFamily: DS.font.body,
      fontSize: DS.size.xxs,
      color: DS.color.muted,
      textAlign: 'center',
      lineHeight: 1.5,
    },
    pageNumber: {
      position: 'absolute',
      bottom: 22,
      right: DS.space.page,
      fontFamily: DS.font.body,
      fontSize: DS.size.xs,
      color: DS.color.muted,
    },
  })
}
