export const FACTURX_FILENAME = 'factur-x.xml'
export const FACTURX_VERSION = '1.0'
export const FACTURX_XMP_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'

const FACTURX_LEVEL_MAP: Record<string, string> = {
  minimum: 'MINIMUM',
  basicwl: 'BASIC WL',
  basic: 'BASIC',
  en16931: 'EN 16931',
  extended: 'EXTENDED',
}

const FACTURX_GUIDELINE_MAP: Record<string, string> = {
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  'BASIC WL': 'urn:factur-x.eu:1p0:basicwl',
  BASIC: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  'EN 16931': 'urn:cen.eu:en16931:2017',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
}

function normalizeLevelKey(level: string | null | undefined): string {
  return (level ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function normalizeFacturxConformanceLevel(level: string | null | undefined): string {
  return FACTURX_LEVEL_MAP[normalizeLevelKey(level)] ?? 'EN 16931'
}

export function facturxGuidelineId(level: string | null | undefined): string {
  const normalizedLevel = normalizeFacturxConformanceLevel(level)
  return FACTURX_GUIDELINE_MAP[normalizedLevel] ?? FACTURX_GUIDELINE_MAP['EN 16931']
}
