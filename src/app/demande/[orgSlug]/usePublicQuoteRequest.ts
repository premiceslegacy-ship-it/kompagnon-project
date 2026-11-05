'use client'

import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { submitQuoteRequest } from '@/lib/data/mutations/quote-requests'
import type { DimensionPricingMode } from '@/lib/catalog-pricing'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import {
  BLOCKED_EMAIL_DOMAINS,
  EMAIL_RE,
  buildDimensionSelection,
  formatDimensionSummary,
  getDimensionMode,
  groupByCategory,
} from './components/helpers'
import type {
  AttachmentMeta,
  PrestationLine,
  PublicLaborRate,
  PublicMaterial,
  PublicPrestationType,
  SelectedLaborRate,
  SelectedMaterial,
  SelectedPrestation,
} from './components/types'

export type PublicQuoteRequestInput = {
  orgSlug: string
  materials: PublicMaterial[]
  laborRates: PublicLaborRate[]
  prestationTypes: PublicPrestationType[]
  catalogContext: ResolvedCatalogContext
}

function scrollToTop() {
  if (typeof window === 'undefined') return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * Logique du formulaire public de demande de devis, sortie telle quelle de PublicFormClient :
 * étapes, sélection du catalogue (quantités, dimensions, précisions), pièce jointe, validation et envoi.
 */
export function usePublicQuoteRequest({ orgSlug, materials, laborRates, prestationTypes, catalogContext }: PublicQuoteRequestInput) {
  const [step, setStep] = useState(1)
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Honeypot anti-bot : ce champ doit rester vide
  const [honeypot, setHoneypot] = useState('')

  // Étape 1 - Identité
  const [clientType, setClientType] = useState<'particulier' | 'pro'>('particulier')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [siret, setSiret] = useState('')
  const [step1Error, setStep1Error] = useState<string | null>(null)

  // Étape 2 - Projet
  const [selectedMaterials, setSelectedMaterials] = useState<Record<string, SelectedMaterial>>({})
  const [selectedLaborRates, setSelectedLaborRates] = useState<Record<string, SelectedLaborRate>>({})
  const [selectedPrestations, setSelectedPrestations] = useState<Record<string, SelectedPrestation>>({})
  const [freeDescription, setFreeDescription] = useState('')
  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [step2Search, setStep2Search] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Étape 3 - Chantier
  const [chantierAddress, setChantierAddress] = useState('')
  const [chantierPostalCode, setChantierPostalCode] = useState('')
  const [chantierCity, setChantierCity] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [attachmentMeta, setAttachmentMeta] = useState<AttachmentMeta | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // ── Helpers matériaux ───────────────────────────────────────────────────────

  function toggleMaterial(m: PublicMaterial) {
    setSelectedMaterials(prev => {
      if (prev[m.id]) {
        const next = { ...prev }
        delete next[m.id]
        return next
      }
      const dimensionMode = getDimensionMode(m.dimension_pricing_mode, m.dimension_pricing_enabled)
      const selection = buildDimensionSelection({
        priceVariants: m.price_variants,
        mode: dimensionMode,
        fallbackUnit: m.unit,
        baseLengthM: m.base_length_m ?? null,
        baseWidthM: m.base_width_m ?? null,
        baseHeightM: m.base_height_m ?? null,
      })
      return {
        ...prev,
        [m.id]: {
          id: m.id,
          name: m.name,
          item_kind: m.item_kind,
          unit: selection.unit,
          quantity: dimensionMode === 'none' ? 1 : selection.quantity,
          base_length_m: m.base_length_m ?? null,
          base_width_m: m.base_width_m ?? null,
          base_height_m: m.base_height_m ?? null,
          dimension_pricing_mode: dimensionMode,
          dimension_pricing_enabled: m.dimension_pricing_enabled,
          dimension_schema: m.dimension_schema,
          price_variants: m.price_variants,
          length_m: selection.length_m,
          width_m: selection.width_m,
          height_m: selection.height_m,
          dimension_count: selection.dimension_count,
        },
      }
    })
  }

  function setMaterialQty(id: string, delta: number) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity: Math.max(1, prev[id].quantity + delta) } }
    })
  }

  function setMaterialExactQty(id: string, quantity: number) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity } }
    })
  }

  function setMaterialDimensionCount(id: string, dimensionCount: number) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: current.length_m,
        widthM: current.width_m,
        heightM: current.height_m,
        dimensionCount,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  function setMaterialDetails(id: string, details: string) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], details } }
    })
  }

  function toggleLaborRate(labor: PublicLaborRate) {
    setSelectedLaborRates(prev => {
      if (prev[labor.id]) {
        const next = { ...prev }
        delete next[labor.id]
        return next
      }
      return {
        ...prev,
        [labor.id]: {
          id: labor.id,
          designation: labor.designation,
          unit: labor.unit,
          quantity: 1,
        },
      }
    })
  }

  function setLaborQty(id: string, delta: number) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity: Math.max(1, prev[id].quantity + delta) } }
    })
  }

  function setLaborExactQty(id: string, quantity: number) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity } }
    })
  }

  function setLaborDetails(id: string, details: string) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], details } }
    })
  }

  function setMaterialLength(id: string, length_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: length_m,
        widthM: current.width_m,
        heightM: current.height_m,
        dimensionCount: current.dimension_count,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  function setMaterialWidth(id: string, width_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: current.length_m,
        widthM: width_m,
        heightM: current.height_m,
        dimensionCount: current.dimension_count,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  function setMaterialHeight(id: string, height_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: current.length_m,
        widthM: current.width_m,
        heightM: height_m,
        dimensionCount: current.dimension_count,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  // ── Helpers prestations ─────────────────────────────────────────────────────

  function togglePrestation(pt: PublicPrestationType) {
    setSelectedPrestations(prev => {
      if (prev[pt.id]) {
        const next = { ...prev }
        delete next[pt.id]
        return next
      }
      return {
        ...prev,
        [pt.id]: {
          id: pt.id,
          name: pt.name,
          category: pt.category,
          lines: pt.lines.map(l => {
            const dimensionMode = getDimensionMode(l.dimension_pricing_mode, l.dimension_pricing_enabled)
            const selection = buildDimensionSelection({
              priceVariants: l.price_variants,
              mode: dimensionMode,
              fallbackUnit: l.unit,
              baseLengthM: l.base_length_m,
              baseWidthM: l.base_width_m,
              baseHeightM: l.base_height_m,
            })
            return {
              ...l,
              isCustom: false,
              dimension_pricing_mode: dimensionMode,
              quantity: dimensionMode === 'none' ? l.quantity : selection.quantity,
              unit: selection.unit,
              dimension_schema: l.dimension_schema,
              price_variants: l.price_variants,
              length_m: selection.length_m,
              width_m: selection.width_m,
              height_m: selection.height_m,
              dimension_count: selection.dimension_count,
            }
          }),
        },
      }
    })
  }

  function setPrestationLineQty(prestId: string, lineId: string, delta: number) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l,
          ),
        },
      }
    })
  }

  function setPrestationLineExactQty(prestId: string, lineId: string, quantity: number) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, quantity } : l,
          ),
        },
      }
    })
  }

  function setPrestationLineDimensionCount(prestId: string, lineId: string, dimensionCount: number) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: l.length_m,
                    widthM: l.width_m,
                    heightM: l.height_m,
                    dimensionCount,
                  }),
                }
              : l,
          ),
        },
      }
    })
  }

  function setPrestationLineDetails(prestId: string, lineId: string, details: string) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, details } : l,
          ),
        },
      }
    })
  }

  function setPrestationLineLength(prestId: string, lineId: string, length_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: length_m,
                    widthM: l.width_m,
                    heightM: l.height_m,
                    dimensionCount: l.dimension_count,
                  }),
                }
              : l,
          ),
        },
      }
    })
  }

  function setPrestationLineWidth(prestId: string, lineId: string, width_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: l.length_m,
                    widthM: width_m,
                    heightM: l.height_m,
                    dimensionCount: l.dimension_count,
                  }),
                }
              : l,
          ),
        },
      }
    })
  }

  function setPrestationLineHeight(prestId: string, lineId: string, height_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: l.length_m,
                    widthM: l.width_m,
                    heightM: height_m,
                    dimensionCount: l.dimension_count,
                  }),
                }
              : l,
          ),
        },
      }
    })
  }

  function removePrestationLine(prestId: string, lineId: string) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.filter(l => l.id !== lineId),
        },
      }
    })
  }

  function addPrestationLine(prestId: string, line: PrestationLine) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: { ...prev[prestId], lines: [...prev[prestId].lines, line] },
      }
    })
  }

  // ── Accordéons catégories step 2 ───────────────────────────────────────────

  function toggleCategory(key: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Upload fichier ──────────────────────────────────────────────────────────

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError(null)
    if (file.size > 10 * 1024 * 1024) {
      setFileError('Le fichier ne doit pas dépasser 10 Mo.')
      e.target.value = ''
      return
    }
    setAttachmentFile(file)
    setAttachmentMeta(null)
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.set('org_slug', orgSlug)
      formData.set('_hp_website', honeypot)
      formData.set('file', file)
      const response = await fetch(`/api/public/quote-attachments?org_slug=${encodeURIComponent(orgSlug)}`, {
        method: 'POST',
        headers: { 'x-public-form-honeypot': honeypot },
        body: formData,
      })
      const result = await response.json() as { attachment?: AttachmentMeta; ignored?: boolean; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Erreur lors de l’upload.')
      if (result.ignored) return
      const attachment = result.attachment
      if (!attachment || typeof attachment.storage_path !== 'string' || typeof attachment.filename !== 'string'
        || !Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > 10 * 1024 * 1024
        || (attachment.content_type !== null && typeof attachment.content_type !== 'string')) {
        throw new Error('Réponse d’upload invalide.')
      }
      setAttachmentMeta(attachment)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Le fichier n’a pas pu être envoyé. Réessayez.')
      setAttachmentFile(null)
      setAttachmentMeta(null)
      e.target.value = ''
    } finally {
      setIsUploading(false)
    }
  }

  function removeAttachment() {
    setAttachmentFile(null)
    setAttachmentMeta(null)
    setFileError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Validation par étape ────────────────────────────────────────────────────

  function validateStep1(): boolean {
    if (!name.trim()) { setStep1Error('Indiquez votre nom.'); return false }
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setStep1Error('Indiquez une adresse email valide, par exemple nom@exemple.fr.')
      return false
    }
    const domain = trimmedEmail.split('@')[1]?.toLowerCase()
    if (domain && BLOCKED_EMAIL_DOMAINS.has(domain)) {
      setStep1Error('Les adresses email temporaires (yopmail, mailinator...) ne sont pas acceptées.')
      return false
    }
    if (clientType === 'pro' && !companyName.trim()) { setStep1Error('Indiquez le nom de l’entreprise.'); return false }
    setStep1Error(null)
    return true
  }

  function validateStep2(): boolean {
    const hasMat = Object.keys(selectedMaterials).length > 0
    const hasLabor = Object.keys(selectedLaborRates).length > 0
    const hasPresta = Object.keys(selectedPrestations).length > 0
    const hasDesc = freeDescription.trim().length > 0
    if (!hasMat && !hasLabor && !hasPresta && !hasDesc) {
      setStep2Error('Sélectionnez un élément ou décrivez votre besoin.')
      return false
    }

    const dimensionedMats = Object.values(selectedMaterials)
    const dimensionedLines = Object.values(selectedPrestations).flatMap(p => p.lines)
    const hasIncompleteDimensions = [...dimensionedMats, ...dimensionedLines].some(item => {
      const mode = getDimensionMode(item.dimension_pricing_mode, item.dimension_pricing_enabled)
      if (mode === 'none') return false
      if (!(item.length_m && item.length_m > 0)) return true
      if ((mode === 'area' || mode === 'volume') && !(item.width_m && item.width_m > 0)) return true
      if (mode === 'volume' && !(item.height_m && item.height_m > 0)) return true
      return false
    })
    if (hasIncompleteDimensions) {
      setStep2Error('Indiquez des dimensions supérieures à zéro (longueur, largeur, hauteur) pour chaque élément sélectionné.')
      return false
    }

    setStep2Error(null)
    return true
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep(s => s + 1)
    scrollToTop()
  }

  function goBack() {
    setStep(s => s - 1)
    scrollToTop()
  }

  // ── Soumission ──────────────────────────────────────────────────────────────

  function handleSubmit() {
    setSubmitError(null)
    if (isUploading) {
      setSubmitError('Le fichier est encore en cours d’envoi. Patientez quelques secondes avant d’envoyer.')
      return
    }
    const fd = new FormData()
    fd.set('org_slug', orgSlug)
    fd.set('_hp_website', honeypot) // honeypot : doit rester vide
    fd.set('name', name.trim())
    fd.set('email', email.trim())
    if (phone.trim()) fd.set('phone', phone.trim())

    // Infos pro
    const fullCompanyName = clientType === 'pro' && companyName.trim() ? companyName.trim() : ''
    if (fullCompanyName) fd.set('company_name', fullCompanyName)

    // Chantier
    if (chantierAddress.trim()) fd.set('chantier_address_line1', chantierAddress.trim())
    if (chantierPostalCode.trim()) fd.set('chantier_postal_code', chantierPostalCode.trim())
    if (chantierCity.trim()) fd.set('chantier_city', chantierCity.trim())

    // Fichier
    if (attachmentMeta) fd.set('attachments', JSON.stringify([attachmentMeta]))

    // Construction du catalogue et de la description
    const catalogItems: Array<{
      id: string; item_type: string; description: string; unit: string | null
      quantity: number
      length_m?: number | null
      width_m?: number | null
      height_m?: number | null
      dimension_count?: number
      dimension_pricing_mode?: DimensionPricingMode | null
      dimension_pricing_enabled?: boolean
      base_length_m?: number | null
      base_width_m?: number | null
      base_height_m?: number | null
      lines?: Array<{
        id: string
        item_type: 'material' | 'labor' | 'transport' | 'free'
        material_id: string | null
        labor_rate_id: string | null
        designation: string
        quantity: number
        unit: string
        unit_price_ht: number
        isCustom: boolean
        details?: string
        length_m?: number | null
        width_m?: number | null
        height_m?: number | null
        dimension_count?: number
        dimension_pricing_mode?: DimensionPricingMode | null
        dimension_pricing_enabled: boolean
        base_length_m: number | null
        base_width_m: number | null
        base_height_m: number | null
      }>
    }> = []

    const descParts: string[] = []

    // Matériaux
    const mats = Object.values(selectedMaterials)
    if (mats.length > 0) {
      for (const m of mats) {
        catalogItems.push({
          id: m.id,
          item_type: 'material',
          description: m.name,
          unit: m.unit,
          quantity: m.quantity,
          height_m: m.height_m ?? null,
          dimension_pricing_mode: m.dimension_pricing_mode,
          length_m: m.length_m ?? null,
          width_m: m.width_m ?? null,
          dimension_count: m.dimension_count ?? 1,
          dimension_pricing_enabled: m.dimension_pricing_enabled ?? false,
          base_length_m: m.base_length_m,
          base_width_m: m.base_width_m,
          base_height_m: m.base_height_m,
        })
      }
      descParts.push('Catalogue : ' + mats.map(m =>
        m.dimension_pricing_mode !== 'none'
          ? `${m.name} (${formatDimensionSummary(m.dimension_pricing_mode, m.length_m, m.width_m, m.height_m)} × ${m.dimension_count ?? 1})${m.details ? ` [${m.details}]` : ''}`
          : `${m.name} x ${m.quantity}${m.unit ? ' ' + m.unit : ''}${m.details ? ` [${m.details}]` : ''}`,
      ).join(', '))
    }

    // Opérations
    const labor = Object.values(selectedLaborRates)
    if (labor.length > 0) {
      for (const l of labor) {
        catalogItems.push({
          id: l.id,
          item_type: 'labor',
          description: l.designation,
          unit: l.unit,
          quantity: l.quantity,
        })
      }
      descParts.push('Opérations : ' + labor.map(l =>
        `${l.designation} x ${l.quantity}${l.unit ? ' ' + l.unit : ''}${l.details ? ` [${l.details}]` : ''}`,
      ).join(', '))
    }

    // Prestations
    const prestas = Object.values(selectedPrestations)
    if (prestas.length > 0) {
      for (const p of prestas) {
        catalogItems.push({ id: p.id, item_type: 'prestation', description: p.name, unit: null, quantity: 1, lines: p.lines as any })
      }
      descParts.push('Prestations : ' + prestas.map(p => {
        const linesSummary = p.lines.map(l =>
          l.dimension_pricing_mode !== 'none'
            ? `${l.designation} (${formatDimensionSummary(l.dimension_pricing_mode, l.length_m, l.width_m, l.height_m)} × ${l.dimension_count ?? 1})${l.details ? ` [${l.details}]` : ''}`
            : `${l.designation} x ${l.quantity} ${l.unit}${l.details ? ` [${l.details}]` : ''}`,
        ).join(', ')
        return linesSummary ? `${p.name} (${linesSummary})` : p.name
      }).join(' | '))
    }

    // SIRET dans la description si pro
    if (clientType === 'pro' && siret.trim()) {
      descParts.unshift(`[Professionnel] SIRET : ${siret.trim()}`)
    }

    // Notes complémentaires
    if (extraNotes.trim()) descParts.push('Notes : ' + extraNotes.trim())

    // Description libre
    if (freeDescription.trim()) descParts.push(freeDescription.trim())

    const description = descParts.join('\n\n')
    fd.set('description', description || 'Demande de devis')

    // Précisions libres envoyées à part (en plus de la description fusionnée
    // ci-dessus) : permet de générer des lignes de devis IA complémentaires
    // au catalogue sélectionné, sans reparser la description humaine.
    const freeformNotes = [freeDescription.trim(), extraNotes.trim()].filter(Boolean).join('\n\n')
    if (freeformNotes) fd.set('freeform_notes', freeformNotes)

    if (catalogItems.length > 0) {
      fd.set('type', 'catalog')
      fd.set('catalog_items', JSON.stringify(catalogItems))
    } else {
      fd.set('type', 'custom')
    }

    startTransition(async () => {
      const res = await submitQuoteRequest({ error: null, success: false }, fd)
      if (res.error) setSubmitError(res.error)
      else setSuccess(true)
    })
  }


  // ── Groupement matériaux par catégorie ──────────────────────────────────────

  const step2Q = step2Search.toLowerCase().trim()
  const articleMaterialGroups = groupByCategory(
    materials.filter(m => m.item_kind === 'article' && (!step2Q || m.name.toLowerCase().includes(step2Q))),
  )
  const serviceMaterialGroups = groupByCategory(
    materials.filter(m => m.item_kind === 'service' && (!step2Q || m.name.toLowerCase().includes(step2Q))),
  )
  const laborRateGroups = groupByCategory(
    laborRates.filter(l => !step2Q || l.designation.toLowerCase().includes(step2Q)),
  )
  const filteredPrestationGroups = groupByCategory(
    prestationTypes.filter(pt => !step2Q || pt.name.toLowerCase().includes(step2Q)),
  )
  const hasCatalog = materials.length > 0 || laborRates.length > 0 || prestationTypes.length > 0
  const selectionCount = Object.keys(selectedMaterials).length + Object.keys(selectedLaborRates).length + Object.keys(selectedPrestations).length

  // ── Récap ───────────────────────────────────────────────────────────────────

  const recapItems: Array<{ label: string; value: string }> = [
    { label: 'Nom', value: name },
    { label: 'Email', value: email },
    ...(phone ? [{ label: 'Téléphone', value: phone }] : []),
    ...(clientType === 'pro' && companyName ? [{ label: 'Entreprise', value: companyName }] : []),
    ...(clientType === 'pro' && siret ? [{ label: 'SIRET', value: siret }] : []),
    ...(Object.values(selectedMaterials).length > 0 ? [{
      label: 'Catalogue',
      value: Object.values(selectedMaterials).map(m =>
        m.dimension_pricing_mode !== 'none'
          ? `${m.name} (${formatDimensionSummary(m.dimension_pricing_mode, m.length_m, m.width_m, m.height_m)} × ${m.dimension_count ?? 1})${m.details ? ` [${m.details}]` : ''}`
          : `${m.name} × ${m.quantity}${m.details ? ` [${m.details}]` : ''}`,
      ).join(', '),
    }] : []),
    ...(Object.values(selectedLaborRates).length > 0 ? [{
      label: catalogContext.labelSet.service.plural,
      value: Object.values(selectedLaborRates).map(l =>
        `${l.designation} x ${l.quantity}${l.unit ? ' ' + l.unit : ''}${l.details ? ` [${l.details}]` : ''}`,
      ).join(', '),
    }] : []),
    ...(Object.values(selectedPrestations).length > 0 ? [{
      label: catalogContext.labelSet.bundleTemplate.plural,
      value: Object.values(selectedPrestations).map(p => {
        const hasDetails = p.lines.some(l => l.details)
        return p.name + (hasDetails ? ' (Avec précisions)' : '')
      }).join(', '),
    }] : []),
    ...(freeDescription ? [{ label: 'Description', value: freeDescription }] : []),
    ...([chantierAddress, chantierPostalCode, chantierCity].some(Boolean) ? [{
      label: 'Chantier',
      value: [chantierAddress, chantierPostalCode, chantierCity].filter(Boolean).join(', '),
    }] : []),
    ...(extraNotes ? [{ label: 'Notes', value: extraNotes }] : []),
    ...(attachmentFile ? [{ label: 'Fichier joint', value: attachmentFile.name }] : []),
  ]


  return {
    step, isPending, submitError, success, fileInputRef, honeypot, setHoneypot,
    clientType, setClientType, name, setName, email, setEmail, phone, setPhone,
    companyName, setCompanyName, siret, setSiret, step1Error,
    selectedMaterials, selectedPrestations, freeDescription, setFreeDescription, step2Error,
    step2Search, setStep2Search, expandedCategories, toggleCategory,
    chantierAddress, setChantierAddress, chantierPostalCode, setChantierPostalCode, chantierCity, setChantierCity,
    extraNotes, setExtraNotes, attachmentFile, isUploading, fileError, removeAttachment,
    toggleMaterial, setMaterialQty, setMaterialExactQty, setMaterialDimensionCount, setMaterialDetails,
    setMaterialLength, setMaterialWidth, setMaterialHeight,
    toggleLaborRate, setLaborQty, setLaborExactQty, setLaborDetails,
    togglePrestation, setPrestationLineQty, setPrestationLineExactQty, setPrestationLineDimensionCount,
    setPrestationLineDetails, setPrestationLineLength, setPrestationLineWidth, setPrestationLineHeight,
    removePrestationLine, addPrestationLine,
    handleFileChange, validateStep1, validateStep2, goNext, goBack, handleSubmit,
    step2Q, articleMaterialGroups, serviceMaterialGroups, laborRateGroups, filteredPrestationGroups,
    hasCatalog, selectionCount, recapItems,
  }
}

export type PublicQuoteRequest = ReturnType<typeof usePublicQuoteRequest>
