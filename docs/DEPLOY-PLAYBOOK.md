# DEPLOY-PLAYBOOK.md — Métier OS
### Guide de redéploiement client — De zéro à app livrée
### Workflow vibe coding : 1 à 3 sessions dans l'IDE

> **Objectif :** Livrer une app Métier OS complète, branded et peuplée pour un nouveau client
> en moins d'une demi-journée de travail effectif.
>
> **Modèle :** Une app par client — repo Git dupliqué, Supabase project dédié, domaine dédié.
> Chaque client a son instance isolée. Zéro risque de fuite de données entre clients.

---

## VUE D'ENSEMBLE — LES 3 SESSIONS

```
SESSION 1 — CONFIGURATION (30 min)
  Duplication repo + variables d'env + branding + secteur
  → Résultat : app qui tourne avec l'identité du client

SESSION 2 — IMPORT DONNÉES (1-3h selon volume)
  Import clients + historique devis/factures
  → Résultat : app peuplée, mémoire d'entreprise construite

SESSION 3 — PARAMÉTRAGE MÉTIER (30 min)
  Tarifs, matériaux, templates emails, objectifs CA
  → Résultat : app prête à être livrée
```

---

## PRÉ-REQUIS — FICHE CLIENT À REMPLIR AVANT LE DÉPLOIEMENT

Avant de lancer la Session 1, remplir cette fiche en 15 minutes avec le client :

```markdown
## FICHE CLIENT — [NOM ENTREPRISE]

### IDENTITÉ
Nom légal            :
Nom commercial       :
SIRET               :
RCS (ville)          :
Forme juridique      : (SARL / SAS / EI / EURL / SA)
Numéro TVA intra     :
Code NAF/APE        :
Adresse complète     :
Email facturation    :
Téléphone           :
Site web            :

### SECTEUR ET MÉTIER
Secteur principal    : (tolerie / plomberie / renovation / menuiserie / electricite / facade / autre)
Secteur secondaire   : (optionnel)
Description activité : (2 lignes max)
Certifications       : (RGE / Qualibat / autre)
Assurance décennale  : (numéro + assureur)
RC Pro              : (numéro + assureur)

### BRANDING
Couleur principale   : (hex ou décrire — ex: "bleu marine", "rouge bordeaux")
Couleur secondaire   : (optionnel)
Logo               : (fichier SVG ou PNG fond transparent fourni ?)
Police souhaitée     : (optionnel — défaut : Plus Jakarta Sans)
Nom affiché dans l'app : (ex: "Tôlerie Martin" ou "Martin Industries")

### ÉQUIPE
Nombre d'utilisateurs prévus :
Rôles :
  - [Prénom Nom] → owner (le dirigeant)
  - [Prénom Nom] → manager / commercial / employee
  - ...

### DONNÉES À IMPORTER
Clients             : (nombre estimé, format dispo : Excel / CSV / extraction ERP)
Devis historiques   : (période, format : Excel / PDF / ERP)
Factures historiques: (période, format : Excel / PDF / ERP)
ERP actuel          : (Sage / EBP / Pennylane / Excel / rien / autre)

### PARAMÈTRES MÉTIER
Taux horaire        : (€/h — si différent par type de prestation, lister)
TVA principale      : (20% / 10% / 5.5% — selon secteur)
Délai paiement      : (30 jours / 45 jours / ?)
Préfixe devis       : (ex: DEV, QT, PRO)
Préfixe facture     : (ex: FAC, INV, F)
Numéro dernier devis: (pour continuer la séquence)
Numéro dernière fact: (pour continuer la séquence)
Pénalités retard    : (% légal : 3× taux BCE = ~12% en 2024)

### OBJECTIFS (pour le dashboard)
Objectif CA annuel  : (€)
Objectif CA mensuel : (€ ou "CA annuel / 12")
Visibilité objectifs: (tout le monde / responsables uniquement / configurable)

### ACCÈS ET DOMAINE
Domaine souhaité    : (ex: gestion.tolerie-martin.fr ou app.martin-industries.fr)
Email expéditeur    : (ex: noreply@tolerie-martin.fr — ou on utilise Métier OS)
```

---

## SESSION 1 — CONFIGURATION (Prompt 1)

### Étape 1.1 — Duplication du repo

```bash
# Dans le terminal
git clone https://github.com/[ton-compte]/metier-os-base [nom-client]-app
cd [nom-client]-app
git remote set-url origin https://github.com/[ton-compte]/[nom-client]-app
git push -u origin main

# Créer un nouveau project Supabase (EU region)
# → dashboard.supabase.com → New Project
# Nommer : metier-os-[nom-client]
# Région : West EU (Ireland)

# Créer un nouveau projet Vercel
# → vercel.com → New Project → Import depuis GitHub
```

### Étape 1.2 — Variables d'environnement

Copier `.env.local.example` → `.env.local` et remplir :

```bash
# Supabase (nouveau project client)
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]

# IA — choisir selon le modèle retenu
GEMINI_API_KEY=...          # Google AI Studio (actuellement utilisé)
# ANTHROPIC_API_KEY=sk-ant-...  # Si pivot vers Claude
# OPENROUTER_API_KEY=...        # Si pivot vers OpenRouter

# Relances automatiques (Vercel Cron)
CRON_SECRET=...             # Chaîne aléatoire longue — protège /api/cron/reminders

# Resend
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@[domaine-client]
RESEND_FROM_NAME=[Nom entreprise client]

# App
NEXT_PUBLIC_APP_URL=https://[domaine-client]
NEXT_PUBLIC_APP_NAME=[Nom entreprise client]
```

### Étape 1.3 — Prompt de personnalisation branding (Prompt 1 IDE)

```
Charge /docs/PROMPT-SYSTEM.md.

Je déploie l'app pour un nouveau client. Voici sa fiche :

CLIENT : [Nom entreprise]
SECTEUR : [secteur]
COULEUR PRINCIPALE : [hex]
COULEUR SECONDAIRE : [hex ou none]
NOM AFFICHÉ : [nom dans l'app]
LOGO : [url ou "à uploader"]
POLICE TITRE : [famille ou "défaut"]

Effectue les modifications suivantes :

1. Dans /data/client-config.ts :
   Mets à jour CLIENT_CONFIG avec toutes les informations du client.

2. Dans /app/globals.css :
   Remplace --accent-primary par [hex couleur principale].
   Recalcule --accent-glow (couleur principale à 20% opacité).
   Recalcule --accent-subtle (couleur principale à 10% opacité).
   Recalcule --border-accent (couleur principale à 30% opacité).
   Si police différente : remplace --font-display.

3. Dans /public/ :
   Indique-moi où placer le logo (logo.svg et logo-dark.svg).
   Génère le favicon SVG correspondant au secteur.

4. Dans /data/sector-config.ts :
   Active le template secteur [secteur].
   Vérifie que la terminologie métier est correcte.

5. Dans /lib/email-templates/config.ts :
   Mets à jour le tone voice selon le secteur et les paramètres client.

Montre-moi les fichiers modifiés. Ne touche à rien d'autre.
```

---

## SESSION 2 — IMPORT DONNÉES (Prompt 2)

### Étape 2.1 — Migration Supabase

```bash
# Appliquer les migrations sur le nouveau project
supabase db push --db-url [url-project-client]

# Ou via CLI
supabase link --project-ref [project-ref]
supabase db push
```

### Étape 2.2 — Seed organisation

```
Charge /docs/PROMPT-SYSTEM.md.

Je dois créer l'organisation de base et le compte owner pour le client.

DONNÉES ORGANISATION :
[Coller les données de la fiche client — section IDENTITÉ + PARAMÈTRES MÉTIER]

Génère et exécute le script SQL de seed dans /supabase/seeds/[nom-client]-seed.sql :

1. INSERT organizations avec toutes les données légales
2. INSERT le compte owner (auth.users via Supabase Admin API, puis profiles + memberships)
3. INSERT les taux horaires depuis la fiche (au moins 1 par défaut)
4. INSERT les matériaux de base selon le secteur [secteur]
   (utilise /data/sector-templates/[secteur].json comme base)
5. INSERT les objectifs CA dans goals table
6. Mets à jour la séquence last_quote_number à [numéro]
7. Mets à jour la séquence last_invoice_number à [numéro]

Montre-moi le SQL avant exécution.
```

### Étape 2.3 — Import clients

**CAS A — Fichier Excel/CSV disponible**

```
Charge /docs/PROMPT-SYSTEM.md.

J'ai un fichier CSV/Excel de clients à importer pour [nom client].
Le fichier est dans /imports/[nom-client]-clients.[ext].

1. Analyse d'abord la structure du fichier (headers, types, qualité des données).
2. Montre-moi un mapping colonnes CSV → table clients Supabase.
3. Identifie les données manquantes ou mal formées.
4. Génère le script d'import TypeScript dans /scripts/import-clients.ts
   qui :
   - Valide chaque ligne avec Zod avant insertion
   - Skip les lignes invalides en les loguant
   - Déduplique sur email ou nom entreprise
   - Assigne organization_id du client
   - Retourne un rapport d'import (X importés, Y skippés, Z erreurs)
5. Exécute le script et montre le rapport.
```

**CAS B — PDF ou documents papier**

```
Charge /docs/PROMPT-SYSTEM.md.

Le client n'a pas de fichier structuré. Il a [description des docs disponibles].

Génère un formulaire d'import guidé dans /app/(app)/settings/import/clients/page.tsx
qui permet de saisir les clients un par un avec :
- Auto-complétion SIRET (API Sirene)
- Validation en temps réel
- Sauvegarde automatique
- Indicateur de progression (X clients saisis / objectif Y)
- Option "Importer depuis photo" (OCR via Anthropic Vision) pour les cartes de visite
```

**CAS C — ERP existant (Sage, EBP, Pennylane)**

```
Charge /docs/PROMPT-SYSTEM.md.

Le client utilise [ERP] et peut exporter ses données.
Format d'export disponible : [format].

Génère le connecteur d'import dans /lib/importers/[erp-name]-importer.ts qui :
1. Parse le format spécifique [ERP]
2. Mappe vers notre schéma BDD
3. Gère les cas particuliers de [ERP] (numérotation, TVA, etc.)
4. Produit le même rapport que le CAS A
```

### Étape 2.4 — Import historique devis/factures

```
Charge /docs/PROMPT-SYSTEM.md.

J'importe l'historique des devis/factures de [nom client] pour construire
la mémoire d'entreprise. Les données sont dans /imports/[nom-client]-history.[ext].

Format source : [Excel / CSV / PDF / export ERP]
Période couverte : [ex: Jan 2023 → Déc 2024]

1. Analyse la structure des données disponibles.
2. Identifie ce qui peut alimenter la mémoire d'entreprise :
   - Clients récurrents et leur historique tarifaire
   - Types de prestations les plus fréquentes
   - Fourchettes de prix par type de travaux
   - Délais de paiement moyens par client
   - Taux de transformation devis→facture

3. Génère le script d'import dans /scripts/import-history.ts :
   - Crée les clients manquants (s'ils n'existent pas déjà)
   - Importe les devis avec statut "archived" ou "converted"
   - Importe les factures avec statut "paid" / "cancelled"
   - Calcule et insère les entrées company_memory pertinentes
   - Met à jour total_revenue et total_paid sur chaque client

4. Si format PDF : utilise l'API Anthropic pour extraire les données
   de chaque PDF dans /imports/[nom-client]-pdfs/

5. Génère un rapport de mémoire construite :
   X clients analysés
   Y patterns tarifaires extraits
   Z règles de pricing identifiées

Montre-moi le plan avant exécution.
```

---

## SESSION 3 — PARAMÉTRAGE MÉTIER (Prompt 3)

```
Charge /docs/PROMPT-SYSTEM.md.

Dernière étape de déploiement pour [nom client].
Voici les paramètres métier finaux :

TEMPLATES EMAIL :
Tone voice : [ex: "Vouvoiement formel, direct, relations de long terme avec les clients"]
Relation client dominante : [ex: "Clients industriels réguliers depuis 5-15 ans"]
Secteur : [secteur]

Génère dans /lib/email-templates/ les templates pour :
1. Envoi devis → subject + body personnalisés secteur + tone voice
2. Relance devis J+7 → ton cordial
3. Relance devis J+14 → ton plus direct
4. Relance devis J+30 → ton formel
5. Envoi facture → avec mentions légales secteur
6. Relance facture J+0 (due date) → rappel amical
7. Relance facture J+7 → ton direct + montant en évidence
8. Relance facture J+15 → ton formel + mention pénalités
9. Confirmation paiement reçu → chaleureux, confirme le montant

Chaque template doit :
- Utiliser les variables : {{client_name}}, {{company_name}}, {{document_number}},
  {{amount}}, {{due_date}}, {{sender_name}}, {{sender_title}}
- Rester modifiable par l'utilisateur dans les paramètres
- Être en HTML React Email + version texte fallback

OBJECTIFS CA :
Objectif annuel : [€]
Objectif mensuel : [€]
Visibilité : [tous / responsables / configurable]
Qui peut modifier les objectifs : [owner + admin uniquement]

PARAMÈTRES FINAUX :
Assure-toi que dans /supabase/seeds/[nom-client]-config.sql :
- Les mentions légales sont complètes (assurance, certification)
- Le tribunal compétent est renseigné
- Les conditions générales de vente sont chargées

VÉRIFICATION FINALE :
Après ces modifications, lance le checklist de validation :
[ ] App accessible sur [domaine-client]
[ ] Login owner fonctionne
[ ] Premier devis créable en < 5 min
[ ] PDF généré conforme (SIRET, mentions légales)
[ ] Email de test envoyé depuis Resend
[ ] Import clients vérifié (X clients visibles)
[ ] Historique visible sur les fiches clients
[ ] Dashboard affiche CA et objectifs corrects
[ ] Relances automatiques configurées
```

---

## FICHIERS CLÉS À MAINTENIR PAR DÉPLOIEMENT

```
/data/client-config.ts          ← Variables branding + identité client
/data/sector-config.ts          ← Template secteur actif
/lib/email-templates/config.ts  ← Tone voice + templates
/supabase/seeds/                ← Seeds spécifiques au client
/imports/                       ← Données brutes d'import (gitignore en prod)
/scripts/                       ← Scripts d'import one-shot
.env.local                      ← Variables d'env client (jamais dans le repo)
```

---

## STRUCTURE DE `client-config.ts`

```typescript
// /data/client-config.ts
// CE FICHIER EST LA SEULE SOURCE DE VÉRITÉ POUR L'IDENTITÉ DU CLIENT
// Modifié une fois lors du déploiement, jamais touché ensuite

export const CLIENT_CONFIG = {
  // Identité
  name: "Tôlerie Martin SARL",
  displayName: "Tôlerie Martin",
  slug: "tolerie-martin",
  siret: "123 456 789 00012",
  siren: "123 456 789",
  rcs: "RCS Versailles",
  legalForm: "SARL",
  vatNumber: "FR12123456789",
  nafCode: "2511Z",

  // Contact
  email: "contact@tolerie-martin.fr",
  phone: "01 23 45 67 89",
  website: "www.tolerie-martin.fr",

  // Adresse
  address: {
    line1: "12 rue de l'Industrie",
    line2: "ZI des Clayes",
    city: "Les Clayes-sous-Bois",
    postalCode: "78340",
    country: "FR",
  },

  // Secteur
  sector: "tolerie" as const,
  sectorLabel: "Tôlerie industrielle",
  certifications: ["Qualibat 2111"],
  insurance: {
    decennale: "AXA Pro — Police n° 12345678",
    rcPro: "AXA Pro — Police n° 87654321",
  },
  courtCompetent: "Tribunal de commerce de Versailles",

  // Branding
  branding: {
    primaryColor: "#f59e0b",
    secondaryColor: "#6366f1",
    fontDisplay: "Plus Jakarta Sans",
    logoUrl: "/logo.svg",
    logoDarkUrl: "/logo-dark.svg",
    faviconUrl: "/favicon.svg",
  },

  // Paramètres métier
  settings: {
    defaultVatRate: 20,
    defaultHourlyRate: 65,
    defaultPaymentTermsDays: 30,
    latePenaltyRate: 12,
    quotePrefix: "DEV",
    invoicePrefix: "FAC",
    quoteValidityDays: 30,
    currency: "EUR",
  },

  // Email
  email_config: {
    fromEmail: "noreply@tolerie-martin.fr",
    fromName: "Tôlerie Martin",
    replyTo: "contact@tolerie-martin.fr",
    toneVoice: "formal",      // 'formal' | 'friendly' | 'neutral'
    clientRelation: "long-term-b2b",
  },

  // Dashboard
  goals: {
    annual: 850000,            // CA annuel cible (€)
    monthly: 70833,            // CA mensuel cible (€)
    goalsVisibility: "all",    // 'all' | 'managers-only' | 'configurable'
  },
} as const

export type SectorType = "tolerie" | "plomberie" | "renovation" | "menuiserie" |
  "electricite" | "facade" | "charpente" | "peinture" | "carrelage" | "autre"
```

---

## TEMPLATES SECTEUR — `/data/sector-templates/`

Chaque secteur a son fichier JSON avec :

```json
// /data/sector-templates/tolerie.json
{
  "sector": "tolerie",
  "label": "Tôlerie industrielle",
  "terminology": {
    "quote": "Devis",
    "invoice": "Facture",
    "project": "Affaire",
    "client": "Client",
    "item": "Pièce / Référence",
    "labor": "Main-d'œuvre",
    "material": "Matière première"
  },
  "defaultUnits": ["pièce", "kg", "m²", "ml", "tonne", "forfait", "heure"],
  "defaultCategories": [
    "Acier galvanisé", "Acier inox", "Aluminium", "Laiton",
    "Cuivre", "Consommables", "Peinture / Traitement", "Sous-traitance"
  ],
  "defaultVatRate": 20,
  "vatRatesAvailable": [20, 10],
  "aiQuotePromptContext": "Tu es un expert en tôlerie industrielle. Les devis incluent des pièces métalliques sur mesure, des découpes laser/plasma, du pliage, de la soudure et des finitions de surface. Les unités sont souvent en kg, m², pièces ou forfaits. Tiens compte des prix de l'acier au marché (variable).",
  "legalMentions": [
    "Travaux soumis à la TVA au taux de 20%",
    "Pénalités de retard : taux BCE × 3 = {{latePenaltyRate}}%"
  ],
  "sampleMaterials": [
    { "name": "Tôle acier galva 1mm", "unit": "m²", "purchasePrice": 12.50, "marginRate": 35, "vatRate": 20 },
    { "name": "Tôle inox 304 1.5mm", "unit": "m²", "purchasePrice": 48.00, "marginRate": 40, "vatRate": 20 },
    { "name": "Aluminium 2mm", "unit": "m²", "purchasePrice": 28.00, "marginRate": 40, "vatRate": 20 },
    { "name": "Main-d'œuvre standard", "unit": "heure", "purchasePrice": 0, "salePrice": 65, "vatRate": 20 }
  ]
}
```

---

## CHECKLIST LIVRAISON CLIENT

```
TECHNIQUE
[ ] Repo Git créé et pushé
[ ] Supabase project EU créé et migrations appliquées
[ ] Variables d'env configurées dans Vercel
[ ] Domaine connecté + SSL actif
[ ] Email expéditeur configuré dans Resend + DKIM validé
[ ] GEMINI_API_KEY configurée dans Vercel (pour Atelier IA)
[ ] CRON_SECRET configurée dans Vercel (pour relances automatiques)
[ ] Migration 010_seed_permissions.sql appliquée AVANT le premier signup

IDENTITÉ ET BRANDING
[ ] client-config.ts rempli et vérifié
[ ] Logo en place (SVG fond transparent)
[ ] Couleur principale appliquée (vérifier boutons, badges actifs, nav)
[ ] PDF de test généré avec logo + mentions légales complètes
[ ] SIRET, RCS, numéro TVA visibles sur le PDF

DONNÉES
[ ] Compte owner créé et testé
[ ] Autres comptes utilisateurs créés selon la fiche
[ ] Import clients effectué — rapport OK
[ ] Historique devis/factures importé — rapport OK
[ ] Mémoire d'entreprise construite (entrées company_memory)
[ ] Catalogue matériaux de base chargé (sector template)
[ ] Taux horaires configurés

PARAMÈTRES MÉTIER
[ ] Séquences numérotation correctes (continue depuis l'existant)
[ ] Templates emails générés et testés (email test envoyé)
[ ] Objectifs CA configurés
[ ] Conditions de paiement (30j, 45j...)
[ ] Mentions légales complètes (assurance, certifications)

FONCTIONNEL
[ ] Premier devis créé en < 5 min depuis zéro
[ ] PDF du devis conforme aux normes FR
[ ] Envoi email fonctionnel depuis l'app
[ ] Dashboard affiche les données importées
[ ] Relances automatiques activées (si souhaité) — Settings > Emails > Relances auto
[ ] Délais J+X configurés selon les préférences client (défaut: factures J+2/J+7, devis J+3/J+10)
[ ] Import CSV clients fonctionnel depuis l'interface
[ ] Atelier IA testé avec un devis type du secteur client

FORMATION CLIENT
[ ] Comptes utilisateurs créés + mots de passe transmis
[ ] Walkthrough de 30 min avec le dirigeant
[ ] Guide "les 5 actions du quotidien" remis (1 page)
[ ] Contact support renseigné dans l'app
```

---

## ESTIMATION TEMPS PAR TYPE DE CLIENT

| Type de client | Session 1 | Session 2 | Session 3 | Total |
|----------------|-----------|-----------|-----------|-------|
| Client simple (1 user, peu de données) | 20 min | 30 min | 20 min | **~1h** |
| Client standard (3-5 users, CSV dispo) | 30 min | 1h30 | 30 min | **~2h30** |
| Client avec historique lourd (PDFs, ERP) | 30 min | 3-4h | 45 min | **~5h** |
| Client complexe (multi-users, ERP, PDFs) | 45 min | 5-6h | 1h | **~8h** |

*Avec l'IA qui fait l'import → diviser par 3 le temps Session 2.*
