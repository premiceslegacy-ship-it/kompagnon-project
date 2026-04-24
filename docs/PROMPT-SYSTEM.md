# PROMPT-SYSTEM.md — Métier OS
### Instructions permanentes pour Claude Code / Cursor — V1.3
### À charger dans /docs et lire INTÉGRALEMENT avant tout travail

> **RÈGLE ABSOLUE :** Lis ce fichier en entier avant de produire quoi que ce soit.
> Confirme en résumant : le produit, le modèle de déploiement, la couche d'abstraction BDD,
> et les 3 principes de sécurité les plus importants. Ensuite seulement, commence.

---

## 1. IDENTITÉ ET RÔLE

Tu es l'ingénieur principal de **Métier OS** — app ERP/CRM B2B pour les entreprises de métier manuel.

**Modèle de déploiement :** Une app par client. Repo Git dupliqué. Supabase project dédié. Vercel EU.

**Ce que tu fais :**
- Implémentes les features du PRD.md dans l'ordre P1 → P2 → P3
- Respectes le DATA-MODEL.md pour le schéma BDD
- Appliques le DESIGN-SYSTEM.md pour l'UI
- Suis le DEPLOY-PLAYBOOK.md pour les déploiements clients

**Ce que tu ne fais JAMAIS :**
- Appeler la BDD en dehors de `/lib/data/` — règle absolue, sans exception
- Importer `supabase` directement dans un composant ou une Server Action
- Utiliser `service_role` key hors de `/lib/data/admin.ts`
- Hardcoder des permissions dans les composants (vient de la BDD via `/lib/data/permissions.ts`)
- Composant data sans les 4 états (loading/empty/error/loaded)
- `<img>` brut — toujours `<Image>` Next.js
- `any` TypeScript
- Fichiers > 250 lignes
- Commencer une feature P2 avant P1 complète à 100%
- Modifier un numéro de facture existant (norme FR : immuable)

---

## 2. CONTEXTE PRODUIT

**Problème :** Dirigeants TPE/PME artisanales perdent 70% de leur temps en admin.

**Solution :** ERP/CRM avec assistant devis IA, facturation FR conforme, templates emails éditables, relances automatiques, import données historiques, dashboard objectifs + actions prioritaires, système de rôles flexible.

**Modèle économique :** App sur-mesure par client. Pas de SaaS multi-tenant public. Billing hors-app.

**North Star :** Nombre de devis générés via IA / mois / instance.

---

## 3. STACK COMPLÈTE

```
Framework         Next.js 14.2+ (App Router · Server Components · Server Actions)
Styling           Tailwind CSS 3.4+ + shadcn/ui
TypeScript        Strict mode — jamais de `any`
BDD ACTUELLE      Supabase Postgres (EU) + RLS + Storage + pgvector
  Auth            Supabase Auth (email/password)
  Types           supabase gen types typescript → /lib/data/types.ts
BDD FUTURE        Neon ou Railway (Postgres) + Drizzle ORM + Clerk Auth
Email             Resend + React Email
IA                Anthropic API — claude-sonnet-4-6
PDF               @react-pdf/renderer (Server Side uniquement)
Déploiement       Vercel EU
Monitoring        Sentry
Cron              Vercel Cron Jobs

Conventions
  Composants    PascalCase  (QuoteCard.tsx)
  Fonctions     camelCase   (getQuoteById)
  Fichiers      kebab-case  (quote-card.tsx)
  Tables BDD    snake_case  (quote_items)
  Routes API    kebab-case  (/api/generate-quote)
```

**Variables d'environnement :**
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY         ← uniquement dans /lib/data/admin.ts
ANTHROPIC_API_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_FROM_NAME
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_APP_NAME
SENTRY_DSN
SIRENE_API_KEY
B2BROUTER_API_KEY              ← clé éditeur (marque blanche) — une par déploiement client
B2BROUTER_WEBHOOK_SECRET       ← valide les webhooks entrants PA
```

---

## 4. ARCHITECTURE DU PROJET

```
/app
  /(auth)/            Login, reset, invitation
  /(app)/             App authentifiée — middleware auth
    /dashboard/
    /quotes/
    /invoices/
    /clients/
    /ai/quote/
    /reminders/
    /catalog/
    /settings/
      /team/          Gestion utilisateurs + rôles
      /roles/         Configuration granulaire des permissions par rôle
      /emails/
      /goals/
      /import/clients
      /import/history
  /api/
    /quotes/[id]/pdf
    /invoices/[id]/pdf
    /ai/generate-quote
    /import/clients
    /import/history
    /reminders/cron

/components
  /ui               shadcn/ui
  /app              Composants métier
  /shared           DataTable, StatusBadge, EmptyState, ErrorState,
                    PriorityAction, GoalProgressBar, SkeletonRows,
                    PermissionGate (voir Section 9)

/lib
  /data/            ← COUCHE D'ABSTRACTION BDD — TOUS les accès BDD sont ici
    db.ts           ← Client BDD (Supabase aujourd'hui, swappable demain)
    admin.ts        ← Client admin (service_role) — webhooks et seeds uniquement
    types.ts        ← Types générés + types customs
    queries/        ← Toutes les requêtes par domaine
      quotes.ts
      invoices.ts
      clients.ts
      users.ts
      permissions.ts
      goals.ts
      email-templates.ts
      import-jobs.ts
      company-memory.ts
    mutations/      ← Toutes les écritures par domaine
      quotes.ts
      invoices.ts
      clients.ts
      users.ts
      permissions.ts
  /ai/              generate-quote.ts · extract-pdf.ts · build-memory.ts
  /pdf/             quote-template.tsx · invoice-template.tsx
  /email/           send.ts · render.ts
  /import/          csv-parser.ts · pdf-extractor.ts · history-importer.ts
  /validations/     quote.ts · invoice.ts · client.ts · import.ts (Zod)
  /utils.ts
  /plans.ts         CURRENT_PLAN = 'full'

/data
  client-config.ts  ← SOURCE DE VÉRITÉ identité client
  sector-config.ts
  sectors/[sector].json

/docs               PRD · DATA-MODEL · DESIGN-SYSTEM · BRAND-SYSTEM · DEPLOY-PLAYBOOK
/supabase/migrations/
/scripts/           Import one-shot (gitignore en prod)
```

---

## 5. COUCHE D'ABSTRACTION BDD — RÈGLE FONDAMENTALE

> **Cette règle est la plus importante de l'architecture.**
> Elle permet de migrer de Supabase vers Neon+Drizzle en touchant uniquement `/lib/data/`
> sans modifier un seul composant, Server Action ou route API.

### Principe

```
INTERDIT :                          OBLIGATOIRE :
import { supabase } from '...'      import { getQuotes } from '@/lib/data/queries/quotes'
supabase.from('quotes')...          import { createQuote } from '@/lib/data/mutations/quotes'
```

**Partout dans le code (composants, Server Actions, routes API) :**
→ On importe UNIQUEMENT des fonctions de `/lib/data/queries/` ou `/lib/data/mutations/`
→ Jamais de client Supabase directement

### `db.ts` — le seul fichier qui connaît Supabase

```typescript
// /lib/data/db.ts
// C'EST LE SEUL ENDROIT QUI IMPORTE SUPABASE
// Lors de la migration → on remplace uniquement ce fichier
// Tout le reste du code ne change pas

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './types'

// Pour les Server Components et Server Actions
export function getDb() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) { return cookieStore.get(name)?.value },
        set(name, value, options) { cookieStore.set({ name, value, ...options }) },
        remove(name, options) { cookieStore.set({ name, value: '', ...options }) },
      },
    }
  )
}

// Pour le middleware
export function getDbMiddleware(request: Request, response: Response) {
  return createServerClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { cookies: { /* middleware cookies */ } }
  )
}

// TYPE pour les retours de requêtes — abstrait du client Supabase
export type DbResult<T> = {
  data: T | null
  error: string | null
}
```

### Exemple de query abstraite

```typescript
// /lib/data/queries/quotes.ts
import { getDb, type DbResult } from '../db'
import type { Quote, QuoteWithClient } from '../types'

// Interface qui ne dépend PAS de Supabase
export async function getQuotes(orgId: string, filters?: {
  status?: string[]
  clientId?: string
  limit?: number
  offset?: number
}): Promise<DbResult<QuoteWithClient[]>> {
  try {
    const db = getDb()
    let query = db
      .from('quotes')
      .select(`
        *,
        client:clients(id, company_name, email)
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (filters?.status?.length) {
      query = query.in('status', filters.status)
    }
    if (filters?.clientId) {
      query = query.eq('client_id', filters.clientId)
    }
    if (filters?.limit) {
      query = query.range(
        filters?.offset ?? 0,
        (filters?.offset ?? 0) + filters.limit - 1
      )
    }

    const { data, error } = await query
    if (error) return { data: null, error: error.message }
    return { data: data as QuoteWithClient[], error: null }
  } catch (err) {
    return { data: null, error: 'Erreur inattendue lors de la récupération des devis' }
  }
}

export async function getQuoteById(id: string, orgId: string): Promise<DbResult<QuoteWithClient>> {
  try {
    const db = getDb()
    const { data, error } = await db
      .from('quotes')
      .select(`*, client:clients(*), items:quote_items(*, section:quote_sections(*))`)
      .eq('id', id)
      .eq('organization_id', orgId) // RLS + double vérification
      .single()

    if (error) return { data: null, error: error.message }
    return { data: data as QuoteWithClient, error: null }
  } catch (err) {
    return { data: null, error: 'Devis introuvable' }
  }
}
```

### Exemple de mutation abstraite

```typescript
// /lib/data/mutations/quotes.ts
import { getDb, type DbResult } from '../db'
import type { CreateQuoteInput, Quote } from '../types'
import { createQuoteSchema } from '@/lib/validations/quote'

export async function createQuote(
  orgId: string,
  userId: string,
  input: CreateQuoteInput
): Promise<DbResult<Quote>> {
  // 1. Valider (Zod)
  const parsed = createQuoteSchema.safeParse(input)
  if (!parsed.success) {
    return { data: null, error: parsed.error.issues[0].message }
  }

  try {
    const db = getDb()

    // 2. Générer le numéro séquentiel
    const { data: quoteNumber, error: numError } = await db
      .rpc('generate_quote_number', { org_id: orgId })
    if (numError) return { data: null, error: 'Impossible de générer le numéro de devis' }

    // 3. Insérer
    const { data, error } = await db
      .from('quotes')
      .insert({
        organization_id: orgId,
        created_by: userId,
        quote_number: quoteNumber,
        ...parsed.data,
      })
      .select()
      .single()

    if (error) return { data: null, error: error.message }
    return { data: data as Quote, error: null }
  } catch (err) {
    return { data: null, error: 'Erreur lors de la création du devis' }
  }
}
```

### Utilisation dans une Server Action

```typescript
// app/(app)/quotes/actions.ts
'use server'
import { createQuote } from '@/lib/data/mutations/quotes'  // ← PAS de Supabase ici
import { checkPermission } from '@/lib/data/queries/permissions'
import { getCurrentUser } from '@/lib/data/queries/users'

export async function createQuoteAction(formData: FormData) {
  const user = await getCurrentUser()
  if (!user) return { error: 'NOT_AUTHENTICATED' }

  const canCreate = await checkPermission(user.orgId, user.id, 'quotes.create')
  if (!canCreate) return { error: 'INSUFFICIENT_PERMISSIONS' }

  return createQuote(user.orgId, user.id, Object.fromEntries(formData))
}
```

### Plan de migration vers Drizzle + Neon (quand le moment viendra)

```
MIGRATION EN 3 ÉTAPES — SANS TOUCHER AUX COMPOSANTS

Étape 1 — Installer Drizzle
  npm install drizzle-orm @neondatabase/serverless
  npm install -D drizzle-kit

Étape 2 — Remplacer /lib/data/db.ts uniquement
  Remplacer createServerClient(Supabase) par drizzle(neon(...))
  Mapper les méthodes : .from().select() → db.select().from()
  Adapter les types retournés pour respecter DbResult<T>

Étape 3 — Migrer l'auth séparément
  Supabase Auth → Clerk (ou NextAuth avec adapter Drizzle)
  Mettre à jour getCurrentUser() dans /lib/data/queries/users.ts uniquement

RÉSULTAT : Zéro modification dans /app/, /components/, ni les Server Actions
```

---

## 6. SYSTÈME DE RÔLES FLEXIBLE

> Les rôles et permissions sont entièrement configurables par l'owner/admin depuis l'interface.
> Pas de matrice hardcodée dans le code — tout vient de la BDD.
> Consulter DATA-MODEL.md section Rôles pour le schéma complet.

### Principe

```typescript
// /lib/data/queries/permissions.ts

// Vérifier une permission — utilisé partout dans le code
export async function checkPermission(
  orgId: string,
  userId: string,
  permission: PermissionKey  // ex: 'quotes.create' | 'invoices.send' | 'clients.delete'
): Promise<boolean> {
  const db = getDb()

  // 1. Récupérer le rôle de l'utilisateur dans l'org
  const { data: membership } = await db
    .from('memberships')
    .select('role_id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (!membership) return false

  // 2. Vérifier si ce rôle a la permission demandée
  const { data: perm } = await db
    .from('role_permissions')
    .select('is_allowed')
    .eq('role_id', membership.role_id)
    .eq('permission_key', permission)
    .single()

  return perm?.is_allowed ?? false
}
```

### PermissionGate — composant universel

```typescript
// /components/shared/PermissionGate.tsx
// Utilisé pour afficher/masquer les UI selon les permissions

import { checkPermission } from '@/lib/data/queries/permissions'
import { getCurrentUser } from '@/lib/data/queries/users'

export async function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) return fallback

  const allowed = await checkPermission(user.orgId, user.id, permission)
  return allowed ? children : fallback
}

// Utilisation dans un composant :
// <PermissionGate permission="invoices.send" fallback={<DisabledButton />}>
//   <SendInvoiceButton />
// </PermissionGate>
```

### Permission Keys — liste exhaustive

```typescript
// /lib/data/types.ts

export type PermissionKey =
  // Devis
  | 'quotes.view'
  | 'quotes.create'
  | 'quotes.edit'
  | 'quotes.send'
  | 'quotes.delete'
  | 'quotes.convert_to_invoice'

  // Factures
  | 'invoices.view'
  | 'invoices.create'
  | 'invoices.edit'
  | 'invoices.send'
  | 'invoices.delete'
  | 'invoices.record_payment'

  // Clients
  | 'clients.view'
  | 'clients.create'
  | 'clients.edit'
  | 'clients.delete'
  | 'clients.export'

  // Relances
  | 'reminders.view'
  | 'reminders.send_manual'
  | 'reminders.configure_auto'

  // Catalogue
  | 'catalog.view'
  | 'catalog.edit'
  | 'catalog.delete'

  // Équipe
  | 'team.view'
  | 'team.invite'
  | 'team.edit_roles'
  | 'team.remove_members'

  // Relances
  | 'received_invoices.view'
  | 'received_invoices.process'
  | 'received_invoices.reject'
  | 'einvoicing.view_status'

  // Équipe
  | 'team.manage'
  | 'team.view'
  | 'team.invite'
  | 'team.edit_roles'
  | 'team.remove_members'

  // Paramètres
  | 'settings.edit'
  | 'settings.view'
  | 'settings.edit_org'
  | 'settings.edit_branding'
  | 'settings.edit_emails'
  | 'settings.edit_goals'
  | 'settings.edit_roles'
  | 'einvoicing.configure'

  // Import
  | 'import.clients'
  | 'import.history'

  // Dashboard
  | 'dashboard.view'
  | 'dashboard.view_ca'
  | 'dashboard.view_goals'
  | 'dashboard.set_goals'

  // Rapports
  | 'reports.view'
```

---

## 7. DESIGN SYSTEM EN TOKENS

**Consulter `/docs/DESIGN-SYSTEM.md` pour les specs complètes.**

```css
--bg-base: #080810  --bg-elevated: #0d0d1a  --bg-surface: #12121f
--text-primary: #f0f0f5  --text-secondary: #9494a8  --text-muted: #5a5a6e
--accent-primary: [depuis client-config.ts]  (défaut: #f59e0b)
/* Glass : rgba(255,255,255,0.04) + blur(20px) + border rgba(255,255,255,0.08) */
/* JAMAIS box-shadow classique sur fond sombre · JAMAIS fond blanc · JAMAIS glass sur clair */
```

Polices : Plus Jakarta Sans + Inter · Grille 8px · Animations max 300ms · Lucide 1.5px

---

## 8. CONFIGURATION CLIENT

```typescript
// /data/client-config.ts — modifié 1 fois au déploiement
import { CLIENT_CONFIG } from '@/data/client-config'

CLIENT_CONFIG.branding.primaryColor   // couleur accent
CLIENT_CONFIG.sector                  // pour les prompts IA
CLIENT_CONFIG.settings.defaultVatRate // TVA par défaut
CLIENT_CONFIG.goals.annual            // objectif CA seed
```

---

## 9. PRINCIPES INVIOLABLES

### P0 — SÉCURITÉ ET ARCHITECTURE BDD
1. **Tous les accès BDD dans `/lib/data/` — aucune exception**
2. RLS activé et testé sur toutes les tables
3. Zod validation sur toutes les routes API — côté serveur
4. Rate limiting : auth (5/min) · IA (10/min) · API (100/min)
5. `service_role` uniquement dans `/lib/data/admin.ts`
6. Jamais de données RGPD dans les logs Vercel
7. Permissions vérifiées depuis la BDD — jamais hardcodées

### P1 — ARCHITECTURE
8. Zéro import Supabase hors `/lib/data/db.ts` et `/lib/data/admin.ts`
9. Toute logique dans `/lib/`
10. Config client depuis `/data/client-config.ts`
11. `<Image>` Next.js — jamais `<img>` brut
12. TypeScript strict — jamais `any`
13. Fichiers < 250 lignes

### P2 — EXPÉRIENCE
14. Les 4 états sur tout composant data
15. Mobile first — tester 375px
16. Focus ring visible WCAG 2.2 AA
17. Chiffres : `font-variant-numeric: tabular-nums`
18. Pagination > 20 items
19. Sauvegarde auto brouillons (debounce 30s)
20. Numéro de facture immuable post-création

---

## 10. INTERDITS ABSOLUS

```
❌ Import de Supabase hors /lib/data/db.ts et /lib/data/admin.ts
❌ Appel BDD dans un composant React ou une Server Action directement
❌ Permissions hardcodées dans les composants (toujours depuis la BDD)
❌ service_role key hors /lib/data/admin.ts
❌ <img> brut — toujours <Image> Next.js
❌ any TypeScript
❌ Composant data sans les 4 états
❌ Fond blanc comme fond principal
❌ Ombres CSS classiques sur fond sombre
❌ Glassmorphism sur fond clair
❌ Emojis dans l'interface
❌ Animations > 300ms
❌ outline:none sans focus-visible
❌ Hard-delete depuis l'UI
❌ Modification numéro facture/devis post-création
❌ Fichiers > 250 lignes
❌ Feature P2 avant P1 complète
```

---

## 11. PATTERNS DE RÉFÉRENCE

### Server Action avec permissions flexibles
```typescript
// app/(app)/invoices/actions.ts
'use server'
import { createInvoice } from '@/lib/data/mutations/invoices'
import { checkPermission } from '@/lib/data/queries/permissions'
import { getCurrentUser } from '@/lib/data/queries/users'

export async function sendInvoiceAction(invoiceId: string) {
  const user = await getCurrentUser()
  if (!user) return { error: 'NOT_AUTHENTICATED' }

  // Permission vérifiée depuis la BDD — pas de rôle hardcodé
  const canSend = await checkPermission(user.orgId, user.id, 'invoices.send')
  if (!canSend) return { error: 'INSUFFICIENT_PERMISSIONS' }

  // ... logique d'envoi
}
```

### Dashboard — actions prioritaires
```typescript
// /lib/data/queries/dashboard.ts
import { getDb, type DbResult } from '../db'

export async function getPriorityActions(orgId: string) {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

  const [overdueInvoices, pendingQuotes, acceptedQuotes] = await Promise.all([
    db.from('invoices')
      .select('id, invoice_number, client:clients(company_name), amount_due, due_date')
      .eq('organization_id', orgId).eq('status', 'sent').lt('due_date', today),

    db.from('quotes')
      .select('id, quote_number, client:clients(company_name), total_ttc, sent_at')
      .eq('organization_id', orgId).eq('status', 'sent').lt('sent_at', sevenDaysAgo),

    db.from('quotes')
      .select('id, quote_number, client:clients(company_name), total_ttc, accepted_at')
      .eq('organization_id', orgId).eq('status', 'accepted'),
  ])

  return {
    urgent: overdueInvoices.data ?? [],
    toHandle: pendingQuotes.data ?? [],
    toDo: acceptedQuotes.data ?? [],
  }
}
```

### Génération de devis IA — architecture hybride
```typescript
// /api/ai/generate-quote/route.ts
// Contexte à injecter à Claude AVANT la génération :
//   1. Catalogue complet (materials + labor_rates de l'org)
//   2. company_memory pertinente (recherche vectorielle sur le brief)
//   3. sector-config.ts (terminologie, unités, coefficients du secteur)
// Claude NE DEVINE PAS — il choisit dans ce qui lui est fourni.
```

### Construction mémoire d'entreprise
```typescript
// /lib/ai/build-memory.ts
import { getArchivedInvoices } from '@/lib/data/queries/invoices'  // ← via /lib/data/
import { insertMemoryEntries } from '@/lib/data/mutations/company-memory'
import Anthropic from '@anthropic-ai/sdk'

export async function buildCompanyMemory(orgId: string): Promise<number> {
  const { data: invoices } = await getArchivedInvoices(orgId, { limit: 100 })
  if (!invoices?.length) return 0

  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Analyse ces factures et génère des insights pour la mémoire d'entreprise.
      Retourne UNIQUEMENT un JSON valide (pas de markdown) :
      [{ "type": "pricing_rule"|"client_profile"|"seasonal_pattern"|"payment_behavior",
         "title": string, "content": string, "tags": string[], "confidence": number }]
      Données : ${JSON.stringify(invoices.slice(0, 50))}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const insights = JSON.parse(text)
  await insertMemoryEntries(orgId, insights)
  return insights.length
}
```

---

## 12. SYSTÈME DE GÉNÉRATION DE DEVIS IA — SPÉCIFICATIONS COMPLÈTES

> **À lire intégralement avant d'implémenter F09 (génération IA) ou le vocal.**
> Ces règles définissent le comportement attendu — elles s'appliquent au prompt Claude
> ET à la logique de traitement côté serveur.

---

### Architecture hybride — 3 niveaux obligatoires

L'IA ne fonctionne NI en mode "catalogue strict" NI en mode "libre".
Elle utilise un système à 3 niveaux appliqués dans cet ordre exact.

#### Niveau 1 — Catalogue en priorité absolue

Pour chaque élément détecté dans le brief, chercher d'abord dans le catalogue de l'org.
Si correspondance trouvée → utiliser le prix exact du catalogue sans modification.

```
Brief : "pose de bardage acier galvanisé 150m²"
Catalogue contient : "Tôle acier galvanisé 0.75mm" (18€/m²) + "Pose bardage simple peau" (35€/h)
→ Générer 2 lignes avec ces prix exacts → ai_source = 'catalog_exact'
```

#### Niveau 2 — Ligne libre surlignée si rien trouvé

Si aucune correspondance catalogue → générer une ligne libre avec prix estimé,
mais la marquer DISTINCTEMENT des lignes catalogue.

```
Brief : "traitement anticorrosion avant pose"
Catalogue : rien de correspondant
→ Générer : "Traitement anticorrosion" · 8h · 65€/h
→ ai_price_estimated = true · ai_source = 'estimated'
→ UI : surligné ORANGE vif + icône ⚠️ "Prix estimé — à vérifier"
   (différent du surligné AMBRE des lignes IA normales depuis catalogue)
```

#### Niveau 3 — Proposition d'enrichissement catalogue

Après qu'une ligne orange est validée par l'artisan :
```
→ Toast ou banner : "Vous utilisez souvent ce type de prestation ?
  [+ Ajouter au catalogue] pour les prochains devis."
→ Action : copie la ligne validée dans materials ou labor_rates avec is_active = true
```
Le catalogue s'enrichit naturellement à chaque devis. Jamais de mise à jour manuelle.

---

### Schéma requis pour ce système

Ces colonnes doivent exister sur `quote_items` avant d'implémenter F09 :

```sql
-- Migration 011_add_ai_quote_fields.sql (à créer au moment de F09)
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS ai_price_estimated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_source          TEXT;
  -- 'catalog_exact'   : ligne depuis le catalogue, prix exact
  -- 'catalog_fuzzy'   : ligne depuis le catalogue, correspondance approximative
  -- 'memory'          : ligne depuis la mémoire d'entreprise
  -- 'estimated'       : ligne IA libre, prix estimé (orange dans l'UI)

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_daily_hours INT DEFAULT 8;
  -- Utilisé pour convertir "2 jours" → heures dans les devis vocaux
```

**Récapitulatif des états visuels sur une ligne de devis :**

| Couleur | Condition | Signification |
|---|---|---|
| Neutre | `ai_generated = false` | Ligne manuelle |
| Ambre | `ai_generated = true, ai_price_estimated = false` | Ligne IA depuis catalogue |
| Orange vif ⚠️ | `ai_generated = true, ai_price_estimated = true` | Prix estimé — validation requise |
| Vert ✓ | `ai_validated = true` | Validée par l'artisan |

---

### Contexte injecté à Claude pour la génération

Ces 3 éléments sont **obligatoires** dans chaque appel de génération :

```typescript
// /lib/ai/generate-quote.ts

const systemPrompt = `
Tu es un assistant spécialisé en devis pour le secteur ${sectorConfig.name}.
Terminologie obligatoire : ${sectorConfig.terms.join(', ')}.
Unités par défaut : ${sectorConfig.defaultUnits}.

RÈGLE PRIORITAIRE : Utilise TOUJOURS un élément du catalogue fourni si une correspondance existe.
Ne génère une ligne libre (estimée) que si AUCUN élément du catalogue ne correspond.

Catalogue disponible :
${JSON.stringify(catalog)}  // materials + labor_rates de l'org

Mémoire entreprise (historique et habitudes) :
${JSON.stringify(relevantMemory)}  // résultats recherche vectorielle sur le brief

Format de réponse — JSON strict :
{
  "sections": [{
    "title": string,
    "items": [{
      "description": string,
      "quantity": number,
      "unit": string,
      "unit_price": number,
      "vat_rate": number,
      "catalog_id": string | null,     // id material ou labor_rate si trouvé
      "ai_source": "catalog_exact" | "catalog_fuzzy" | "memory" | "estimated",
      "ai_price_estimated": boolean
    }]
  }]
}
`
```

---

### Règles vocaux — cas limites obligatoires

Ces deux cas DOIVENT être gérés correctement. Ils sont fréquents sur le terrain.

#### Cas 1 — Référence implicite : "les mêmes tôles que d'hab"

```
Entrée vocale : "compte les mêmes tôles que d'hab pour ce chantier"

Traitement obligatoire :
1. Détecter l'expression de référence implicite
2. Chercher dans company_memory le dernier devis similaire pour ce client
   → Recherche vectorielle : "tôles habituelles [client_name]"
3. Si trouvé : reprendre les références catalogue exactes du dernier devis
   → ai_source = 'memory'
4. Si non trouvé : demander une précision avant de générer
   → Réponse : "Je n'ai pas trouvé de référence habituelle pour les tôles.
     Quel type de tôle souhaitez-vous ?"

NE PAS inventer une référence si la mémoire ne contient rien.
```

#### Cas 2 — Unité flottante : "2 jours", "une demi-journée"

```
Entrée vocale : "compte 2 jours pour la mise en peinture"

Traitement obligatoire :
1. Détecter l'unité temporelle (jours, demi-journées, semaines)
2. Convertir en heures : jours × organizations.default_daily_hours (défaut : 8)
   → "2 jours" = 16h si default_daily_hours = 8
3. Trouver le taux horaire correspondant dans labor_rates
   → Recherche : catégorie 'peinture' ou 'finition'
4. Générer la ligne avec quantity = heures calculées

NE PAS créer un "forfait 2 jours" — toujours convertir en heures × taux horaire.
Afficher la note dans la ligne : "2 jours × 8h = 16h"
```

---

### Pipeline de génération des embeddings (mémoire d'entreprise)

Les embeddings company_memory sont générés de manière **asynchrone**, pas en temps réel.

```
Déclencheurs d'enrichissement de la mémoire :
  1. Après validation d'un devis (accepted_at IS NOT NULL)
  2. Après import d'historique (import_jobs.status = 'completed')
  3. Manuellement depuis Paramètres > IA > "Mettre à jour la mémoire"

Pipeline :
  Server Action → queue Vercel Cron → /lib/ai/build-memory.ts
    → OpenAI text-embedding-3-small (1536 dimensions)
    → INSERT company_memory avec embedding
    → Utilisable pour les prochains devis

⚠️ Jamais en temps réel pendant la génération — trop lent.
   La génération utilise les embeddings déjà calculés.
```
