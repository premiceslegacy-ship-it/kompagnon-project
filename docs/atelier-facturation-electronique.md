# Atelier — Architecture Facturation Électronique (Double Vitesse)

> **Doc de référence** pour l'implémentation B2Brouter dans Atelier. À tenir à jour à chaque évolution de l'archi ou de l'API B2Brouter.

---

## 1. Contexte réglementaire

La réforme française de facturation électronique impose deux obligations :
- **Réception** : dès septembre 2026, toutes les entreprises doivent pouvoir recevoir des factures électroniques structurées
- **Émission** : obligatoire pour les TPE/artisans à partir de septembre 2027

Atelier génère toujours un PDF + un fichier XML conforme. La différence entre les deux modes porte uniquement sur ce qui se passe après la génération.

---

## 2. Stack de déploiement

- **1 repo GitHub** pour tous les clients
- **1 Cloudflare Worker** par client (Next.js via OpenNext + Wrangler)
- Le mode facturation est piloté par **`organization_modules` en base de données** — zéro redéploiement pour activer ou changer de mode
- Les clés B2Brouter (propres à chaque client) sont stockées dans les **variables d'env Cloudflare** du Worker client

---

## 3. Pilotage du mode facturation

Le mode est un flag dans `organization_modules`, exactement comme les modules IA :

```typescript
// organization-modules.ts — à ajouter quand on développe cette feature
'facturation_b2brouter': false  // false = export_only, true = b2brouter
```

Pour activer B2Brouter chez un client :
1. Cockpit Orsayn → modifier le flag `facturation_b2brouter` sur l'org du client
2. Ajouter `B2BROUTER_API_KEY`, `B2BROUTER_ACCOUNT_ID`, `B2BROUTER_WEBHOOK_SECRET` dans Cloudflare Workers → Settings → Secrets
3. Lancer le script d'onboarding B2Brouter (cf. § 7) — zéro touche au repo

> **Note :** les clés B2Brouter restent dans les variables d'env Cloudflare (pas en DB) car ce sont des secrets d'API, pas des données applicatives.

---

## 4. Lecture du mode dans le code

```typescript
// Via organization_modules (piloté depuis le cockpit)
const modules = await getOrganizationModules(orgId)
const isB2Brouter = modules.facturation_b2brouter

// Variables d'env (injectées dans Cloudflare Workers → Settings → Secrets)
const B2BROUTER_API_KEY        = process.env.B2BROUTER_API_KEY
const B2BROUTER_ACCOUNT_ID     = process.env.B2BROUTER_ACCOUNT_ID
const B2BROUTER_WEBHOOK_SECRET = process.env.B2BROUTER_WEBHOOK_SECRET
```

---

## 5. Générateur XML — Commun aux deux modes

Toutes les instances Atelier génèrent systématiquement deux fichiers à chaque facture émise :
- Un **PDF** lisible par l'humain (inchangé)
- Un **fichier XML structuré** conforme à la norme EN 16931

**Pourquoi XML et pas juste PDF ?**
Le PDF est lisible par un humain, pas par une machine. Le XML balise chaque champ (montant HT, TVA, SIRET, IBAN, échéance...). Il peut être ingéré automatiquement par une PA, un logiciel comptable, ou transmis sur le réseau Peppol/PPF.

**Profils selon l'usage :**
- **EN 16931 (COMFORT)** → PDF téléchargeable par le client, conforme légalement, importable dans toute PA. C'est ce qu'Atelier génère aujourd'hui, validé Factur-X.
- **France CIUS UBL** (`xml.ubl.invoice.frcius.v1`) → format recommandé par B2Brouter pour les contacts français Peppol-Annuaire (Flux 1 DGFiP).
- **France CIUS CII** (`xml.cii.cross_industry_invoice.frcius.v1`) → variante CII, compatible Factur-X.
- **Factur-X PDF/A-3** (`pdf.a.invoice.with.xml.cii.cross_industry_invoice.facturx.fr.all_profiles.v1`) → PDF/A-3 avec XML CII embarqué.

**Interopérabilité :** un client en mode `export_only` qui télécharge son Factur-X et le dépose sur sa PA (Indy, Chorus Pro…) reste lisible par le réseau Peppol côté destinataire. Le format est standard, pas propriétaire.

**Ce que le dev fait :**
- Générateur Factur-X à partir du data model facture existant
- Validation des champs obligatoires selon EN 16931 avant génération
- Le fichier généré est disponible en interne pour les deux modes

---

## 6. Mode 1 — `export_only` (`facturation_b2brouter: false`)

**Profil** : artisan qui veut être conforme, gère sa PA lui-même, ou qui n'a pas encore de budget pour l'intégration complète.

**Comportement attendu :**
- Atelier génère la facture en PDF + XML (Factur-X)
- Bouton "Télécharger pour dépôt PA" visible sur chaque facture
- Statut affiché : "À déposer manuellement" tant que l'artisan n'a pas confirmé
- L'artisan dépose le fichier sur sa PA de son choix (Indy, Chorus Pro, autre PDP)
- **Pas de section "Factures reçues"** dans ce mode — réévalué après retours terrain

**Ce que le dev fait :**
- Bouton téléchargement Factur-X dans l'UI facture
- Statut "À déposer" / "Déposé" (confirmation manuelle par l'artisan)

---

## 7. Mode 2 — `b2brouter` (`facturation_b2brouter: true`)

**Profil** : client qui veut zéro friction, volume de facturation suffisant pour justifier le coût B2Brouter.

### 7.1. Pré-requis API

| Élément | Valeur |
|---|---|
| Base URL prod | `https://api.b2brouter.net` |
| Base URL sandbox | `https://api-staging.b2brouter.net` |
| Header auth | `X-B2B-API-Key: {YOUR_API_KEY}` |
| Header version | `X-B2B-API-Version: 2026-03-02` (minimum pour DGFiP) |
| Headers communs | `accept: application/json`, `content-type: application/json` |
| Rate limit prod | 1 000 req/min |
| Rate limit sandbox | 600 req/min |
| Tracing | `X-B2B-API-Request-Id` (optionnel, recommandé pour debug) |

**Migration sandbox → prod** : changer la base URL, la clé API, et potentiellement les `account_id` (différents entre les deux environnements).

### 7.2. Onboarding B2Brouter (à automatiser via script)

Quatre étapes obligatoires par client. À encapsuler dans `scripts/b2brouter/onboard-client.ts` :

**Étape 1 — Création du compte**
```
POST /accounts
{
  "account": {
    "country": "fr",
    "cin_scheme": "0002",            // 0002 = SIREN, 0009 = SIRET
    "cin_value": "{SIREN}",
    "tin_value": "FR{kk}{SIREN}",    // omettable, dérivé auto à l'étape 2
    "name": "{raison sociale}",
    "address": { ... },
    "email": "{contact}"
  }
}
```
→ Récupérer `account.id` et le persister (env var `B2BROUTER_ACCOUNT_ID`).

**Étape 2 — Activation Tax Report DGFiP**
```
POST /accounts/{ACCOUNT_ID}/tax_report_settings
{
  "tax_report_setting": {
    "code": "dgfip",
    "start_date": "2026-09-01",
    "type_operation": "services",       // services | goods | mixed
    "naf_code": "43",                   // 2 premiers chiffres NAF/APE
    "enterprise_size": "micro",         // micro | pme | eti | ge
    "email": "{contact}",
    "reason_vat_exempt": "VATEX-FR-FRANCHISE"  // optionnel, défaut OK
  }
}
```
**Effets automatiques :**
- Publication SIREN/SIRET dans l'Annuaire PPF
- Création du transport Peppol 0225 (FRCTC Electronic Address) pour la réception
- ⚠️ **24h de propagation Annuaire** avant qu'Atelier puisse émettre vers ce client

**Étape 3 — Configuration des contacts**
Pour chaque client B2B français :
```
POST /accounts/{ACCOUNT_ID}/contacts
{
  "contact": {
    "name": "...",
    "country": "fr",
    "currency": "EUR",
    "cin_scheme": "0009",                                // SIRET
    "cin_value": "{14 chiffres}",
    "tin_scheme": "9957",                                // ISO 6523 fiscal FR
    "tin_value": "FR{kk}{SIREN}",
    "transport_type_code": "peppol",
    "document_type_code": "xml.ubl.invoice.frcius.v1"
  }
}
```
→ B2Brouter vérifie automatiquement la présence dans l'Annuaire DGFiP (`in_dgfip_annuaire`: true/false/nil).

**Étape 4 — Création des webhooks**
```
POST /web_hooks
{
  "web_hook": {
    "url": "https://{client-domain}/api/webhooks/b2brouter",
    "events": [
      "issued_invoice.state_change",
      "tax_report.state_change",
      "ledger.state_change"
    ],
    "enabled": true,
    "description": "Atelier - {client_name}"
  }
}
```
→ **CRITIQUE** : récupérer `signing_secret` immédiatement (renvoyé une seule fois à la création), le stocker en env var `B2BROUTER_WEBHOOK_SECRET`.

### 7.3. Émission d'une facture

**Champs obligatoires DGFiP (B2B France)** — sinon HTTP 422 :
- `remittance_information` (PMD) — référence + mentions légales (RCS, capital)
- `payment_method_text` (PMT) — moyen + IBAN/BIC
- `payment_terms` (AAB) — échéance + pénalités de retard

**Format Factur-X importé** : ces champs peuvent être passés via tags `extra_info` :
```
#PMD# FA-2026-0048 — Atelier SAS, RCS Paris 123 456 789
#PMT# Credit Transfer, IBAN FR00 0000 0000 0000 0000 0000 000
#AAB# Net 30 jours. Pénalité de retard : 12% annuel.
```

**TVA en franchise (auto-entrepreneur)** : ligne avec `category: "E"` + `comment: "VATEX-FR-FRANCHISE"` obligatoire — sinon facture créée mais bloquée à la transmission.

**Endpoint** : `POST /accounts/{ACCOUNT_ID}/invoices` avec `send_after_import: true` pour générer + transmettre en un appel.

**Récupération du XML transmis** : champ `download_legal_url` dans la réponse, après passage en état `sent`.

### 7.4. Réception de factures (Flux 6)

**Méthode retenue : POLLING**

Aucun event webhook documenté pour les factures reçues. Les 3 events disponibles (`issued_invoice.state_change`, `tax_report.state_change`, `ledger.state_change`) ne couvrent que ce que le client émet.

**Implémentation** :
- Cron Cloudflare Worker toutes les **15 minutes** par org en mode `b2brouter`
- `GET /accounts/{ACCOUNT_ID}/invoices?type=ReceivedInvoice&state=new` (paginé, 25/page)
- Pour chaque nouvelle facture : insertion dans `received_invoices` + récupération du XML via `GET /invoices/{id}/as/original`
- Idempotence sur `pa_message_id` (clé unique)

**Pourquoi pas de polling plus rapide** : factures fournisseurs = pas de besoin temps-réel. 15 min couvre largement les usages métier.

**Migration future** : si B2Brouter expose un event `received_invoice.*`, basculer sans toucher au modèle de données.

### 7.5. Gestion des statuts CDAR (réception)

Quand une facture reçue change d'état côté Atelier, propager au PPF via :
```
POST /invoices/{INVOICE_ID}/mark_as
{
  "state": "accepted" | "refused" | "paid" | "annotated",
  "reason": "...",                       // optionnel
  "commit": "with_mail"                  // requis si origine email
}
```

| État Atelier | État B2Brouter | Code CDAR |
|---|---|---|
| Reçue | `new` / `received` | 200 / 202 |
| À payer (validée) | `accepted` | 205 |
| Refusée | `refused` | 210 |
| Payée | `allegedly_paid` | 212 *(non disponible via API à date)* |
| Rejetée par PPF | `rejected` | 213 |

> Le marquage "payée" via API n'est pas encore exposé par B2Brouter — fonctionnalité annoncée mais non livrée. À surveiller dans les changelogs.

### 7.6. Webhooks entrants

Endpoint : `POST /api/webhooks/b2brouter` (Next.js Route Handler avec `runtime = 'edge'`).

**Vérification de signature HMAC-SHA256 obligatoire** :
- Header reçu : `X-B2Brouter-Signature: t={unix_ts},s={hash_hex}`
- Calcul attendu : `HMAC-SHA256(secret, "{t}.{raw_body}")`
- ⚠️ Utiliser le **raw body** (jamais le JSON re-sérialisé) → lire via `await request.text()` puis `JSON.parse` après vérification.
- Comparaison en `timingSafeEqual` pour éviter les attaques timing.

**Anti-replay** : rejeter les requêtes dont `t` est plus vieux que 5 minutes.

**Idempotence** : `data.event_id` est unique par event B2Brouter — table `b2brouter_webhook_events(event_id PRIMARY KEY)` pour dédupliquer les retries.

**Réponse attendue** : HTTP 200 sec. Sinon B2Brouter considère l'URL comme injoignable (HTTP 404 dans leurs logs).

#### Payloads par event

**`issued_invoice.state_change`** — payload minimaliste, re-fetch nécessaire :
```json
{
  "code": "issued_invoice.state_change",
  "triggered_at": 1732530071,
  "data": {
    "invoice_id": 85373,
    "event_id": 381690,
    "state": "registered",
    "notes": null
  }
}
```
→ Action : `GET /invoices/{invoice_id}` pour récupérer le détail, puis update de la facture Atelier correspondante.

**`tax_report.state_change`** — payload complet, pas de re-fetch :
```json
{
  "id": 173,
  "code": "tax_report.state_change",
  "triggered_at": 1732530071,
  "data": {
    "tax_report_id": 6560,
    "event_id": 385720,
    "state": "registered",
    "notes": null,
    "object": {
      "id": 242964726,
      "invoice_id": 85373,
      "state": "registered",
      "label": "Flux 1",
      "has_errors": false,
      "has_warnings": false,
      "document_type_code": "xml.tax_report.dgfip.flux1",
      "transport_type_code": "fr.dgfip",
      "invoice_date": "2026-09-15",
      "invoice_number": "FA-2026-0048",
      "customer_party_name": "...",
      "customer_party_tax_id": "...",
      "tax_breakdowns": [ ... ]
    }
  }
}
```
→ Action : insertion directe dans `pa_status_events` (audit trail légal immuable).

**`ledger.state_change`** — agrégats Flux 10 quotidiens (B2C / cross-border).
→ Action : tracking de conformité, pas d'impact UI direct sur les artisans purs B2B FR.

#### Source de vérité par usage

| Usage | Event source de vérité |
|---|---|
| UI artisan (état facture émise) | `issued_invoice.state_change` |
| Audit trail légal `pa_status_events` | `tax_report.state_change` |
| Conformité Flux 10 | `ledger.state_change` |

### 7.7. Mapping des états

**États B2Brouter facture émise → UI Atelier**

| État B2Brouter | UI Atelier | Sens |
|---|---|---|
| `sending` | Envoi en cours | File d'attente PPF |
| `sent` | Envoyée | Déposée au PPF, Flux 1 confirmé |
| `registered` | Enregistrée DGFiP | CDV positif (condition 300) |
| `accepted` | Acceptée par client | Validation acheteur |
| `refused` | Refusée par client | Rejet acheteur |
| `allegedly_paid` | Déclarée payée | CDAR 212 |
| `error` | Erreur | Voir champ `errors` |

**États tax_report (Flux 1) → `pa_status_events.new_status`**
`new` → `sent` → `acknowledged` (CDV 500) → `registered` (CDV 300) | `refused` (CDV 301) | `error` | `annulled`

**États facture reçue → UI Atelier**

| État B2Brouter | UI Atelier | CDAR |
|---|---|---|
| `new` / `received` | Reçue | 200 / 202 |
| `accepted` | À payer (validée) | 205 |
| `refused` | Refusée | 210 |
| `allegedly_paid` | Payée | 212 |
| `rejected` | Rejetée par PPF | 213 |

> **Positionnement produit** : Atelier n'est pas un logiciel comptable. Pour les factures reçues l'UI expose seulement `Reçue → À payer → Payée`. Le lien vers un projet/chantier est **optionnel** (une facture Leroy Merlin n'a pas forcément d'imputation chantier). Pas de saisie comptable, pas de plan de comptes — un export CSV/PDF pour l'expert-comptable suffit.

---

## 8. Modèle de données

### 8.1. Tables existantes (migration `005_advanced_tables.sql`)

**`received_invoices`** — factures fournisseurs reçues via B2Brouter
- `pa_message_id TEXT UNIQUE` — identifiant unique côté B2Brouter (idempotence polling)
- `pa_received_at TIMESTAMPTZ` — horodatage réception PPF
- Champs structurés : `supplier_siren`, `supplier_siret`, `supplier_name`, `supplier_vat`, `invoice_number`, `invoice_date`, `due_date`, `total_ht`, `total_tva`, `total_ttc`
- `status` : `received | verified | accounted | rejected` *(à aligner UI : `received | to_pay | paid | rejected`)*
- `facturx_url`, `raw_xml JSONB`

**`pa_status_events`** — audit trail légal immuable
- Référence `invoice_id` ou `received_invoice_id`
- `event_type` : `submitted | delivered | accepted | rejected | cancelled`
- `previous_status`, `new_status`, `pa_timestamp`
- Pas d'UPDATE possible (table append-only par RLS)

### 8.2. Tables à ajouter

**`b2brouter_webhook_events`** — déduplication des retries webhook
```sql
CREATE TABLE public.b2brouter_webhook_events (
  event_id          BIGINT       PRIMARY KEY,        -- data.event_id de B2Brouter
  organization_id   UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_code        TEXT         NOT NULL,           -- 'issued_invoice.state_change' | ...
  triggered_at      TIMESTAMPTZ  NOT NULL,
  payload           JSONB        NOT NULL,
  processed_at      TIMESTAMPTZ  DEFAULT now()
);
```

**`b2brouter_accounts`** — mapping org Atelier ↔ compte B2Brouter (alternative aux env vars si on veut tout en DB)
```sql
CREATE TABLE public.b2brouter_accounts (
  organization_id   UUID         PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id        BIGINT       NOT NULL,           -- B2Brouter account.id
  tax_report_id     BIGINT,                          -- DGFiP tax report setting id
  webhook_id        BIGINT,                          -- B2Brouter web_hook.id
  annuaire_active   BOOLEAN      DEFAULT false,      -- true après les 24h de propagation
  activated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  DEFAULT now()
);
```
> Choix : on garde **`B2BROUTER_API_KEY` et `B2BROUTER_WEBHOOK_SECRET` en env Cloudflare** (secrets), mais `account_id` peut vivre en DB pour faciliter les requêtes côté serveur sans recharger l'env.

### 8.3. Ajustement `received_invoices`

Pour aligner avec le positionnement produit (suivi trésorerie, pas compta) :
- Renommer logiquement les statuts : `received` → `received`, `verified` → `to_pay`, `accounted` → `paid`, `rejected` → `rejected`
- Garder les colonnes `accounted_at / accounted_by` en DB (pas de breaking change), simplement ne pas les exposer dans l'UI
- Lien chantier optionnel : ajouter `project_id UUID NULL REFERENCES public.projects(id)`
- `raw_xml JSONB` reste en DB pour debug, mais le **XML faisant foi est archivé 10 ans côté B2Brouter** — on n'est pas le gardien légal.

---

## 9. Architecture code

```
src/
├── app/api/
│   ├── webhooks/b2brouter/route.ts      # POST entrant (signature HMAC + dispatch event)
│   └── cron/b2brouter-poll/route.ts     # Cron 15min (polling factures reçues)
├── lib/b2brouter/
│   ├── client.ts                        # Wrapper API (auth, rate limit, retry)
│   ├── types.ts                         # Types TS des payloads B2Brouter
│   ├── signature.ts                     # Vérification HMAC-SHA256
│   ├── events/
│   │   ├── issued-invoice.ts           # Handler issued_invoice.state_change
│   │   ├── tax-report.ts               # Handler tax_report.state_change
│   │   └── ledger.ts                   # Handler ledger.state_change
│   ├── poll-received.ts                # Logique polling factures reçues
│   ├── onboarding.ts                   # Script 4 étapes onboarding client
│   └── mappers/
│       ├── invoice-state.ts            # B2Brouter state → Atelier UI state
│       └── cdar-codes.ts               # Codes CDAR ↔ états received_invoices
└── lib/pdf/
    └── facturx-xml.ts                  # Générateur XML existant
```

### 9.1. Edge runtime obligatoire

Le webhook entrant doit être en `runtime = 'edge'` :
- Latence faible (B2Brouter timeout après quelques secondes)
- Accès direct au raw body via `await request.text()`
- Pas de body parser middleware Next.js qui casserait la signature

### 9.2. Cron polling

Configuration Cloudflare Worker `wrangler.toml` :
```toml
[triggers]
crons = ["*/15 * * * *"]
```
Le handler interroge la liste des orgs en mode `b2brouter`, puis pour chacune appelle `pollReceivedInvoices(orgId)`.

---

## 10. Sécurité

| Vecteur | Mitigation |
|---|---|
| Webhook spoofing | Vérif HMAC-SHA256 obligatoire avant toute action |
| Replay attack | Rejet si `t` > 5 min de skew |
| Retry duplicates | Table `b2brouter_webhook_events` (PK sur `event_id`) |
| Insertion `received_invoices` | RLS : INSERT uniquement via `service_role` (webhook/cron) |
| Lecture `received_invoices` | RLS : permission `received_invoices.view` |
| Modification statut | RLS : permission `received_invoices.process` |
| Fuite clé API | Stockage Cloudflare Secrets uniquement, jamais en DB ni dans le repo |
| Fuite signing_secret | Idem ; rotation via création d'un nouveau webhook côté B2Brouter |

---

## 11. Règles d'affichage UI selon le mode

| Élément UI | `export_only` | `b2brouter` |
|---|---|---|
| Bouton "Télécharger XML / Factur-X" | Visible | Masqué |
| Statut facture émise | "À déposer manuellement" | Temps réel (envoyée / enregistrée DGFiP / acceptée) |
| Bouton "Envoyer électroniquement" | Masqué | Visible (auto sur création si `send_after_import: true`) |
| Section "Factures reçues" | Absente | Visible |
| Badge config | "Export Factur-X" | "Connecté B2Brouter" |
| Audit trail PA | Absent | Visible (depuis `pa_status_events`) |

---

## 12. Plan de développement

### Phase 1 — Fondations (indépendant de B2Brouter)
1. **Générateur Factur-X** (EN 16931 + France CIUS) — couvre les deux modes
2. **UI export_only** — bouton téléchargement + statut "à déposer"
3. **Flag `facturation_b2brouter`** dans `organization_modules` — gate applicatif

### Phase 2 — Intégration B2Brouter émission
4. **Wrapper API** `lib/b2brouter/client.ts` (auth, rate limit, retry)
5. **Script onboarding** `lib/b2brouter/onboarding.ts` (4 étapes API)
6. **Webhook entrant** `/api/webhooks/b2brouter` (signature + dispatch)
7. **Handler `issued_invoice.state_change`** — update facture Atelier
8. **Handler `tax_report.state_change`** — insertion `pa_status_events`
9. **UI** : statut transmission temps réel sur chaque facture émise

### Phase 3 — Réception factures
10. **Cron polling 15 min** `/api/cron/b2brouter-poll`
11. **Insertion `received_invoices`** + récupération XML
12. **UI section "Factures reçues"** : liste + statut paiement + lien chantier optionnel
13. **Action `mark_as`** : propagation CDAR vers PPF (`accepted` / `refused`)

### Phase 4 — Conformité avancée
14. **Handler `ledger.state_change`** — Flux 10 (si clients B2C ou cross-border)
15. **Export CSV factures reçues** pour expert-comptable
16. **Notification artisan** sur nouvelle facture reçue (in-app + email)

---

## 13. Hors scope MVP

- **Multi-PA** : B2Brouter uniquement pour le mode intégré
- **Chorus Pro B2G** : pas de clients secteur public à date — flux DGFiP/Peppol couvre 100% de l'usage artisan
- **Rapprochement automatique** facture reçue ↔ commande
- **Signature électronique avancée** (eIDAS qualifié)
- **Section Factures reçues en mode `export_only`** : réévalué après retours terrain
- **Saisie comptable** : Atelier reste un outil de gestion de chantier, pas un logiciel comptable

---

## 14. Références

- **Doc B2Brouter** : https://developer.b2brouter.net/
- **DGFiP officiel** : https://www.impots.gouv.fr/facturation-electronique-702
- **Peppol BIS 3.0** : https://docs.peppol.eu/poacc/billing/3.0/
- **France CIUS (FR-B2B)** : https://www.fnfe-mpe.org/
- **CGI Article 261** (exemptions TVA) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000006162554/
- **Norme EN 16931** (Core)
- **Format UBL 2.1 / CII D16B**

---

## 15. À éclaircir

- [ ] Confirmer en sandbox qu'il n'existe pas d'event webhook pour les factures reçues (sinon basculer du polling vers push)
- [ ] Récupérer le payload exact de `ledger.state_change` (non documenté à date)
- [ ] Tester la disponibilité réelle de `mark_as` avec `state: "paid"` (annoncé non disponible mais à revérifier)
- [ ] Stratégie de rotation du `signing_secret` webhook (pas documenté côté B2Brouter)
- [ ] Politique de retry exacte de B2Brouter en cas d'échec webhook (timeouts, nombre de tentatives)
