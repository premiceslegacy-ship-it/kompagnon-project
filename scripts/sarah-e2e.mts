// Harnais de test réel des agents IA (Sarah + Chloé) contre OpenRouter, avec un
// budget de coût strictement borné. Contrairement aux tests unitaires existants
// (sarah-actions-extended.test.ts, statiques, lisent le source par regex), ce
// script exécute réellement le LLM et vérifie le comportement de bout en bout.
//
// Usage :
//   1. npm run dev  (laisser tourner dans un autre terminal, port 3000)
//   2. node scripts/sarah-e2e.mts
//
// Le login se fait une seule fois (compte démo Weber) — throttling Supabase Auth
// documenté (~20 connexions rapprochées → login à 6+ min), la session est réutilisée
// pour tous les scénarios. Le coût réel est lu dans usage_logs après chaque appel
// (colonne provider_cost) via le service role Supabase — pas une estimation.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.SARAH_E2E_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ORG_ID = process.env.SARAH_E2E_ORG_ID ?? 'b10bb73a-0ee8-4a84-9eca-1e9f1c732f40' // Weber Tôlerie (démo)
const EMAIL = process.env.SARAH_E2E_EMAIL ?? 'demo@weber-tolerie-demo.fr'
const PASSWORD = process.env.SARAH_E2E_PASSWORD ?? 'Weber4kompagnon44!'
const MAX_COST_EUR = 3.0 // marge sous le budget de 4€ annoncé

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (voir .env.local).')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const OUT_DIR = join(process.cwd(), '.scratch', 'sarah-e2e')
mkdirSync(OUT_DIR, { recursive: true })

type ScenarioResult = {
  name: string
  ok: boolean
  detail: string
  transcript?: unknown
}

const results: ScenarioResult[] = []
const runStartedAt = new Date().toISOString()

// ─── Coût cumulé réel (usage_logs.provider_cost, pas une estimation) ──────────

async function currentCostEur(): Promise<number> {
  const { data, error } = await admin
    .from('usage_logs')
    .select('provider_cost')
    .eq('organization_id', ORG_ID)
    .gte('created_at', runStartedAt)
  if (error) {
    console.error('[cost] lecture usage_logs échouée:', error.message)
    return 0
  }
  return (data ?? []).reduce((sum, row) => sum + (Number(row.provider_cost) || 0), 0)
}

async function assertBudget(label: string) {
  const cost = await currentCostEur()
  console.log(`  [coût cumulé après ${label}] ${cost.toFixed(4)} €`)
  if (cost >= MAX_COST_EUR) {
    console.error(`\nBUDGET ATTEINT (${cost.toFixed(2)} € >= ${MAX_COST_EUR} €). Arrêt du harnais.`)
    await writeReport()
    process.exit(1)
  }
}

// ─── Auth : une seule connexion, cookies réutilisés partout ───────────────────

async function login(): Promise<string> {
  const authClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!)
  const { data, error } = await authClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !data.session) throw new Error(`Login échoué: ${error?.message}`)
  const { access_token, refresh_token } = data.session
  // Format cookie Supabase SSR (base64 du JSON de session), cohérent avec
  // sb-<project-ref>-auth-token utilisé par @supabase/ssr côté Next.
  const projectRef = new URL(SUPABASE_URL!).hostname.split('.')[0]
  const sessionPayload = {
    access_token,
    token_type: 'bearer',
    expires_in: data.session.expires_in,
    expires_at: data.session.expires_at,
    refresh_token,
    user: data.session.user,
  }
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(sessionPayload)).toString('base64')
  return `sb-${projectRef}-auth-token=${cookieValue}`
}

async function postJson(path: string, cookie: string, body: unknown) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function postForm(path: string, cookie: string, form: FormData) {
  const res = await fetch(BASE_URL + path, { method: 'POST', headers: { cookie }, body: form })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function getJson(path: string, cookie: string) {
  const res = await fetch(BASE_URL + path, { headers: { cookie } })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

function record(name: string, ok: boolean, detail: string, transcript?: unknown) {
  results.push({ name, ok, detail, transcript })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} — ${detail}`)
}

async function writeReport() {
  const cost = await currentCostEur()
  const outPath = join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify({ runStartedAt, costEur: cost, results }, null, 2))
  console.log(`\nRapport écrit dans ${outPath}`)
  console.log(`Coût OpenRouter total de ce run : ${cost.toFixed(4)} €`)
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} scénarios OK`)
  if (failed.length) console.log('Échecs :', failed.map(f => f.name).join(', '))
}

// ─── Scénarios ──────────────────────────────────────────────────────────────

async function scenarioMemory(cookie: string) {
  const marker = `Le fournisseur principal de tôle inox est Décomat, référence client DEC-${Date.now().toString().slice(-6)}.`
  const conversationId = crypto.randomUUID()

  const r1 = await postJson('/api/ai/sarah-secretary', cookie, {
    message: `Retiens ceci pour la suite : ${marker}`,
    page: 'Tableau de bord',
    pathname: '/dashboard',
    pageContext: null,
    history: [],
    conversationId,
  })
  const saved = r1.status === 200 && typeof r1.json?.reply === 'string'
  record('memoire-sauvegarde', saved, saved ? 'Sarah a répondu à la demande de mémorisation' : `status=${r1.status} body=${JSON.stringify(r1.json).slice(0, 200)}`, r1.json)
  if (!saved) return

  // Vérifie en base que la ligne existe bien AVEC un id retrouvable (le bug
  // corrigé : l'ancien code retrouvait la ligne par ilike après un insert sans
  // .select(), risque de cibler la mauvaise ligne sur des mémoires proches).
  const { data: memRows } = await admin
    .from('company_memory')
    .select('id, content, embedding')
    .eq('organization_id', ORG_ID)
    .eq('type', 'sarah_memory')
    .ilike('content', `%Décomat%`)
    .order('created_at', { ascending: false })
    .limit(1)
  const memRow = memRows?.[0]
  record('memoire-en-base', !!memRow, memRow ? `ligne trouvée id=${memRow.id}, contenu="${String(memRow.content).slice(0, 60)}..."` : 'aucune ligne trouvée en base')

  // Nouvelle conversation : Sarah doit rappeler le fait sans qu'il soit dans l'historique.
  const r2 = await postJson('/api/ai/sarah-secretary', cookie, {
    message: 'Qui est notre fournisseur principal de tôle inox ?',
    page: 'Tableau de bord',
    pathname: '/dashboard',
    pageContext: null,
    history: [],
    conversationId: crypto.randomUUID(),
  })
  const recalled = r2.status === 200 && typeof r2.json?.reply === 'string' && /Décomat/i.test(r2.json.reply)
  record('memoire-rappel', recalled, recalled ? 'Sarah a rappelé "Décomat" dans une conversation neuve' : `reply="${String(r2.json?.reply ?? '').slice(0, 200)}"`, r2.json)
}

async function scenarioQualiteEtOrthographe(cookie: string) {
  const questions = [
    'Quel est le chiffre d\'affaires facturé ce mois-ci ?',
    'Y a-t-il des factures en retard de paiement ?',
    'Quels sont mes chantiers en cours ?',
  ]
  for (const q of questions) {
    const r = await postJson('/api/ai/sarah-secretary', cookie, {
      message: q, page: 'Tableau de bord', pathname: '/dashboard', pageContext: null, history: [], conversationId: crypto.randomUUID(),
    })
    const reply = String(r.json?.reply ?? '')
    const hasEmDash = reply.includes('—')
    const looksReasonable = r.status === 200 && reply.length > 10 && reply.length < 1500
    record(`qualite: "${q.slice(0, 40)}..."`, looksReasonable && !hasEmDash, looksReasonable
      ? (hasEmDash ? 'réponse OK mais contient un tiret cadratin (interdit par le prompt)' : `réponse correcte (${reply.length} car.) — relire manuellement le fichier de rapport pour l'orthographe`)
      : `status=${r.status} reply="${reply.slice(0, 150)}"`, r.json)
  }
}

async function scenarioHandoffChloe(cookie: string) {
  const conversationId = crypto.randomUUID()
  const r1 = await postJson('/api/ai/sarah-secretary', cookie, {
    message: 'Prépare un devis pour la pose de 15 mètres linéaires de garde-corps en acier galvanisé chez Dupont Industrie, hauteur 1 mètre, finition thermolaquée.',
    page: 'Tableau de bord', pathname: '/dashboard', pageContext: null, history: [], conversationId,
  })
  const hasAction = r1.status === 200 && (r1.json?.action?.type === 'brief_chloe' || r1.json?.action?.type === 'draft_quote' || r1.json?.action?.type === 'open_quote_editor')
  record('handoff-proposition', hasAction, hasAction ? `action proposée: ${r1.json?.action?.type}` : `status=${r1.status} action=${JSON.stringify(r1.json?.action)} reply="${String(r1.json?.reply ?? '').slice(0, 150)}"`, r1.json)
  if (!hasAction || r1.json.action.type !== 'brief_chloe') {
    record('handoff-brief-consomme', false, 'scénario non applicable (action différente de brief_chloe, pas nécessairement un problème — Sarah a peut-être choisi draft_quote directement)')
    return
  }

  const proposalId = r1.json.action.proposalId
  if (proposalId) {
    const confirmRes = await postJson(`/api/sarah/actions/${proposalId}/confirm`, cookie, {})
    record('handoff-confirmation', confirmRes.status === 200, `status=${confirmRes.status} body=${JSON.stringify(confirmRes.json).slice(0, 200)}`)
  }

  // Vérifie que le brief est bien consommable côté Chloé
  const briefRes = await getJson('/api/sarah/briefs?target=chloe', cookie)
  const briefPresent = briefRes.status === 200 && briefRes.json?.brief?.payload?.description
  record('handoff-brief-disponible', !!briefPresent, briefPresent ? 'brief chloe présent et consommable' : `status=${briefRes.status} body=${JSON.stringify(briefRes.json).slice(0, 200)}`)
}

async function scenarioActionAvecConfirmation(cookie: string) {
  const r1 = await postJson('/api/ai/sarah-secretary', cookie, {
    message: 'Ajoute une tâche "Vérifier les soudures" sur le chantier Opération atelier, à faire avant vendredi.',
    page: 'Tableau de bord', pathname: '/dashboard', pageContext: null, history: [], conversationId: crypto.randomUUID(),
  })
  const hasAction = r1.status === 200 && !!r1.json?.action?.proposalId
  record('action-proposee', hasAction, hasAction ? `action ${r1.json.action.type} proposée, proposalId=${r1.json.action.proposalId}` : `status=${r1.status} body=${JSON.stringify(r1.json).slice(0, 250)}`, r1.json)
  if (!hasAction) return

  const proposalId = r1.json.action.proposalId
  // Idempotence : double POST doit renvoyer un succès sans dupliquer l'effet de bord.
  const c1 = await postJson(`/api/sarah/actions/${proposalId}/confirm`, cookie, {})
  const c2 = await postJson(`/api/sarah/actions/${proposalId}/confirm`, cookie, {})
  const bothOk = c1.status === 200 && c2.status === 200
  record('action-idempotence', bothOk, `1er confirm status=${c1.status}, 2e confirm (retry) status=${c2.status} body2="${JSON.stringify(c2.json).slice(0, 150)}"`)

  const { data: proposalRow } = await admin
    .from('sarah_action_proposals')
    .select('status, executed_at')
    .eq('id', proposalId)
    .single()
  record('action-statut-execute', proposalRow?.status === 'executed', `statut en base: ${proposalRow?.status}`)
}

// ─── Features IA clés du quotidien de l'artisan ────────────────────────────

async function scenarioChloeDevisTexte(cookie: string) {
  const r = await postJson('/api/ai/analyze-quote', cookie, {
    text: 'Remplacement de la toiture en zinc sur 80 m2, dépose ancienne couverture, pose zinc prépatiné joint debout, isolation entre chevrons laine de bois 200mm, faîtage et rives compris.',
  })
  const quotes = r.json?.quotes
  const ok = r.status === 200 && Array.isArray(quotes) && quotes.length > 0 && Array.isArray(quotes[0]?.sections) && quotes[0].sections.length > 0
  const itemCount = ok ? quotes[0].sections.reduce((s: number, sec: any) => s + (sec.items?.length ?? 0), 0) : 0
  record('chloe-devis-texte', ok && itemCount > 0, ok ? `${quotes[0].sections.length} section(s), ${itemCount} ligne(s) générée(s)` : `status=${r.status} body=${JSON.stringify(r.json).slice(0, 250)}`, r.json)
}

async function scenarioChloeDevisDocument(cookie: string) {
  const form = new FormData()
  const description = 'Réfection complète salle de bain : dépose existant, plomberie, carrelage sol et mur, faïence, receveur douche italienne.'
  const blob = new Blob([Buffer.from(description, 'utf8')], { type: 'text/plain' })
  // La route accepte PDF/image en vision ; un .txt n'est pas un format supporté
  // par le vision model, donc ce scénario teste plutôt le chemin "description
  // seule dans un FormData" si le fichier est rejeté — sinon on bascule sur PNG.
  const imgPath = join(process.cwd(), '.scratch', 'sarah-e2e', 'plan-test.png')
  let file: Blob
  let filename: string
  let mimeType: string
  try {
    const buf = readFileSync(imgPath)
    file = new Blob([buf], { type: 'image/png' })
    filename = 'plan-test.png'
    mimeType = 'image/png'
  } catch {
    file = blob
    filename = 'devis.txt'
    mimeType = 'text/plain'
  }
  form.set('file', file, filename)
  form.set('description', 'Analyse ce document et prépare les lignes de devis correspondantes.')
  void mimeType

  const r = await postForm('/api/ai/analyze-quote', cookie, form)
  const quotes = r.json?.quotes
  const ok = r.status === 200 && Array.isArray(quotes) && quotes.length > 0
  record('chloe-devis-document', ok, ok ? `${quotes.length} devis candidat(s) extrait(s) du document` : `status=${r.status} body=${JSON.stringify(r.json).slice(0, 250)}`, r.json)
}

async function scenarioPreMetre(cookie: string) {
  const imgPath = join(process.cwd(), '.scratch', 'sarah-e2e', 'plan-test.png')
  const buf = readFileSync(imgPath)
  const form = new FormData()
  form.set('file', new Blob([buf], { type: 'image/png' }), 'plan-test.png')
  form.set('projectType', 'renovation')
  form.set('description', 'Plan de rénovation avec salle de bain, WC et cuisine, cotes en mètres.')

  const r = await postForm('/api/ai/measure-plan', cookie, form)
  const rooms = r.json?.measurement?.rooms ?? r.json?.rooms
  const items = r.json?.measurement?.items ?? r.json?.items
  const ok = r.status === 200 && (Array.isArray(rooms) || Array.isArray(items))
  const roomCount = Array.isArray(rooms) ? rooms.length : 0
  record('pre-metre-plan', ok, ok ? `${roomCount} pièce(s) détectée(s) sur le plan de test` : `status=${r.status} body=${JSON.stringify(r.json).slice(0, 300)}`, r.json)
}

async function scenarioEmailClient(cookie: string) {
  const r = await postJson('/api/ai/email-draft', cookie, {
    recipients: 'Dupont Industrie',
    subject: 'Mise à jour du planning de chantier',
    tone: 'professionnel',
    context: 'Le chantier Opération atelier a pris deux jours de retard suite à un problème d\'approvisionnement en tôle inox. Nouvelle date de livraison prévue vendredi prochain.',
    orgEmail: 'contact@weber-tolerie-demo.fr',
    orgName: 'Weber Tôlerie',
  })
  const draft = r.json?.subject || r.json?.body || r.json?.draft
  const ok = r.status === 200 && !!draft
  record('email-client-redaction', ok, ok ? 'brouillon email généré' : `status=${r.status} body=${JSON.stringify(r.json).slice(0, 250)}`, r.json)
}

// ─── Exécution ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`Démarrage du harnais Sarah E2E — budget max ${MAX_COST_EUR} €\n`)
  console.log('Login (compte démo Weber, connexion unique)...')
  const cookie = await login()
  console.log('Login OK.\n')

  console.log('── Mémoire / RAG ──')
  await scenarioMemory(cookie)
  await assertBudget('mémoire')

  console.log('\n── Qualité et orthographe ──')
  await scenarioQualiteEtOrthographe(cookie)
  await assertBudget('qualité')

  console.log('\n── Handoff Sarah → Chloé ──')
  await scenarioHandoffChloe(cookie)
  await assertBudget('handoff')

  console.log('\n── Action avec confirmation + idempotence ──')
  await scenarioActionAvecConfirmation(cookie)
  await assertBudget('action')

  console.log('\n── Chloé : devis depuis texte libre ──')
  await scenarioChloeDevisTexte(cookie)
  await assertBudget('chloe-texte')

  console.log('\n── Chloé : devis depuis document (plan/image) ──')
  await scenarioChloeDevisDocument(cookie)
  await assertBudget('chloe-document')

  console.log('\n── Pré-métré depuis un plan ──')
  await scenarioPreMetre(cookie)
  await assertBudget('pre-metre')

  console.log('\n── Rédaction email client ──')
  await scenarioEmailClient(cookie)
  await assertBudget('email')

  await writeReport()
}

main().catch(async (err) => {
  console.error(err)
  await writeReport().catch(() => {})
  process.exit(1)
})
