'use client'

import { useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { submitQuoteRequest } from '@/lib/data/mutations/quote-requests'
import type { DimensionPricingMode } from '@/lib/catalog-pricing'
import {
  Building2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Loader2, Paperclip, Search, ShieldCheck, User, X,
} from 'lucide-react'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import styles from './demande.module.css'
import { ProgressBar } from './components/ProgressBar'
import { MaterialCard } from './components/MaterialCard'
import { PrestationCard } from './components/PrestationCard'
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

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  orgSlug: string
  orgName: string
  logoUrl: string | null
  welcomeMessage: string | null
  materials: PublicMaterial[]
  laborRates: PublicLaborRate[]
  prestationTypes: PublicPrestationType[]
  customModeEnabled: boolean
  catalogContext: ResolvedCatalogContext
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function PublicFormClient({
  orgSlug, orgName, logoUrl, welcomeMessage,
  materials, laborRates, prestationTypes, customModeEnabled, catalogContext,
}: Props) {
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
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [attachmentMeta, setAttachmentMeta] = useState<AttachmentMeta | null>(null)
  const [isUploading, setIsUploading] = useState(false)

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      alert('Le fichier ne doit pas dépasser 10 Mo.')
      return
    }
    setAttachmentFile(file)
    setIsUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `quote-requests/${orgSlug}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { data, error } = await supabase.storage.from('quote-attachments').upload(path, file, { upsert: false })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('quote-attachments').getPublicUrl(data.path)
      setAttachmentUrl(urlData.publicUrl)
      setAttachmentMeta({
        storage_path: data.path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        public_url: urlData.publicUrl,
      })
    } catch {
      alert('Erreur lors de l\'upload. Vous pouvez continuer sans fichier joint.')
      setAttachmentFile(null)
      setAttachmentUrl(null)
      setAttachmentMeta(null)
    } finally {
      setIsUploading(false)
    }
  }

  // ── Validation par étape ────────────────────────────────────────────────────

  function validateStep1(): boolean {
    if (!name.trim()) { setStep1Error('Veuillez renseigner votre nom.'); return false }
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setStep1Error('Veuillez renseigner un email valide.')
      return false
    }
    const domain = trimmedEmail.split('@')[1]?.toLowerCase()
    if (domain && BLOCKED_EMAIL_DOMAINS.has(domain)) {
      setStep1Error('Les adresses email temporaires (yopmail, mailinator...) ne sont pas acceptées.')
      return false
    }
    if (clientType === 'pro' && !companyName.trim()) { setStep1Error('Veuillez renseigner le nom de votre entreprise.'); return false }
    setStep1Error(null)
    return true
  }

  function validateStep2(): boolean {
    const hasMat = Object.keys(selectedMaterials).length > 0
    const hasLabor = Object.keys(selectedLaborRates).length > 0
    const hasPresta = Object.keys(selectedPrestations).length > 0
    const hasDesc = freeDescription.trim().length > 0
    if (!hasMat && !hasLabor && !hasPresta && !hasDesc) {
      setStep2Error('Veuillez sélectionner au moins une prestation ou décrire votre projet.')
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
      setStep2Error('Veuillez renseigner des dimensions (longueur/largeur/hauteur) supérieures à zéro pour chaque article sélectionné.')
      return false
    }

    setStep2Error(null)
    return true
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goBack() {
    setStep(s => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Soumission ──────────────────────────────────────────────────────────────

  function handleSubmit() {
    setSubmitError(null)
    if (isUploading) {
      setSubmitError('Le fichier est encore en cours d\'upload. Patientez quelques secondes avant d\'envoyer.')
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
    if (attachmentUrl) fd.set('attachment_url', attachmentUrl)
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

  // ── Écran de succès ─────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className={styles.successShell}>
        <div className={styles.successCard}>
          <div className={styles.successInner}>
            {logoUrl && <img src={logoUrl} alt={orgName} className={styles.successLogo} />}
            <div className={styles.successIcon}>
              <CheckCircle2 />
            </div>
            <div>
              <h2 className={styles.successTitle}>Demande envoyée</h2>
              <p className={styles.successLead}>
                Merci {name.split(' ')[0] || ''}. Un récapitulatif est entre les mains de <strong>{orgName}</strong>.
              </p>
            </div>
            <div className={styles.timeline}>
              <p className={styles.timelineEyebrow}>La suite</p>
              <div className={styles.timelineRow}>
                <span className={styles.timelineNum}>1</span>
                <p className={styles.timelineText}>Votre demande est étudiée par l&apos;équipe.</p>
              </div>
              <div className={styles.timelineRow}>
                <span className={styles.timelineNum}>2</span>
                <p className={styles.timelineText}>Vous êtes recontacté à l&apos;adresse <strong>{email}</strong>{phone ? ' ou par téléphone' : ''}.</p>
              </div>
              <div className={styles.timelineRow}>
                <span className={styles.timelineNum}>3</span>
                <p className={styles.timelineText}>Après étude de votre demande, vous recevrez un devis chiffré, que vous pourrez accepter et signer en ligne.</p>
              </div>
            </div>
            <button type="button" onClick={() => window.location.reload()} className={styles.successAgain}>
              Envoyer une autre demande
            </button>
          </div>
        </div>
      </div>
    )
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          {logoUrl && (
            <div className={styles.logoCard}>
              <img src={logoUrl} alt={orgName} />
            </div>
          )}
          <h1 className={styles.title}>Demande de devis</h1>
          <p className={styles.orgName}>{orgName}</p>
          {welcomeMessage && (
            <p className={styles.welcomeMessage}>{welcomeMessage}</p>
          )}
          <div className={styles.reassurance}>
            <span className={styles.reassuranceItem}><ShieldCheck /> Réponse sous 48h ouvrées</span>
            <span className={styles.reassuranceItem}><ShieldCheck /> Sans engagement</span>
            <span className={styles.reassuranceItem}><ShieldCheck /> 2 minutes chrono</span>
          </div>
        </div>

        {/* Barre de progression */}
        <ProgressBar step={step} />

        {/* Card principale */}
        <div className={styles.card}>
          <div className={styles.cardInner}>

            {/* ── ÉTAPE 1 : Qui êtes-vous ? ── */}
            {step === 1 && (
              <>
                <div className={styles.stepHead}>
                  <h2 className={styles.stepTitle}>Qui êtes-vous ?</h2>
                  <p className={styles.stepSubtitle}>Pour que l&apos;équipe puisse vous recontacter rapidement et personnaliser votre devis.</p>
                </div>

                {/* Toggle particulier / pro */}
                <div className={styles.segmented}>
                  <button
                    type="button"
                    onClick={() => setClientType('particulier')}
                    className={`${styles.segmentedBtn} ${clientType === 'particulier' ? styles.segmentedBtnActive : ''}`}
                  >
                    <User /> Particulier
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientType('pro')}
                    className={`${styles.segmentedBtn} ${clientType === 'pro' ? styles.segmentedBtnActive : ''}`}
                  >
                    <Building2 /> Professionnel
                  </button>
                </div>

                <div className={styles.fieldGrid}>
                  <div className={styles.field}>
                    <label className={styles.label}>Nom complet *</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} className={styles.input} placeholder="Jean Dupont" autoComplete="name" />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Email *</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={styles.input} placeholder="jean@exemple.fr" autoComplete="email" inputMode="email" />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Téléphone</label>
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={styles.input} placeholder="06 12 34 56 78" autoComplete="tel" inputMode="tel" />
                  </div>
                  {clientType === 'pro' && (
                    <>
                      <div className={styles.field}>
                        <label className={styles.label}>Nom de l&apos;entreprise *</label>
                        <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className={styles.input} placeholder="Weber Tôlerie" autoComplete="organization" />
                      </div>
                      <div className={`${styles.field} ${styles.fieldFull}`}>
                        <label className={styles.label}>SIRET</label>
                        <input type="text" value={siret} onChange={e => setSiret(e.target.value)} className={styles.input} placeholder="123 456 789 00012" maxLength={17} />
                      </div>
                    </>
                  )}
                </div>

                {step1Error && (
                  <p className={`${styles.alert} ${styles.alertError}`}>{step1Error}</p>
                )}
              </>
            )}

            {/* ── ÉTAPE 2 : Votre projet ── */}
            {step === 2 && (
              <>
                <div className={styles.stepHead}>
                  <h2 className={styles.stepTitle}>Votre projet</h2>
                  <p className={styles.stepSubtitle}>Sélectionnez ce dont vous avez besoin, même approximativement : on affine ensemble ensuite.</p>
                </div>

                {/* Barre de recherche */}
                {hasCatalog && (
                  <div className={styles.searchWrap}>
                    <Search className={styles.searchIcon} />
                    <input
                      type="search"
                      value={step2Search}
                      onChange={e => setStep2Search(e.target.value)}
                      placeholder="Rechercher dans le catalogue..."
                      className={`${styles.input} ${styles.searchInput}`}
                    />
                    {step2Search && (
                      <button type="button" onClick={() => setStep2Search('')} className={styles.searchClear}>
                        <X />
                      </button>
                    )}
                  </div>
                )}

                {/* Aucun résultat pour la recherche */}
                {hasCatalog && step2Q && articleMaterialGroups.length === 0 && serviceMaterialGroups.length === 0 && laborRateGroups.length === 0 && filteredPrestationGroups.length === 0 && (
                  <div className={styles.emptySearch}>
                    Aucun résultat pour &laquo;&nbsp;{step2Search}&nbsp;&raquo;
                  </div>
                )}

                {/* ── Prestations types d'abord : c'est l'entrée principale du client ── */}
                {filteredPrestationGroups.length > 0 && (
                  <div className={styles.groupList}>
                    <p className={styles.groupLabel}>{catalogContext.labelSet.bundleTemplate.plural}</p>
                    {filteredPrestationGroups.map(group => {
                      const key = `prestations-${group.label}`
                      const selCount = group.items.filter(pt => !!selectedPrestations[pt.id]).length
                      const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                      return (
                        <div key={group.label} className={styles.groupCard}>
                          <button type="button" onClick={() => toggleCategory(key)} className={styles.groupHeader}>
                            <div className={styles.groupHeaderLeft}>
                              <span className={styles.groupHeaderTitle}>{group.label}</span>
                              {selCount > 0 && <span className={styles.groupCount}>{selCount}</span>}
                            </div>
                            <div className={styles.groupMeta}>
                              <span className={styles.groupMetaText}>{group.items.length}&nbsp;{group.items.length > 1 ? 'prestations' : 'prestation'}</span>
                              {isOpen ? <ChevronUp /> : <ChevronDown />}
                            </div>
                          </button>
                          {isOpen && (
                            <div className={styles.groupBody}>
                              {group.items.map(pt => (
                                <PrestationCard
                                  key={pt.id}
                                  pt={pt}
                                  selected={!!selectedPrestations[pt.id]}
                                  data={selectedPrestations[pt.id]}
                                  onToggle={() => togglePrestation(pt)}
                                  onLineQty={(lineId, d) => setPrestationLineQty(pt.id, lineId, d)}
                                  onLineSetQty={(lineId, q) => setPrestationLineExactQty(pt.id, lineId, q)}
                                  onLineSetDimensionCount={(lineId, q) => setPrestationLineDimensionCount(pt.id, lineId, q)}
                                  onLineSetDetails={(lineId, d) => setPrestationLineDetails(pt.id, lineId, d)}
                                  onLineSetLength={(lineId, v) => setPrestationLineLength(pt.id, lineId, v)}
                                  onLineSetWidth={(lineId, v) => setPrestationLineWidth(pt.id, lineId, v)}
                                  onLineSetHeight={(lineId, v) => setPrestationLineHeight(pt.id, lineId, v)}
                                  onLineRemove={lineId => removePrestationLine(pt.id, lineId)}
                                  onLineAdd={line => addPrestationLine(pt.id, line)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Services par catégorie ── */}
                {serviceMaterialGroups.length > 0 && (
                  <div className={styles.groupList}>
                    <p className={styles.groupLabel}>{catalogContext.labelSet.service.plural}</p>
                    {serviceMaterialGroups.map(group => {
                      const key = `services-${group.label}`
                      const selCount = group.items.filter(m => !!selectedMaterials[m.id]).length
                      const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                      return (
                        <div key={group.label} className={styles.groupCard}>
                          <button type="button" onClick={() => toggleCategory(key)} className={styles.groupHeader}>
                            <div className={styles.groupHeaderLeft}>
                              <span className={styles.groupHeaderTitle}>{group.label}</span>
                              {selCount > 0 && <span className={styles.groupCount}>{selCount}</span>}
                            </div>
                            <div className={styles.groupMeta}>
                              <span className={styles.groupMetaText}>{group.items.length}&nbsp;{group.items.length > 1 ? 'services' : 'service'}</span>
                              {isOpen ? <ChevronUp /> : <ChevronDown />}
                            </div>
                          </button>
                          {isOpen && (
                            <div className={styles.groupBody}>
                              {group.items.map(m => (
                                <MaterialCard
                                  key={m.id}
                                  material={m}
                                  itemKindLabel={catalogContext.labelSet.service.singular}
                                  selected={!!selectedMaterials[m.id]}
                                  quantity={selectedMaterials[m.id]?.quantity ?? 1}
                                  dimensionCount={selectedMaterials[m.id]?.dimension_count ?? 1}
                                  details={selectedMaterials[m.id]?.details ?? ''}
                                  lengthM={selectedMaterials[m.id]?.length_m ?? null}
                                  widthM={selectedMaterials[m.id]?.width_m ?? null}
                                  heightM={selectedMaterials[m.id]?.height_m ?? null}
                                  onToggle={() => toggleMaterial(m)}
                                  onQty={d => setMaterialQty(m.id, d)}
                                  onSetQty={q => setMaterialExactQty(m.id, q)}
                                  onSetDimensionCount={q => setMaterialDimensionCount(m.id, q)}
                                  onSetDetails={d => setMaterialDetails(m.id, d)}
                                  onSetLength={v => setMaterialLength(m.id, v)}
                                  onSetWidth={v => setMaterialWidth(m.id, v)}
                                  onSetHeight={v => setMaterialHeight(m.id, v)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Articles par catégorie ── */}
                {articleMaterialGroups.length > 0 && (
                  <div className={styles.groupList}>
                    <p className={styles.groupLabel}>{catalogContext.labelSet.material.plural}</p>
                    {articleMaterialGroups.map(group => {
                      const key = `articles-${group.label}`
                      const selCount = group.items.filter(m => !!selectedMaterials[m.id]).length
                      const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                      return (
                        <div key={group.label} className={styles.groupCard}>
                          <button type="button" onClick={() => toggleCategory(key)} className={styles.groupHeader}>
                            <div className={styles.groupHeaderLeft}>
                              <span className={styles.groupHeaderTitle}>{group.label}</span>
                              {selCount > 0 && <span className={styles.groupCount}>{selCount}</span>}
                            </div>
                            <div className={styles.groupMeta}>
                              <span className={styles.groupMetaText}>{group.items.length}&nbsp;{group.items.length > 1 ? 'articles' : 'article'}</span>
                              {isOpen ? <ChevronUp /> : <ChevronDown />}
                            </div>
                          </button>
                          {isOpen && (
                            <div className={styles.groupBody}>
                              {group.items.map(m => (
                                <MaterialCard
                                  key={m.id}
                                  material={m}
                                  itemKindLabel={catalogContext.labelSet.material.singular}
                                  selected={!!selectedMaterials[m.id]}
                                  quantity={selectedMaterials[m.id]?.quantity ?? 1}
                                  dimensionCount={selectedMaterials[m.id]?.dimension_count ?? 1}
                                  details={selectedMaterials[m.id]?.details ?? ''}
                                  lengthM={selectedMaterials[m.id]?.length_m ?? null}
                                  widthM={selectedMaterials[m.id]?.width_m ?? null}
                                  heightM={selectedMaterials[m.id]?.height_m ?? null}
                                  onToggle={() => toggleMaterial(m)}
                                  onQty={d => setMaterialQty(m.id, d)}
                                  onSetQty={q => setMaterialExactQty(m.id, q)}
                                  onSetDimensionCount={q => setMaterialDimensionCount(m.id, q)}
                                  onSetDetails={d => setMaterialDetails(m.id, d)}
                                  onSetLength={v => setMaterialLength(m.id, v)}
                                  onSetWidth={v => setMaterialWidth(m.id, v)}
                                  onSetHeight={v => setMaterialHeight(m.id, v)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Note : les opérations (main d'œuvre) ne sont jamais proposées ici,
                    laborRates est toujours vide côté serveur (voir page.tsx). Le
                    bloc historique était donc mort ; retiré avec LaborCard. */}

                {/* Message si rien n'est configuré ET mode sur-mesure désactivé */}
                {!hasCatalog && !customModeEnabled && (
                  <div style={{ textAlign: 'center', padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 13, color: 'var(--muted, #6e6a62)' }}>{catalogContext.labelSet.bundleTemplate.emptyLabel}.</p>
                    <p style={{ fontSize: 12, color: 'var(--muted, #6e6a62)' }}>L&apos;entreprise configurera bientôt les {catalogContext.labelSet.bundleTemplate.plural.toLowerCase()} disponibles.</p>
                  </div>
                )}

                {/* Description libre */}
                {(customModeEnabled || !hasCatalog) && (
                  <div className={styles.field}>
                    <label className={styles.groupLabel}>
                      {hasCatalog ? 'Autre besoin' : 'Description du projet'}
                    </label>
                    <textarea
                      rows={4}
                      value={freeDescription}
                      onChange={e => setFreeDescription(e.target.value)}
                      className={`${styles.input} ${styles.textarea}`}
                      placeholder="Décrivez votre besoin : type de travaux, dimensions, contraintes, délais souhaités..."
                    />
                  </div>
                )}

                {step2Error && (
                  <p className={`${styles.alert} ${styles.alertError}`}>{step2Error}</p>
                )}
              </>
            )}

            {/* ── ÉTAPE 3 : Le chantier ── */}
            {step === 3 && (
              <>
                <div className={styles.stepHead}>
                  <h2 className={styles.stepTitle}>Le chantier</h2>
                  <p className={styles.stepSubtitle}>Tout est optionnel ici : renseignez ce qui est pertinent pour votre projet.</p>
                </div>

                <div className={styles.fieldGrid}>
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label className={styles.label}>Adresse du chantier</label>
                    <input type="text" value={chantierAddress} onChange={e => setChantierAddress(e.target.value)} className={styles.input} placeholder="12 rue des Artisans" autoComplete="address-line1" />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Code postal</label>
                    <input type="text" value={chantierPostalCode} onChange={e => setChantierPostalCode(e.target.value)} className={styles.input} placeholder="75001" autoComplete="postal-code" inputMode="numeric" />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Ville</label>
                    <input type="text" value={chantierCity} onChange={e => setChantierCity(e.target.value)} className={styles.input} placeholder="Paris" autoComplete="address-level2" />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Informations complémentaires</label>
                  <textarea
                    rows={3}
                    value={extraNotes}
                    onChange={e => setExtraNotes(e.target.value)}
                    className={`${styles.input} ${styles.textarea}`}
                    placeholder="Contraintes d'accès, délais souhaités, précisions techniques..."
                  />
                </div>

                {/* Fichier joint */}
                <div className={styles.field}>
                  <label className={styles.label}>Fichier joint (optionnel)</label>
                  <p className={styles.stepSubtitle} style={{ marginTop: -2 }}>Photo, plan, PDF, 10 Mo maximum</p>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`${styles.dropzone} ${attachmentFile ? styles.dropzoneActive : ''}`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf"
                      onChange={handleFileChange}
                    />
                    {isUploading ? (
                      <>
                        <Loader2 className={`${styles.dropzoneIcon} animate-spin`} />
                        <span className={styles.dropzoneText}>Upload en cours...</span>
                      </>
                    ) : attachmentFile ? (
                      <>
                        <CheckCircle2 className={`${styles.dropzoneIcon} ${styles.dropzoneIconDone}`} />
                        <span className={styles.dropzoneTextDone}>{attachmentFile.name}</span>
                        <button type="button" onClick={e => { e.stopPropagation(); setAttachmentFile(null); setAttachmentUrl(null); setAttachmentMeta(null) }} className={styles.dropzoneRemove}>
                          <X />
                        </button>
                      </>
                    ) : (
                      <>
                        <Paperclip className={styles.dropzoneIcon} />
                        <span className={styles.dropzoneText}>Cliquez pour joindre un fichier</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── ÉTAPE 4 : Récapitulatif ── */}
            {step === 4 && (
              <>
                <div className={styles.stepHead}>
                  <h2 className={styles.stepTitle}>Récapitulatif</h2>
                  <p className={styles.stepSubtitle}>Vérifiez vos informations avant d&apos;envoyer.</p>
                </div>

                <div className={styles.recapList}>
                  {recapItems.map(item => (
                    <div key={item.label} className={styles.recapRow}>
                      <span className={styles.recapLabel}>{item.label}</span>
                      <span className={styles.recapValue}>{item.value}</span>
                    </div>
                  ))}
                </div>

                <p className={styles.privacyNote}>
                  Vos données sont transmises uniquement à <strong>{orgName}</strong> et ne sont pas partagées avec des tiers.
                </p>

                {submitError && (
                  <p className={`${styles.alert} ${styles.alertError}`}>{submitError}</p>
                )}
              </>
            )}

            {/* Champ honeypot anti-bot - invisible aux humains, ne pas toucher */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }}>
              <label htmlFor="_hp_website">Ne pas remplir ce champ</label>
              <input
                id="_hp_website"
                type="text"
                value={honeypot}
                onChange={e => setHoneypot(e.target.value)}
                autoComplete="off"
                tabIndex={-1}
              />
            </div>

            {/* ── Navigation ── */}
            <div className={`${styles.nav} ${step === 1 ? styles.navEnd : styles.navSpaceBetween}`}>
              {step > 1 && (
                <button type="button" onClick={goBack} disabled={isPending} className={styles.btnBack}>
                  <ChevronLeft /> Précédent
                </button>
              )}

              {step < 4 ? (
                <div className={styles.navRight}>
                  {step === 2 && selectionCount > 0 && (
                    <span className={styles.selectionBadge}>
                      {selectionCount} élément{selectionCount > 1 ? 's' : ''} sélectionné{selectionCount > 1 ? 's' : ''}
                    </span>
                  )}
                  <button type="button" onClick={goNext} className={styles.btnPrimary}>
                    Suivant <ChevronRight />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={handleSubmit} disabled={isPending || isUploading} className={styles.btnPrimary}>
                  {isPending ? <><Loader2 className="animate-spin" />Envoi...</> : 'Envoyer ma demande'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
