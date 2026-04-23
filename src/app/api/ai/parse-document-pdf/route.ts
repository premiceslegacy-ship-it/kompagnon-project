import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ImportDocumentRow } from '@/lib/data/mutations/import-documents'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

const VISION_MODEL = 'google/gemini-2.5-flash-lite'
const VISION_FALLBACK = 'anthropic/claude-sonnet-4-6'

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const arr = text.match(/\[[\s\S]*\]/)
  if (arr) return arr[0]
  return text.trim()
}

function buildPrompt(docType: 'invoices' | 'quotes'): string {
  const isInvoice = docType === 'invoices'
  return `Tu es un assistant d'extraction de données pour une application de gestion de ${isInvoice ? 'factures' : 'devis'} française.
Analyse ce document PDF et extrait toutes les lignes de ${isInvoice ? 'facturation' : 'devis'}.

Retourne UNIQUEMENT un tableau JSON valide (pas de markdown, pas d'explication) avec ce format :
[
  {
    "numero": "${isInvoice ? 'numéro de facture' : 'numéro de devis'} (ex: FAC-2024-001 ou vide si absent)",
    "date_emission": "JJ/MM/AAAA",
    "date_echeance": "${isInvoice ? 'JJ/MM/AAAA ou vide' : ''}",
    "date_validite": "${!isInvoice ? 'JJ/MM/AAAA ou vide' : ''}",
    "titre_projet": "${!isInvoice ? 'titre du projet si présent' : ''}",
    "client_nom": "nom de l'entreprise ou du client",
    "client_type": "professionnel ou particulier",
    "client_email": "email si présent, sinon vide",
    "client_telephone": "téléphone si présent, sinon vide",
    "client_siret": "SIRET si présent, sinon vide",
    "client_adresse": "adresse complète si présente, sinon vide",
    "designation": "description de la ligne de prestation",
    "quantite": "quantité (nombre)",
    "unite": "unité (u, m2, ml, h, forfait…)",
    "prix_unitaire_ht": "prix unitaire HT (nombre décimal, sans symbole €)",
    "tva": "taux de TVA en % (ex: 20, 10, 5.5)",
    "statut": "${isInvoice ? 'payee, envoyee, ou brouillon' : 'accepte, refuse, envoye, ou brouillon'}",
    "recurrente": "${isInvoice ? 'oui ou non' : ''}",
    "frequence": "${isInvoice ? 'mensuelle, trimestrielle, hebdomadaire, annuelle, ou vide' : ''}",
    "notes": "notes ou commentaires si présents, sinon vide"
  }
]

Règles importantes :
- Si le document contient plusieurs lignes de prestation, retourne UNE entrée par ligne
- Toutes les lignes d'un même document doivent avoir le même numéro, date, et infos client
- Si un montant total HT est affiché mais pas les lignes détaillées, crée une seule ligne avec "Prestations diverses" comme désignation
- Les montants DOIVENT être des nombres décimaux (ex: 1500.00 et non "1 500,00 €")
- Dates au format JJ/MM/AAAA si possible
- Si une valeur est absente, utilise une chaîne vide ""
- Ne retourne que le tableau JSON, sans markdown ni commentaires`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'Clé API IA non configurée' }, { status: 500 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const docType = (formData.get('docType') as string | null) === 'quotes' ? 'quotes' : 'invoices'

  if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 15 Mo)' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = file.type || 'application/pdf'
  const orgId = await getCurrentOrganizationId()
  const organizationId = orgId ?? user.id

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: 'text', text: buildPrompt(docType as 'invoices' | 'quotes') },
      ],
    },
  ]

  const MODEL_TIMEOUT_MS = 45_000

  async function callModel(model: string): Promise<{ rows: ImportDocumentRow[] } | { error: string }> {
    try {
      const { data } = await callAI<any>({
        organizationId,
        provider: 'openrouter',
        feature: 'document_parse',
        model,
        inputKind: 'mixed',
        request: {
          body: { messages, temperature: 0.1, max_tokens: 4096 },
          timeoutMs: MODEL_TIMEOUT_MS,
        },
        metadata: {
          route: 'api/ai/parse-document-pdf',
          doc_type: docType,
          app_name: APP_NAME,
        },
      })
      const raw = data.choices?.[0]?.message?.content ?? ''
      try {
        const rows = JSON.parse(extractJson(raw))
        if (!Array.isArray(rows)) throw new Error('not an array')
        return { rows }
      } catch {
        console.error('[ai/parse-document-pdf] JSON parse error:', raw.slice(0, 300))
        return { error: 'parse_error' }
      }
    } catch (err: any) {
      if (err instanceof AIModuleDisabledError) {
        return { error: 'module_disabled' }
      }
      if (err?.name === 'AbortError') {
        console.warn('[ai/parse-document-pdf] timeout after', MODEL_TIMEOUT_MS, 'ms for model', model)
        return { error: 'timeout' }
      }
      throw err
    }
  }

  try {
    let result = await callModel(VISION_MODEL)
    if ('error' in result) {
      console.warn('[ai/parse-document-pdf] Gemini failed, trying fallback Claude')
      result = await callModel(VISION_FALLBACK)
    }
    if ('error' in result) {
      if (result.error === 'module_disabled') {
        return NextResponse.json({ error: 'Module IA document désactivé pour cette organisation.' }, { status: 403 })
      }
      return NextResponse.json({ error: "Impossible d'analyser ce PDF. Vérifiez que le fichier est lisible." }, { status: 500 })
    }
    return NextResponse.json({ rows: result.rows })
  } catch (err: any) {
    console.error('[ai/parse-document-pdf]', err)
    return NextResponse.json({ error: "Erreur lors de l'analyse IA" }, { status: 500 })
  }
}
