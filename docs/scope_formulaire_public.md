# Formulaire public de demande de devis

## Principe

Chaque organisation dispose d'une URL publique (sans authentification) où ses prospects peuvent soumettre une demande de devis. Deux modes coexistent selon la nature de la demande.

URL publique : `/demande/[orgSlug]`

---

## Mode 1 — Catalogue (devis automatique)

### Cas d'usage
Le prospect choisit parmi des prestations prédéfinies. Le devis se génère automatiquement, l'artisan n'a qu'à valider et envoyer.

### Flow prospect (formulaire public)
1. Le prospect arrive sur le formulaire public de l'organisation
2. Il renseigne ses coordonnées (nom, email, téléphone, entreprise optionnel)
3. Il voit les **prestations du catalogue** exposées par l'artisan (subset du catalogue, l'artisan choisit ce qu'il rend public)
4. Il sélectionne les prestations souhaitées + quantités
5. Il soumet → confirmation par email automatique

### Flow artisan (dashboard)
1. Notification dans le dashboard ("Nouvelle demande") + badge compteur sur l'onglet Demandes
2. L'artisan ouvre **Demandes** dans la navigation → il voit la demande en statut `new`
3. Il consulte le détail : coordonnées + prestations sélectionnées
4. Un brouillon de devis est **déjà généré** avec les lignes catalogue correspondantes (sans MO — à ajouter si besoin)
5. L'artisan peut modifier les lignes, quantités, prix
6. **Un clic "Envoyer"** → devis envoyé au prospect → statut passe à `converted`

### Ce qui se génère automatiquement
- Création du client (depuis les coordonnées du prospect) si n'existe pas encore
- Brouillon devis avec les items catalogue sélectionnés (`is_internal: false`)
- Numéro de devis auto
- Lien `quote_requests.quote_id` et `quote_requests.client_id` mis à jour

---

## Mode 2 — Sur-mesure (devis IA)

### Cas d'usage
La demande est complexe ou atypique. Le prospect décrit son besoin en texte libre (cahier des charges). L'IA génère un premier jet de devis que l'artisan affine avant envoi.

### Flow prospect (formulaire public)
1. Coordonnées + sélection du mode "Devis sur-mesure"
2. Champ texte libre : description détaillée des travaux
3. Upload de fichiers optionnel (photos, plans) — stockage Supabase Storage
4. Soumission → confirmation par email

### Flow artisan (dashboard)
1. Notification + badge sur l'onglet Demandes
2. L'artisan ouvre **Demandes** → consulte la demande en statut `new`
3. Aperçu : coordonnées + description + fichiers joints
4. Bouton **"Générer le devis avec l'IA"** → l'IA lit la description et génère un brouillon (même flow que le devis IA existant dans l'éditeur)
5. L'artisan ouvre l'éditeur de devis pré-rempli, ajuste les lignes, ajoute la MO interne si besoin
6. Validation et envoi → statut `converted`

---

## UI du formulaire public

```
┌─────────────────────────────────────────────────────────┐
│  [Logo org]  Demande de devis — [Nom organisation]      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Vos coordonnées                                        │
│  Nom *          [________________]                      │
│  Email *        [________________]                      │
│  Téléphone      [________________]                      │
│  Entreprise     [________________]                      │
│                                                         │
│  Type de demande                                        │
│  ◉ Je choisis parmi vos prestations                     │
│  ○ Projet sur-mesure à décrire                          │
│                                                         │
│  ── Mode catalogue ────────────────────────────────     │
│  ☐ Réfection toiture           [Qté : ___] [unité]     │
│  ☐ Pose de charpente           [Qté : ___] [unité]     │
│  ☐ Isolation combles           [Qté : ___] [unité]     │
│                                                         │
│  ── Mode sur-mesure ───────────────────────────────     │
│  Description des travaux *                              │
│  [                                    ]                 │
│  [                                    ]                 │
│  Joindre des fichiers  [📎 Parcourir]                  │
│                                                         │
│  [     Envoyer ma demande     ]                         │
└─────────────────────────────────────────────────────────┘
```

---

## Paramétrage côté artisan (Paramètres > Formulaire public)

| Option | Description |
|--------|-------------|
| Activer le formulaire | On/Off |
| Prestations visibles | Sélection des items catalogue à exposer publiquement |
| Message d'accueil | Texte personnalisé affiché en haut du formulaire |
| Email de notification | Adresse(s) notifiées à chaque demande |
| Mode sur-mesure | Activer / désactiver le mode cahier des charges |

---

## Migration DB nécessaire

La table `quote_requests` existe (migration 013) mais manque :

```sql
ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'custom',
  -- 'catalog' | 'custom'
  ADD COLUMN IF NOT EXISTS catalog_items JSONB,
  -- [{ material_id|labor_rate_id, description, quantity, unit, unit_price }]
  ADD COLUMN IF NOT EXISTS attachments JSONB;
  -- [{ storage_path, filename, size }]
```

---

## Ce qui existe déjà

| Élément | État |
|---------|------|
| Table `quote_requests` | ✅ Migration 013 (name, email, description, status, client_id, quote_id) |
| RLS public INSERT | ✅ Toute soumission autorisée |
| Système devis IA | ✅ Existant dans l'éditeur |
| `is_internal` / MO | ✅ Migration 035 |
| Envoi devis par email | ✅ Implémenté |

## Navigation dans l'app

**Demandes** est un onglet de premier niveau dans la topbar, entre Dashboard et Clients.

```
Dashboard | Demandes 🔴3 | Clients | Chantiers | Devis & Factures | Catalogue
```

- Badge rouge avec compteur des demandes non lues (`status = 'new'`)
- Les demandes n'apparaissent **pas** dans la liste Clients ni dans Finances tant qu'elles n'ont pas été converties
- La conversion (client créé + devis généré) se fait **depuis** la page Demandes, pas l'inverse
- Statuts visibles dans la liste : `Nouvelle` · `Lue` · `Convertie` · `Archivée`

---

## Ce qui reste à construire

| # | Élément | Fichiers concernés |
|---|---------|-------------------|
| 1 | Migration 036 (type + catalog_items + attachments) | `supabase/migrations/036_quote_requests_v2.sql` |
| 2 | Page publique `/demande/[orgSlug]` | `src/app/(public)/demande/[orgSlug]/page.tsx` |
| 3 | Server action `submitQuoteRequest` | `src/lib/data/mutations/quote-requests.ts` |
| 4 | Paramétrage prestations publiques | `src/app/(app)/settings/formulaire/` |
| 5 | Page liste demandes dans dashboard | `src/app/(app)/demandes/` |
| 6 | Génération devis auto (mode catalogue) | `mutations/quote-requests.ts` → `createQuoteFromRequest` |
| 7 | Bouton "Générer avec l'IA" (mode sur-mesure) | `src/app/(app)/demandes/[id]/page.tsx` |
| 8 | Upload fichiers (Supabase Storage) | bucket `quote-request-attachments` |
| 9 | Email confirmation au prospect | `src/lib/email/templates/` |
| 10 | Notification artisan (email + dashboard) | `src/lib/email/templates/` + dashboard |

---

## Hors scope v1

- Portail client pour suivre l'état de sa demande
- Chat/messagerie entre artisan et prospect dans la demande
- Signature électronique depuis le formulaire public
- Paiement en ligne de l'acompte à la validation
- Multi-langue sur le formulaire public
