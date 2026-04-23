# Roadmap Agents IA — Atelier

## Contexte

Atelier évolue d'un ERP assisté par IA vers une **plateforme d'agents autonomes**. L'objectif : que l'artisan délègue au maximum les tâches répétitives (relances, devis catalogue, plannings, création chantiers) tout en gardant la main sur les décisions importantes.

Modèle de déploiement : **per-client** (1 Supabase + 1 Next.js deploy par entreprise).

---

## Structure de coûts complète (par client/mois)

### Coûts fixes d'infrastructure

L'infrastructure est **gratuite jusqu'à un certain seuil**, puis monte progressivement.

| Étape | Supabase | Vercel | Coût infra | Déclencheur |
|-------|----------|--------|------------|-------------|
| MVP / early | Free | Free | **€0** | Aujourd'hui |
| Photos chantier s'accumulent | Pro ($25) | Free | **€23** | >1GB Storage ou besoin de backups quotidiens |
| Agents proactifs avec cron | Pro ($25) | Pro ($20) | **€43** | Dès qu'on implémente les crons (relances auto, planning) |

> **Vercel Free** : pas de Cron Jobs. C'est le seul vrai bloquant pour les agents — sans cron, pas d'exécution programmée.
> **Supabase Free** : 500MB DB, 1GB Storage, pas de backups auto. Suffisant au démarrage, mais les photos chantier le remplissent vite.

**Domaine custom** : ~€2/mois (Cloudflare ou OVH), indépendant du reste.

### Coûts IA (OpenRouter)

| Volume | Coût API estimé |
|--------|-----------------|
| Client standard (20 devis/mois, pas d'agents) | ~€0,05/mois |
| Client actif (50 devis, chatbot in-app, planning) | ~€5-12/mois |
| Client WhatsApp agent actif (100+ messages/mois) | ~€10-20/mois |
| Gros client (100+ devis, tous agents actifs) | ~€20-35/mois |

> **Optimisation clé** : Prompt caching Claude (−90% sur le contexte répété), Gemini Flash Lite pour tout ce qui est structuré, Sonnet/Opus uniquement pour le raisonnement et le tool use.

### Facturation électronique B2B — B2Brouter (PDP certifié)

Obligation légale progressive en France :
- **Réception** : toutes entreprises dès septembre 2026
- **Émission** : grandes entreprises sept. 2026 → PME/TPE 2027-2028

**Fournisseur retenu : B2Brouter** (PDP certifié, gère émission + réception, API disponible)
Format requis : XML UBL/CII, JSON, ou Factur-X profil EXTENDED.

**Tarifs B2Brouter (facturation annuelle) :**

| Tranche | Transactions/mois | Prix/mois | Coût unitaire suppl. | Activation |
|---------|-------------------|-----------|----------------------|------------|
| M1 | 100 | €29 | €0,435 | €150 |
| M2 | 300 | €59 | €0,295 | €150 |
| M3 | 600 | €89 | €0,222 | €150 |
| M4 | 1 500 | €169 | €0,169 | €150 |
| M5 | 4 000 | €269 | €0,101 | €150 |

> ⚠️ **Transactions = envoyés + reçus**. Un client qui envoie 50 factures et en reçoit 30 = 80 transactions → tranche M1.

**Modèle revendeur (recommandé) :**
Atelier crée un compte master B2Brouter revendeur → sous-comptes par client → marge sur le pass-through.
- Avantage : facturation centralisée, support technique unifié, meilleur pricing volume global.
- L'activation à €150 est à facturer au client (one-time onboarding fee).

**Impact coût réel par profil :**

| Profil | Transactions/mois | Tranche B2Brouter | Coût mensuel |
|--------|-------------------|-------------------|--------------|
| Petit artisan (20 factures émises, peu de reçues) | ~30 trans | M1 | €29 |
| Artisan actif (50 émises + 30 reçues) | ~80 trans | M1 | €29 |
| Gros client (100 émises + 60 reçues) | ~160 trans | M2 | €59 |
| Très gros (300 émises + 100 reçues) | ~400 trans | M3 | €89 |

### Résumé coût réel total par profil client

| Profil | Infra | IA | B2Brouter | **Total coût** | **Prix vente suggéré** | **Marge** |
|--------|-------|----|-----------|----------------|------------------------|-----------|
| Démarrage (pas d'agents, pas de fact. élec.) | €0 | €0,05 | €0 | **< €5** | €49 | ×10+ |
| Artisan standard (agents basiques) | €23 | €5 | €29 | **€57** | €99 | ×1,7 |
| Artisan actif (tous agents + fact. élec.) | €43 | €15 | €29 | **€87** | €149 | ×1,7 |
| Gros client (100+ devis, WhatsApp, M2) | €43 | €30 | €59 | **€132** | €199 | ×1,5 |

> La marge s'améliore en phase early (infra gratuite) et reste saine même avec tous les modules actifs.

---

## Agents haute valeur — zéro infra (petit artisan)

Ces agents fonctionnent **entièrement sur Free tier** (Supabase Edge Functions, Cloudflare Workers). Déclenchés au clic ou par événement, jamais par cron. Coût IA < €2/mois par artisan standard.

---

### A. Résumé intelligent "Ma semaine"

**Déclencheur** : bouton dans le dashboard (à la demande, jamais automatique)

**Flow :**
```
Clic "Ma semaine"
  → Fetch parallèle : chantiers en cours, devis sans réponse +7j, factures impayées
  → Claude Sonnet 4.6 + context compact (données JSON agrégées, ~500 tokens)
  → Génère résumé en langage naturel :
    "3 chantiers en cours, 2 devis en attente depuis +7j, 1 facture impayée à 1 200€.
     Priorité : relancer Dubois Rénovation."
  → Affiché en overlay dans le dashboard (pas de page dédiée)
```

**Coût** : ~€0,02/clic. **Infra** : zéro (Server Action Next.js, appel API direct).
**Valeur** : l'artisan ne passe plus 10 min à faire le tour de l'app pour savoir quoi faire.

---

### B. Relance email contextuelle intelligente

Deux modes complémentaires, même logique IA sous le capot.

#### B1 — Relance manuelle contextuelle (au clic, zéro infra)

**Déclencheur** : clic "Relancer" sur une facture/devis (remplace l'envoi de template générique)

**Flow :**
```
Clic "Relancer"
  → Fetch historique client (nb relances passées, délais de paiement historiques, montant)
  → Claude Sonnet génère l'email :
    - 1ère relance → ton cordial, rappel simple
    - 2ème relance → plus direct, mentionne délais légaux de paiement
    - 3ème relance → recommande mise en demeure, ton professionnel ferme
  → Artisan voit le brouillon et peut modifier avant envoi
  → Envoi via Resend
```

**Coût** : ~€0,02/email. **Infra** : zéro (événement au clic).
**Différenciateur** : vs un template générique, le ton s'adapte à l'historique réel du client.

#### B2 — Relance auto quotidienne (Cloudflare Worker cron, zéro coût infra)

**Déclencheur** : cron quotidien 8h via cron-job.org → Cloudflare Worker

**Condition** : `auto_reminder_enabled = true` sur l'organisation (déjà en DB)

**Flow :**
```
cron-job.org 08h00 → ping Cloudflare Worker
  → Worker fetch Supabase : factures impayées par org avec auto_reminder_enabled
  → Pour chaque facture overdue :
    → Fetch nb de relances déjà envoyées (table reminders)
    → Si relance_count = 0 et retard > J+7  : relance 1 (cordial)
    → Si relance_count = 1 et retard > J+14 : relance 2 (direct)
    → Si relance_count = 2 et retard > J+21 : relance 3 (mise en demeure)
    → Claude Sonnet génère le corps email (contexte : client, montant, historique)
    → Envoi via Resend
    → Insert dans reminders + log dans activity_log
  → Idem pour devis sans réponse depuis N jours (configurable par org)
```

**Stack** :
- Cloudflare Workers : gratuit (100k requêtes/jour)
- cron-job.org : gratuit
- Resend : gratuit jusqu'à 3 000 emails/mois
- Claude Sonnet 4.6 : ~€0,02/email → **< €1/mois** pour un artisan standard (5-10 relances maxi)

**Coût total** : **€0 infra + < €1 IA/mois**. Meilleur ROI des agents IA pour le petit artisan.

**Base technique existante** : `auto_reminder_enabled`, `reminders` table, `recurring_invoices`, `invoice_schedules` — il faut câbler le Worker + l'appel Claude pour le contenu.

---

### C. Dictée vocale WhatsApp → action dans l'app

**Déclencheur** : message WhatsApp (vocal ou texte) de l'artisan depuis le chantier

**Flow :**
```
Message WhatsApp entrant
  → Supabase Edge Function (webhook Meta Cloud API)
  → Si vocal : Voxtral STT → texte
  → Claude Sonnet + tools (updateChantierStatus, createPointage, sendInvoice...)
  → Exécution des actions + confirmation WhatsApp :
    "✅ Chantier Dupont passé en 'terminé'. Facture envoyée à dupont@email.com."
```

**Exemples concrets** :
- *"J'ai fini le chantier Dupont, mets-le en terminé et envoie la facture"*
- *"6h sur le chantier Martin aujourd'hui avec Karim"*
- *"C'est quoi mes chantiers de demain ?"*

**Coût** : ~€0,03/message (Voxtral + Claude). **Infra** : Supabase Edge Functions gratuit (500k invocations/mois ≈ 1 600 messages/jour).

---

### D. Planification semaine assistée (in-app)

**Déclencheur** : section "Planifier ma semaine" dans le module Planning

**Flow :**
```
Artisan saisit en langage naturel ou via formulaire structuré :
  "Chantier Martin : lundi 8h-12h, équipe Karim + Ahmed
   Chantier Dubois : mardi toute la journée, équipe seule
   Visite chantier Excella : jeudi 14h"
  → Claude parse + crée les créneaux ChantierPlanning
  → Vue semaine mise à jour en temps réel
  → Option : "Optimise la semaine" → Claude réordonne selon distances/priorités
```

**Coût** : ~€0,05/génération planning. **Infra** : zéro (Server Action).
**Valeur** : saisie en langage naturel plutôt que formulaire date/heure/équipe pour chaque créneau.

---

### E. Auto-devis catalogue — logique marge avancée

Le mécanisme de base est en place (demande reçue → devis créé + envoyé). La vraie valeur est dans **la précision de la marge**.

#### Problème actuel
Le devis catalogue génère les lignes au `sale_price` fixe. Mais la marge réelle dépend :
- Du coût MO (variable selon la prestation)
- De la distance chantier (carburant, temps de trajet)
- De l'historique de devis similaires (y a-t-il un devis comparable déjà accepté ?)

#### Solution : Prestations types avec marge configurable

**Nouvelle table `prestation_types`** :
```sql
id UUID, organization_id UUID,
name TEXT NOT NULL,            -- "Pose carrelage 60x60", "Peinture murs intérieurs"
description TEXT,
base_price_ht DECIMAL,         -- prix de vente de base
base_cost_ht DECIMAL,          -- coût réel (MO + matières)
base_margin_pct DECIMAL,       -- calculé : (base_price - base_cost) / base_price * 100
-- Majorations distance (JSON ou colonnes)
distance_rules JSONB,          -- [{"from":0,"to":20,"multiplier":1.0},{"from":20,"to":40,"multiplier":1.08},{"from":40,"to":80,"multiplier":1.15}]
unit TEXT DEFAULT 'm²',
is_active BOOLEAN DEFAULT true
```

**Logique à l'auto-devis** :
```
Demande catalogue reçue
  → Récupérer coordonnées client (via adresse de la demande ou profil client)
  → Calculer distance artisan → client (API Google Maps Distance Matrix ou OpenRouteService gratuit)
  → Pour chaque prestation : appliquer multiplier selon bracket distance
  → Vérifier company_memory : "Devis similaire trouvé (Martin, 85m², carrelage, accepté à X€)" → proposer
  → Créer devis avec prix ajusté + lignes internes (is_internal: true) pour le coût réel
```

**Mémoire d'entreprise sur les devis similaires** :
- `company_memory` table déjà en DB → alimentée à chaque devis accepté avec résumé JSON
- Prompt Claude : "Voici les 3 derniers devis acceptés pour des prestations similaires : [context]. Propose un prix cohérent."
- Embedding sur titre/description devis → recherche sémantique des devis proches (text-embedding-3-small)

---

## Niveau 1 — Automatisations simples (≈ 4-6 semaines)

### 1.1 Auto-création chantier depuis devis accepté
**Trigger** : `markQuoteAccepted()` → si pas de chantier lié → propose ou crée automatiquement.

**Flow :**
```
Devis accepté
  → Vérifier si chantier existe (quote_id unique)
  → Si non : créer chantier avec titre/client/budget du devis + suggestion équipe chantier
  → Notification artisan "Chantier créé, vérifiez les détails"
```

**Fichiers** : `mutations/chantiers.ts` + `mutations/quotes.ts` (hook dans `markQuoteAccepted`)

### 1.2 Auto-envoi devis catalogue (one-click)
**Trigger** : Demande catalogue convertie → bouton "Créer et envoyer directement".

**Flow :**
```
createQuoteFromCatalogRequest()
  → sendQuoteEmail() immédiatement (pas d'ouverture éditeur)
  → Statut demande → converted
  → Notification artisan avec lien "Voir le devis envoyé"
```

**Condition** : uniquement si `public_form_catalog_item_ids` et `purchase_price` renseignés (marge calculable).

### 1.3 Relances proactives autonomes
Système déjà partiellement en place (`auto_reminder_enabled` sur organizations).

**À compléter :**
- Edge Function Supabase déclenchée par `pg_cron` (quotidien à l'heure configurée)
- Requête : devis envoyés sans réponse depuis N jours + factures impayées
- Envoi email via Resend avec template personnalisé
- Log dans `activity_log`

**Pas d'IA nécessaire** — logique pure, fiable, coût quasi nul.

---

## Niveau 2 — Agent in-app (chatbot invisible)

### Principe
L'agent n'est pas un chatbot visible en permanence. C'est une **icône discrète** (ou raccourci clavier) qui ouvre une interface contextuelle. L'artisan peut dire :
- *"Crée un devis pour M. Dupont, réfection toiture 200m²"*
- *"Qu'est-ce que j'ai à faire cette semaine ?"*
- *"Relance tous les devis envoyés il y a plus de 7 jours"*
- *"Quel est mon CA du mois ?"*

### Architecture
```
Input utilisateur (texte)
  → Claude Sonnet 4.6 avec tools définis
  → Tools = server actions existantes (createQuote, getChantiers, updateTache...)
  → Claude choisit et appelle les tools
  → Réponse naturelle + action effectuée
```

### Tools à exposer (phase 1)
```typescript
tools: [
  getChantiers(),          // lire l'état des chantiers
  getQuotes(),             // lire les devis
  createQuote(params),     // créer un devis
  updateChantierStatus(),  // changer le statut
  getStats(),              // dashboard KPIs
  sendQuoteEmail(),        // envoyer un devis
  createTache(),           // ajouter une tâche chantier
]
```

### Mémoire contextuelle
- `company_memory` table déjà en base → injectée dans le system prompt
- Historique conversation stocké en DB (table `agent_conversations` à créer)
- Prompt caching sur le contexte long (catalogue, clients récurrents)

### Modèle recommandé
- Claude Sonnet 4.6 pour les actions courantes (~0,02€/message)
- Claude Opus 4.7 uniquement pour les raisonnements complexes (planning multi-chantiers)

---

## Niveau 3 — Agent WhatsApp

### Stack technique
```
WhatsApp Business API (Meta Cloud API — gratuit jusqu'à 1000 conv/mois)
  → Webhook → Supabase Edge Function
  → Déchiffrement message (texte / vocal / image)
  → Si vocal → Voxtral STT → texte
  → Claude Sonnet 4.6 + tools (même tools que in-app)
  → Réponse WhatsApp
  → Actions persistées en DB
```

### Conversations supportées
- Créer/envoyer un devis : *"Envoie un devis à M. Martin pour la pose de carrelage"*
- Status chantier : *"C'est quoi l'avancement du chantier Excella ?"*
- Pointages : *"J'ai fait 6h sur le chantier Dupont aujourd'hui"*
- Urgences : *"La facture Renard est toujours impayée, relance-le"*
- Rapports : *"Résume ma semaine"*

### Gestion des ambiguïtés
L'agent demande confirmation avant toute action irréversible (envoyer, supprimer).
Seuil de confiance : si score < 0,8 → demande clarification plutôt qu'agir.

### Coût WhatsApp API
- Meta : gratuit jusqu'à 1000 conversations initiées par l'entreprise/mois
- Au-delà : ~€0,05-0,08 par conversation (24h window)
- Pour un artisan standard : **gratuit ou < €5/mois**

---

## Niveau 4 — Agents proactifs autonomes (scheduled)

### Planning hebdomadaire intelligent
**Trigger** : Cron lundi matin 7h

**Flow :**
```
Récupérer tous les chantiers en_cours / planifiés
  + Contraintes (équipes disponibles, distances, récurrences)
  + Météo API (optionnel — travaux extérieurs)
  → Claude Opus : "Organise la semaine optimale"
  → Génère un planning suggéré
  → Notification artisan : "Votre planning de la semaine est prêt"
  → Artisan valide ou ajuste
```

**Important** : l'agent *suggère*, l'artisan *valide*. Pas d'application automatique du planning.

### Agent relance intelligent (au-delà des relances simples)
Au lieu d'envoyer le même template, l'agent adapte le ton :
- 1ère relance → cordial
- 2ème relance → plus direct, mentionne les pénalités
- 3ème relance → recommande de passer au recouvrement

Claude Sonnet génère l'email sur mesure à partir du template + historique client.

### Auto-devis depuis devis accepté récurrent
Pour les clients avec prestations récurrentes (entretien mensuel, etc.) :
- Détecte les `recurrence` configurés sur les chantiers
- Génère automatiquement le devis du mois suivant
- Envoie pour validation artisan (pas d'envoi client auto)

---

## Niveau 5 — Acquisition clients (agents scraping)

### Sources de leads BTP
- **Google Maps** (SerpAPI) → entreprises locales cherchant des artisans
- **MaPrimeRénov / Anah** → projets de rénovation déclarés publiquement
- **Leboncoin / SeLoger Travaux** → demandes publiées
- **LinkedIn** → décideurs dans la construction/immobilier

### Pipeline
```
Source externe
  → Scraping via Apify / SerpAPI
  → Déduplication (embeddings text-embedding-3-small)
  → Scoring IA (potentiel × proximité géographique × secteur)
  → Import dans clients (status: lead_cold)
  → Artisan voit la liste avec score et contexte
  → Artisan appelle / envoie email depuis l'app
```

### Enrichissement
- Hunter.io / Kaspr → trouver emails professionnels
- Société.com / Infogreffe → données légales entreprise (SIRET, CA)
- Tout injecté dans la fiche client automatiquement

### Coûts scraping
| Service | Coût | Volume |
|---------|------|--------|
| SerpAPI | $50/mois | 5000 requêtes |
| Apify | $49/mois | 100h compute |
| Hunter.io | $49/mois | 500 enrichissements |
| **Total** | **~€130/mois** | — |

→ À facturer dans un "module acquisition" à €199/mois (marge ×1,5).

---

## Infrastructure — Décision Cloudflare

**Décision actée : déploiement sur Cloudflare Pages + Workers** (en remplacement de Vercel)

| Service | Vercel | Cloudflare | Avantage |
|---------|--------|------------|----------|
| Hébergement Next.js | Free / $20 Pro | Pages (gratuit, illimité) | €0 vs €20/mois |
| Cron Jobs | Pro uniquement | Workers Cron (gratuit) | Déblocage agents proactifs sans coût |
| Storage photos | — | R2 (10GB gratuit, zéro egress) | vs Supabase Storage limité |
| Edge Functions | — | Workers (100k req/jour gratuit) | WhatsApp webhook, relances auto |
| CDN | Oui | Oui (Anycast mondial) | Équivalent |

**Adaptation technique** : `@cloudflare/next-on-pages` + `nodejs_compat` flag. Quelques contraintes Edge Runtime (pas de `fs`, crypto via Web Crypto API) mais tout le code actuel est compatible.

**Conséquence** : les crons Cloudflare Workers remplacent le workaround cron-job.org. Tout devient natif.

---

## Ordre d'implémentation — Version révisée

**Périmètre validé pour constituer une app très forte :**
Agents A→E + Auto-création chantier (1.1) + Agent in-app + Système de notifications push

### Priorité 1 — Foundation agents (zéro infra supplémentaire)

| # | Module | Délai | Notes |
|---|--------|-------|-------|
| **0a** | Résumé "Ma semaine" (dashboard) | 3j | Premier agent visible, demo immédiate |
| **0b** | Relance email contextuelle IA (au clic) | 2j | Remplace template générique |
| **0c** | Relance auto quotidienne (Cloudflare Worker cron) | 1 sem | Base technique déjà en DB |
| **0d** | Prestations types + marge distancielle | 2 sem | Cœur différenciant du devis catalogue |
| **0e** | Planification semaine assistée (in-app) | 1 sem | — |
| **1.1** | Auto-création chantier depuis devis accepté | 3j | Déjà partiellement planifié |

### Priorité 2 — WhatsApp agent (Supabase Edge Functions)

| # | Module | Délai | Notes |
|---|--------|-------|-------|
| **0f** | WhatsApp texte → actions in-app | 3-4 sem | Couvre ~80% des cas d'usage de l'agent in-app |
| **0g** | WhatsApp vocal (Voxtral STT) | +1 sem | Artisan sur chantier les mains sales |

> L'agent WhatsApp (0f+0g) couvre la majorité des cas de l'agent in-app → l'agent in-app devient optionnel, à implémenter après selon la demande.

### Priorité 3 — Notifications système

| # | Module | Délai | Notes |
|---|--------|-------|-------|
| **N1** | Notifications in-app temps réel (Supabase Realtime) | 1 sem | Badge + drawer notifications |
| **N2** | Push notifications PWA (Web Push API) | 1 sem | Alerte sur mobile même hors app |
| **N3** | Notifications WhatsApp proactives | 3j | "Votre planning de la semaine est prêt" |

### Priorité 4 — Légal + croissance

| # | Module | Délai | Notes |
|---|--------|-------|-------|
| — | Agent in-app (chatbot complet) | 3-4 sem | Optionnel si WhatsApp agent satisfaisant |
| — | Facturation électronique B2Brouter | 4-6 sem | Légal, deadline 2026 |
| — | Acquisition leads (scraping) | 8-12 sem | Module premium €199/mois |

---

## Hors scope (à réévaluer plus tard)

- Signature électronique intégrée au formulaire public
- Paiement en ligne acompte
- Application mobile native (le PWA suffit pour le terrain)
- Multi-langue
- Portail client self-service complet
- Comptabilité export (FEC, intégration expert-comptable) — sauf si demande forte
