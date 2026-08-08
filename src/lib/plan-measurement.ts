export const PLAN_MEASUREMENT_RULES_VERSION = '2026-07-22.2'

export const PLAN_MEASUREMENT_TRADES = ['placo_isolation', 'peinture', 'sols', 'carrelage', 'menuiseries'] as const
export type PlanMeasurementTrade = typeof PLAN_MEASUREMENT_TRADES[number]
export type PlanProjectType = 'new' | 'renovation'
export type PlanWorkScope = 'create' | 'replace' | 'remove' | 'preserve'
export type MeasurementSourceKind = 'measured' | 'derived' | 'allowance'
export type MeasurementValidationStatus = 'pending' | 'validated' | 'excluded'

export type MeasurementEvidence = {
  label: string
  source: 'printed_dimension' | 'printed_area' | 'scale' | 'plan_label' | 'visible_symbol' | 'user_input' | 'assumption'
  value?: string | null
}

export type PlanMeasurementRoom = {
  id: string
  name: string
  kind: 'interior' | 'exterior'
  area_m2?: number | null
  perimeter_m?: number | null
  height_m?: number | null
  confidence?: number | null
  evidence: MeasurementEvidence[]
  assumptions: string[]
  warnings: string[]
}

export type PlanMeasurementOpening = {
  id: string
  roomId?: string | null
  roomName: string
  type: 'door' | 'window' | 'bay' | 'other'
  quantity: number
  width_m?: number | null
  height_m?: number | null
  confidence?: number | null
  evidence: MeasurementEvidence[]
  warnings: string[]
}

export type PlanMeasurementObservation = {
  id: string
  roomId?: string | null
  roomName: string
  type: 'fixture' | 'electrical_symbol' | 'plumbing_symbol' | 'equipment' | 'other'
  label: string
  quantity: number
  confidence?: number | null
  evidence: MeasurementEvidence[]
  warnings: string[]
}

export type PlanMeasurementSettings = {
  defaultHeightM: number
  wastePct: number
  studSpacingM: number
  paintCoats: number
  wallTileHeightM: number
}

export type PlanMeasurementScope = {
  projectType: PlanProjectType
  selectedTrades: PlanMeasurementTrade[]
  workScopes: Partial<Record<PlanMeasurementTrade, PlanWorkScope>>
}

export type PlanMeasurementItem = {
  id: string
  roomId?: string | null
  roomName: string
  tradeId: PlanMeasurementTrade
  trade: string
  designation: string
  quantity: number
  unit: string
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dim_quantity?: number
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume' | null
  confidence?: number | null
  assumptions: string[]
  warnings: string[]
  formula: string
  formulaVariables: Record<string, number>
  evidence: MeasurementEvidence[]
  sourceKind: MeasurementSourceKind
  validationStatus: MeasurementValidationStatus
  critical: boolean
  rulesVersion: string
}

export type PlanMeasurementResult = {
  id?: string | null
  title: string
  sourceName?: string | null
  scope: PlanMeasurementScope
  settings: PlanMeasurementSettings
  rooms: PlanMeasurementRoom[]
  openings: PlanMeasurementOpening[]
  observations: PlanMeasurementObservation[]
  items: PlanMeasurementItem[]
  globalWarnings: string[]
  scale: {
    detected: boolean
    value?: string | null
    confidence?: number | null
    needsCalibration: boolean
    evidence: MeasurementEvidence[]
    assumptions: string[]
  }
  needsCalibration: boolean
  rulesVersion: string
  processingMs?: number | null
  model?: string | null
}

export const DEFAULT_MEASUREMENT_SETTINGS: PlanMeasurementSettings = {
  defaultHeightM: 2.5,
  wastePct: 8,
  studSpacingM: 0.6,
  paintCoats: 2,
  wallTileHeightM: 2,
}

export const MEASUREMENT_TRADE_LABELS: Record<PlanMeasurementTrade, string> = {
  placo_isolation: 'Placo / isolation',
  peinture: 'Peinture',
  sols: 'Sols',
  carrelage: 'Carrelage',
  menuiseries: 'Menuiseries',
}

export function inferMeasurementTrades(activityIds: string[], sector: string | null | undefined): PlanMeasurementTrade[] {
  const haystack = `${activityIds.join(' ')} ${sector ?? ''}`.toLowerCase()
  const inferred: PlanMeasurementTrade[] = []
  if (/menuiser/.test(haystack)) inferred.push('menuiseries')
  if (/peinture/.test(haystack)) inferred.push('peinture')
  if (/carrelage/.test(haystack)) inferred.push('carrelage')
  if (/renovation|rénovation|btp/.test(haystack)) inferred.push('placo_isolation', 'peinture', 'sols', 'carrelage', 'menuiseries')
  const defaults: PlanMeasurementTrade[] = ['placo_isolation']
  return [...new Set(inferred.length ? inferred : defaults)]
}

const ALLOWED_FORMULA_VARIABLES = new Set(['L', 'W', 'H', 'N', 'A', 'P', 'O', 'waste', 'spacing', 'coats', 'quantity'])

function tokenizeFormula(expression: string): string[] {
  const compact = expression.replace(/\s+/g, '')
  const tokens = compact.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[()+\-*/]/g) ?? []
  if (!compact || tokens.join('') !== compact) throw new Error('Formule invalide')
  return tokens
}

export function getFormulaVariableNames(expression: string): string[] {
  return [...new Set(tokenizeFormula(expression).filter(token => /^[A-Za-z_]/.test(token)))]
}

export function evaluateMeasurementFormula(expression: string, variables: Record<string, number>): number {
  const names = getFormulaVariableNames(expression)
  const unknown = names.find(name => !ALLOWED_FORMULA_VARIABLES.has(name))
  if (unknown) throw new Error(`Variable inconnue : ${unknown}`)
  const missing = names.find(name => !Number.isFinite(variables[name]))
  if (missing) throw new Error(`Variable manquante : ${missing}`)

  const tokens = tokenizeFormula(expression)
  let index = 0
  const peek = () => tokens[index]
  const next = () => tokens[index++]

  function parseFactor(): number {
    const token = next()
    if (token == null) throw new Error('Formule incomplète')
    if (token === '+') return parseFactor()
    if (token === '-') return -parseFactor()
    if (token === '(') {
      const value = parseExpression()
      if (next() !== ')') throw new Error('Parenthèse manquante')
      return value
    }
    if (/^\d/.test(token)) return Number(token.replace(',', '.'))
    if (/^[A-Za-z_]/.test(token)) return variables[token]
    throw new Error('Formule invalide')
  }

  function parseTerm(): number {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const rhs = parseFactor()
      if (op === '*') value *= rhs
      else {
        if (rhs === 0) throw new Error('Division par zéro')
        value /= rhs
      }
    }
    return value
  }

  function parseExpression(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  const result = parseExpression()
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Formule invalide')
  return Math.max(0, Math.round(result * 100) / 100)
}

function openingArea(opening: PlanMeasurementOpening): number {
  if (opening.width_m == null || opening.height_m == null) return 0
  return opening.width_m * opening.height_m * Math.max(1, opening.quantity)
}

function openingsWidth(openings: PlanMeasurementOpening[]): number {
  return openings.reduce((sum, opening) => sum + (opening.width_m ?? 0) * Math.max(1, opening.quantity), 0)
}

const PERIMETER_SHAPE_FACTOR = 1.1

export function deriveApproxPerimeter(areaM2: number): number {
  return Math.round(4 * Math.sqrt(Math.max(areaM2, 0)) * PERIMETER_SHAPE_FACTOR * 100) / 100
}

const PERIMETER_ASSUMPTION = 'Périmètre estimé depuis la surface (pièce supposée proche du carré). À vérifier avec les cotes réelles.'

function resolvePerimeter(room: PlanMeasurementRoom): { value: number; derived: boolean } | null {
  if (room.perimeter_m != null && room.perimeter_m > 0) return { value: room.perimeter_m, derived: false }
  if (room.area_m2 != null && room.area_m2 > 0) return { value: deriveApproxPerimeter(room.area_m2), derived: true }
  return null
}

function confidenceOf(room: PlanMeasurementRoom, sourceKind: MeasurementSourceKind): number | null {
  if (room.confidence == null) return null
  return Math.max(0, Math.min(1, room.confidence - (sourceKind === 'derived' ? 0.08 : sourceKind === 'allowance' ? 0.2 : 0)))
}

function makeItem(input: Omit<PlanMeasurementItem, 'quantity' | 'rulesVersion'>): PlanMeasurementItem {
  return {
    ...input,
    quantity: evaluateMeasurementFormula(input.formula, input.formulaVariables),
    rulesVersion: PLAN_MEASUREMENT_RULES_VERSION,
  }
}

function tradeScopeLabel(scope: PlanWorkScope): string {
  if (scope === 'create') return 'Création'
  if (scope === 'replace') return 'Remplacement'
  if (scope === 'remove') return 'Dépose'
  return 'Conservation'
}

export function buildMeasurementItems(input: {
  rooms: PlanMeasurementRoom[]
  openings: PlanMeasurementOpening[]
  scope: PlanMeasurementScope
  settings: PlanMeasurementSettings
}): PlanMeasurementItem[] {
  const { rooms, openings, scope, settings } = input
  const waste = settings.wastePct / 100
  const result: PlanMeasurementItem[] = []

  for (const tradeId of scope.selectedTrades) {
    const workScope = scope.workScopes[tradeId] ?? (scope.projectType === 'new' ? 'create' : 'replace')
    if (workScope === 'preserve') continue
    const trade = MEASUREMENT_TRADE_LABELS[tradeId]
    const scopeAssumption = `${tradeScopeLabel(workScope)} sélectionnée par l’utilisateur.`

    if (tradeId === 'menuiseries') {
      for (const opening of openings) {
        const hasDimensions = opening.width_m != null && opening.height_m != null
        result.push(makeItem({
          id: `menuiseries:${opening.id}`,
          roomId: opening.roomId ?? null,
          roomName: opening.roomName,
          tradeId,
          trade,
          designation: `${tradeScopeLabel(workScope)} ${opening.type === 'door' ? 'porte' : opening.type === 'window' ? 'fenêtre' : opening.type === 'bay' ? 'baie vitrée' : 'ouverture'}`,
          unit: 'u',
          length_m: opening.width_m ?? null,
          width_m: opening.height_m ?? null,
          height_m: null,
          dim_quantity: opening.quantity,
          dimension_pricing_mode: 'none',
          confidence: opening.confidence ?? null,
          assumptions: [scopeAssumption],
          warnings: [...opening.warnings, ...(!hasDimensions ? ['Dimensions de l’ouverture à confirmer.'] : [])],
          formula: 'N',
          formulaVariables: { N: Math.max(1, opening.quantity) },
          evidence: opening.evidence,
          sourceKind: 'measured',
          validationStatus: 'pending',
          critical: !hasDimensions || (opening.confidence ?? 0) < 0.65,
        }))
      }
      continue
    }

    for (const room of rooms.filter(candidate => candidate.kind === 'interior')) {
      const roomOpenings = openings.filter(opening => opening.roomId === room.id || opening.roomName === room.name)
      const O = roomOpenings.reduce((sum, opening) => sum + openingArea(opening), 0)
      const doorWidth = openingsWidth(roomOpenings.filter(opening => opening.type === 'door'))
      const H = room.height_m ?? settings.defaultHeightM
      const hasArea = room.area_m2 != null && room.area_m2 > 0
      const perimeterInfo = resolvePerimeter(room)
      const P = perimeterInfo?.value ?? 0
      const perimeterDerived = perimeterInfo?.derived ?? false
      const commonWarnings = [...room.warnings]
      if (room.height_m == null) commonWarnings.push(`Hauteur ${settings.defaultHeightM.toFixed(2)} m utilisée par défaut.`)
      const wallWarnings = perimeterDerived ? [...commonWarnings, PERIMETER_ASSUMPTION] : commonWarnings
      const wallEvidence = perimeterDerived
        ? [...room.evidence, { label: PERIMETER_ASSUMPTION, source: 'assumption' as const, value: `P≈${P.toFixed(2)}m` }]
        : room.evidence
      const wallSourceKind: MeasurementSourceKind = perimeterDerived ? 'allowance' : 'derived'
      const wallConfidence = perimeterDerived ? confidenceOf(room, 'allowance') : confidenceOf(room, 'derived')
      const wallCritical = perimeterDerived || (room.confidence ?? 0) < 0.65

      if (tradeId === 'placo_isolation' && hasArea) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:ceiling`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} plafond BA13`, unit: 'm²',
          dimension_pricing_mode: 'area', confidence: confidenceOf(room, 'derived'),
          assumptions: [scopeAssumption, 'Surface du plafond assimilée à la surface de la pièce.'], warnings: commonWarnings,
          formula: 'A * (1 + waste)', formulaVariables: { A: room.area_m2!, waste }, evidence: room.evidence,
          sourceKind: 'derived', validationStatus: 'pending', critical: (room.confidence ?? 0) < 0.65,
        }))
      }
      if (tradeId === 'placo_isolation' && perimeterInfo) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:lining`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} doublage mural`, unit: 'm²', height_m: H,
          dimension_pricing_mode: 'area', confidence: wallConfidence,
          assumptions: [scopeAssumption, 'Doublage calculé sur tout le périmètre de la pièce.'],
          warnings: [...wallWarnings, 'Les murs mitoyens peuvent être comptés dans deux pièces : valider le périmètre réellement traité.'],
          formula: '(P * H - O) * (1 + waste)', formulaVariables: { P, H, O, waste }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: room.height_m == null || wallCritical,
        }))
        if (workScope !== 'remove') {
          result.push(makeItem({
            id: `${tradeId}:${room.id}:insulation`, roomId: room.id, roomName: room.name, tradeId, trade,
            designation: 'Isolation du doublage', unit: 'm²', height_m: H, dimension_pricing_mode: 'area',
            confidence: wallConfidence, assumptions: [scopeAssumption, 'Isolation calculée sur la même surface nette que le doublage.'], warnings: wallWarnings,
            formula: '(P * H - O) * (1 + waste)', formulaVariables: { P, H, O, waste }, evidence: wallEvidence,
            sourceKind: wallSourceKind, validationStatus: 'pending', critical: room.height_m == null || wallCritical,
          }))
          result.push(makeItem({
          id: `${tradeId}:${room.id}:rails`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: 'Rails périphériques', unit: 'ml', dimension_pricing_mode: 'linear',
          confidence: wallConfidence, assumptions: [scopeAssumption, 'Un rail haut et un rail bas.'], warnings: wallWarnings,
          formula: 'P * 2 * (1 + waste)', formulaVariables: { P, waste }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: wallCritical,
          }))
          result.push(makeItem({
          id: `${tradeId}:${room.id}:studs`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: 'Montants', unit: 'u', dimension_pricing_mode: 'none',
          confidence: wallConfidence, assumptions: [scopeAssumption, `Entraxe ${settings.studSpacingM.toFixed(2)} m.`], warnings: wallWarnings,
          formula: 'P / spacing + N', formulaVariables: { P, spacing: settings.studSpacingM, N: 1 }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: settings.studSpacingM <= 0 || wallCritical,
          }))
        }
      }

      if (tradeId === 'peinture' && hasArea) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:ceiling`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} peinture plafond`, unit: 'm²', dimension_pricing_mode: 'area',
          confidence: confidenceOf(room, 'derived'), assumptions: [scopeAssumption, `${settings.paintCoats} couche(s).`], warnings: commonWarnings,
          formula: 'A * coats', formulaVariables: { A: room.area_m2!, coats: settings.paintCoats }, evidence: room.evidence,
          sourceKind: 'derived', validationStatus: 'pending', critical: (room.confidence ?? 0) < 0.65,
        }))
      }
      if (tradeId === 'peinture' && perimeterInfo) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:walls`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} peinture murs`, unit: 'm²', height_m: H, dimension_pricing_mode: 'area',
          confidence: wallConfidence, assumptions: [scopeAssumption, `${settings.paintCoats} couche(s), ouvertures cotées déduites.`], warnings: wallWarnings,
          formula: '(P * H - O) * coats', formulaVariables: { P, H, O, coats: settings.paintCoats }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: room.height_m == null || wallCritical,
        }))
      }

      if ((tradeId === 'sols' || tradeId === 'carrelage') && hasArea) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:floor`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} ${tradeId === 'carrelage' ? 'carrelage au sol' : 'revêtement de sol'}`,
          unit: 'm²', dimension_pricing_mode: 'area', confidence: confidenceOf(room, 'derived'),
          assumptions: [scopeAssumption], warnings: commonWarnings,
          formula: 'A * (1 + waste)', formulaVariables: { A: room.area_m2!, waste }, evidence: room.evidence,
          sourceKind: 'derived', validationStatus: 'pending', critical: (room.confidence ?? 0) < 0.65,
        }))
      }
      if ((tradeId === 'sols' || tradeId === 'carrelage') && perimeterInfo) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:skirting`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: tradeId === 'carrelage' ? 'Plinthes carrelées' : 'Plinthes', unit: 'ml', dimension_pricing_mode: 'linear',
          confidence: wallConfidence, assumptions: [scopeAssumption, 'Largeur des portes cotées déduite.'], warnings: wallWarnings,
          formula: '(P - O) * (1 + waste)', formulaVariables: { P, O: doorWidth, waste }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: wallCritical,
        }))
      }
      if (tradeId === 'carrelage' && perimeterInfo && /sdb|bain|bath|douche|wc/i.test(room.name)) {
        result.push(makeItem({
          id: `${tradeId}:${room.id}:wall-tile`, roomId: room.id, roomName: room.name, tradeId, trade,
          designation: `${tradeScopeLabel(workScope)} faïence murale`, unit: 'm²', height_m: settings.wallTileHeightM, dimension_pricing_mode: 'area',
          confidence: wallConfidence, assumptions: [scopeAssumption, `Hauteur de faïence ${settings.wallTileHeightM.toFixed(2)} m, ouvertures cotées déduites.`], warnings: wallWarnings,
          formula: '(P * H - O) * (1 + waste)', formulaVariables: { P, H: settings.wallTileHeightM, O, waste }, evidence: wallEvidence,
          sourceKind: wallSourceKind, validationStatus: 'pending', critical: wallCritical,
        }))
      }
    }
  }

  return result.filter(item => item.quantity > 0)
}

export function hasBlockingMeasurementIssues(measurement: PlanMeasurementResult): boolean {
  if (measurement.needsCalibration) return true
  return measurement.items.some(item => {
    if (item.validationStatus === 'excluded') return false
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return true
    try {
      const calculated = evaluateMeasurementFormula(item.formula, item.formulaVariables)
      if (Math.abs(calculated - item.quantity) > 0.01) return true
    } catch {
      return true
    }
    return item.validationStatus === 'pending' && (item.critical || item.sourceKind === 'allowance' || (item.confidence ?? 1) < 0.65)
  })
}
