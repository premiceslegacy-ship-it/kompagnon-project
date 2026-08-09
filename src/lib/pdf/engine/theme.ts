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
  green: hexToRgb('#16A34A'),
  orange: hexToRgb('#EA580C'),
  gray: hexToRgb('#888888'),
}

export const SIZE = DS.size
export const SPACE = DS.space

export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: SPACE.page,
  footerHeight: 50,
  headerTop: SPACE.xxl,
}

export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2

// Colonnes de tableau devis/facture (mêmes largeurs que pdf-design-system.ts)
export const COL = {
  qty: 35,
  unit: 30,
  pu: 65,
  vat: 40,
  total: 72,
}
export const COL_DESC_WIDTH = (withVat: boolean) =>
  CONTENT_WIDTH - COL.qty - COL.unit - COL.pu - COL.total - (withVat ? COL.vat : 0)
