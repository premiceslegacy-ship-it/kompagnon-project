# Scope 2 — Estimation IA de la main d'œuvre

## Principe

Les artisans vendent un résultat, pas une équipe. Le client voit des prestations avec un prix global ; la main d'œuvre (MO) est intégrée dans ces prix sans être détaillée. En interne, l'artisan suit sa MO pour calculer sa marge.

Le flag `is_internal` sur `quote_items` (migration 035) implémente déjà la séparation. Ce scope construit l'assistant IA qui génère ces lignes internes automatiquement.

---

## Flow utilisateur

1. L'artisan est dans l'éditeur de devis, il a saisi la description du chantier
2. Il clique **"Estimer la main d'œuvre"** → un panneau latéral s'ouvre
3. Il compose l'équipe pour ce devis :
   - Sélection depuis le catalogue MO (table `labor_rates`)
   - Si un profil manque → **saisie libre** : nom + taux + unité → bouton "Enregistrer dans le catalogue" → insertion dans `labor_rates` pour les prochains devis
4. L'IA reçoit : description du chantier + liste des profils sélectionnés (désignation, taux, unité)
5. L'IA estime la quantité par profil → résultat affiché dans le panneau, **modifiable manuellement** avant validation
6. L'artisan valide → génération automatique des lignes internes (`is_internal: true`, un item par profil)
7. Un encart **Marge interne** apparaît dans l'éditeur (visible uniquement en interne, jamais dans le PDF)

---

## Unités

Le catalogue MO supporte des unités flexibles (champ `unit` déjà présent sur `labor_rates`) :
- `h` — heure (électricien, plombier...)
- `j` — jour (charpentier, maçon...)
- `sem` — semaine
- Toute unité personnalisée

L'IA adapte son estimation à l'unité configurée dans le profil. Si l'électricien est en h, l'IA répond en heures.

---

## Encart marge interne (dans l'éditeur de devis)

Visible uniquement en interne, jamais dans le PDF client.

```
┌─────────────────────────────────────────┐
│  Récap marge interne                    │
│                                         │
│  Total client (lignes visibles)  2 500€ │
│  Coût MO                        −1 050€ │
│  Coût transport                   −80€  │
│  ─────────────────────────────────────  │
│  Marge brute estimée             1 370€ │
│  Marge %                          54,8% │
└─────────────────────────────────────────┘
```

Les matériaux, fournitures, etc. ne sont pas calculés ici — l'artisan les gère de son côté.

---

## Ligne transport (optionnel)

Une ligne interne `is_internal: true` pour le coût de déplacement.

**Calcul** : distance (km) × consommation (L/100km) × prix du litre (€)

- Distance et consommation : saisies par l'artisan
- Prix du litre : saisie manuelle (l'artisan connaît son prix pompe) — pas d'API externe en v1
- Génère automatiquement une ligne *"Transport"* interne dans le devis

---

## Ce qui existe déjà

| Élément | État |
|---------|------|
| `quote_items.is_internal` | ✅ Migration 035 |
| `labor_rates` (catalogue MO) | ✅ Table existante avec `unit`, `rate` |
| Filtre PDF lignes internes | ✅ Implémenté dans QuotePDF |
| Totaux PDF = lignes visibles uniquement | ✅ Implémenté |
| Bouton toggle EyeOff dans l'éditeur | ✅ Implémenté |

---

## Ce qui reste à construire

| # | Élément | Fichiers concernés |
|---|---------|-------------------|
| 1 | Panneau "Estimer la MO" dans l'éditeur | `QuoteEditorClient.tsx` |
| 2 | Sélecteur catalogue MO (multi-profils) | `QuoteEditorClient.tsx` |
| 3 | Saisie libre + enregistrement catalogue | `QuoteEditorClient.tsx` + `mutations/catalog.ts` |
| 4 | Endpoint IA `POST /api/ai/estimate-labor` | `src/app/api/ai/estimate-labor/route.ts` |
| 5 | Résultats IA ajustables manuellement | `QuoteEditorClient.tsx` |
| 6 | Génération lignes internes MO | `mutations/quotes.ts` (upsertQuoteItem) |
| 7 | Encart marge interne dans l'éditeur | `QuoteEditorClient.tsx` |
| 8 | Ligne transport avec calcul carburant | `QuoteEditorClient.tsx` |

---

## Prompt IA (ébauche)

```
Tu es un assistant pour artisan BTP. 
On te donne la description d'un chantier et une liste de profils de main d'œuvre disponibles.
Estime le nombre d'unités (heures ou jours selon l'unité du profil) nécessaires pour chaque profil.
Réponds uniquement en JSON : [{ "labor_rate_id": "...", "designation": "...", "quantity": number, "unit": "h"|"j"|... }]
Sois réaliste et conservateur dans tes estimations.
```

---

## Hors scope v1

- Récupération automatique du prix du carburant via API
- Calcul automatique de la distance via API Maps
- Suivi réel vs estimé (comparer MO devis vs MO chantier pointée)
- Export marges en comptabilité
