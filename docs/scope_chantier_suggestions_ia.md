# Chantier — Suggestions IA (tâches & équipes)

## Contexte

Quand un chantier est créé depuis un devis (via la modal "Nouveau chantier" avec sélection de devis), deux types de suggestions IA peuvent être proposées :
1. **Tâches suggérées** à partir des prestations du devis
2. **Équipes suggérées** à partir des lignes MO internes du devis

Dans les deux cas, l'utilisateur garde la main complète — les suggestions sont un point de départ, pas une décision automatique.

---

## 1. Suggestions de tâches depuis le devis

### Déclenchement

À la création du chantier lié à un devis, ou depuis l'onglet Tâches via un bouton **"Importer depuis le devis"** si le chantier a un `quote_id`.

### Flow

1. Le système récupère les lignes visibles du devis (`is_internal = false`)
2. L'IA traduit ces prestations en tâches concrètes de chantier
   - Ex : *"Fourniture et pose de charpente"* → *"Dépose ancienne charpente"*, *"Livraison bois"*, *"Pose charpente"*, *"Contrôle et finitions"*
3. Les tâches suggérées apparaissent dans un panneau dédié (pas encore dans la liste principale) avec un badge "Suggestion IA"
4. L'utilisateur peut :
   - ✅ **Valider** une tâche → elle rejoint la liste avec statut `a_faire`
   - ✏️ **Modifier** le titre avant de valider
   - 🗑️ **Supprimer** une suggestion non pertinente
   - ↕️ **Réordonner** les suggestions avant import groupé
   - **Tout ignorer** et saisir les tâches à la main comme d'habitude

### UI

```
┌── Suggestions IA (depuis le devis) ─────────────────┐
│  ↕ Dépose ancienne charpente           [✏️] [✅] [🗑️] │
│  ↕ Livraison bois et matériaux         [✏️] [✅] [🗑️] │
│  ↕ Pose charpente                      [✏️] [✅] [🗑️] │
│  ↕ Contrôle et finitions               [✏️] [✅] [🗑️] │
│                                                      │
│  [Valider toutes]  [Tout ignorer]                    │
└──────────────────────────────────────────────────────┘
```

Les suggestions validées s'ajoutent à la liste des tâches dans l'ordre défini.

### Prompt IA (ébauche)

```
Tu es un assistant pour artisan BTP.
On te donne la liste des prestations d'un devis.
Génère une liste de tâches concrètes et ordonnées pour réaliser ce chantier.
Chaque tâche doit être courte, actionnable, dans l'ordre logique de réalisation.
Réponds uniquement en JSON : [{ "title": "...", "position": number }]
```

---

## 2. Suggestions d'équipes depuis la MO du devis

### Déclenchement

À la création du chantier lié à un devis (qui a des lignes MO internes), ou depuis l'onglet Équipes via **"Suggérer depuis le devis"**.

### Données sources

Les lignes `is_internal = true` du devis lié au chantier : désignation, quantité, unité, taux.

Ex depuis le devis :
- Charpentier — 4 jours × 350€/j
- Manœuvre — 3 jours × 200€/j

### Flow

1. Le système lit les lignes MO internes du devis
2. Propose de créer ou assigner des équipes correspondantes au chantier
3. L'utilisateur peut ajuster :
   - **Nombre de personnes** dans chaque équipe
   - **Consignes** spécifiques pour ce chantier (texte libre)
   - **Code couleur** de l'équipe dans le planning
   - **Dates d'intervention** suggérées (calculées depuis les quantités × jours)
   - Ajouter / retirer des membres

### UI (dans l'onglet Équipes)

```
┌── Suggestions depuis le devis ─────────────────────────┐
│                                                         │
│  🟦 Équipe Charpenterie               [Modifier] [✅]   │
│     Profil : Charpentier · 4j estimés                  │
│     Membres : [+ Ajouter]                               │
│                                                         │
│  🟩 Équipe Manœuvre                   [Modifier] [✅]   │
│     Profil : Manœuvre · 3j estimés                     │
│     Membres : [+ Ajouter]                               │
│                                                         │
│  [Valider toutes]  [Tout ignorer]                       │
└─────────────────────────────────────────────────────────┘
```

### Paramètres éditables par équipe

| Champ | Description |
|-------|-------------|
| Nom | Nom de l'équipe (pré-rempli depuis la désignation MO) |
| Couleur | Code couleur dans le planning (picker) |
| Nombre | Nb de personnes prévues |
| Consignes | Texte libre : EPI requis, accès, contact sur place... |
| Durée estimée | Pré-remplie depuis les jours/heures du devis, modifiable |
| Membres | Sélection parmi les profils de l'organisation |

---

## Ce qui existe déjà

| Élément | État |
|---------|------|
| Lien chantier → devis à la création | ✅ Implémenté |
| `quote_items.is_internal` | ✅ Migration 035 |
| Tâches chantier (`chantier_taches`) | ✅ Table + UI |
| Équipes chantier (`chantier_equipes`) | ✅ Table + UI |
| Drag & drop réordonnancement tâches | ✅ Implémenté |

## Ce qui reste à construire

| # | Élément | Fichiers concernés |
|---|---------|-------------------|
| 1 | Endpoint `POST /api/ai/suggest-tasks` | `src/app/api/ai/suggest-tasks/route.ts` |
| 2 | UI panneau suggestions tâches | `ChantierDetailClient.tsx` (onglet Tâches) |
| 3 | Import groupé avec réordonnancement | `ChantierDetailClient.tsx` |
| 4 | Lecture lignes MO internes du devis lié | `queries/quotes.ts` (getQuoteInternalItems) |
| 5 | UI panneau suggestions équipes | `ChantierDetailClient.tsx` (onglet Équipes) |
| 6 | Picker couleur équipe | `ChantierDetailClient.tsx` |
| 7 | Champ consignes sur équipe | Migration + `chantier_equipes` |

---

## Hors scope v1

- Suggestions de planning automatique (dates d'intervention calculées depuis les quantités)
- Détection de conflits entre équipes sur le planning
- Suivi réel MO chantier vs MO estimée dans le devis
