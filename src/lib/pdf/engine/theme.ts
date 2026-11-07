import { rgb, type RGB } from 'pdf-lib'
import { DS } from '@/lib/pdf/pdf-design-system'

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return rgb(r, g, b)
}

export const COLOR = {
  black: hexToRgb(DS.color.black),
  secondary: hexToRgb(DS.color.secondary),
  accent: hexToRgb(DS.color.accent),
  divider: hexToRgb(DS.color.divider),
  surface: hexToRgb(DS.color.surface),
  white: hexToRgb(DS.color.white),
  body: hexToRgb(DS.color.body),
  muted: hexToRgb(DS.color.muted),
  rule: hexToRgb(DS.color.rule),
  ruleStrong: hexToRgb(DS.color.ruleStrong),
  greenText: hexToRgb('#1B6E36'),
  greenSoft: hexToRgb('#E6F6EA'),
  amberText: hexToRgb('#8A4B00'),
  amberSoft: hexToRgb('#FFF0D6'),
  redText: hexToRgb('#B3261E'),
  redSoft: hexToRgb('#FDE7E7'),
  green: hexToRgb('#16A34A'),
  orange: hexToRgb('#EA580C'),
  gray: hexToRgb('#888888'),
}

export const SPACE = DS.space

export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: SPACE.page,
  footerHeight: 60,
  headerTop: 34,
}

export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2

// Colonnes de tableau devis/facture (mêmes largeurs que pdf-design-system.ts)
