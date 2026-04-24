# PRD.md — Métier OS
### Product Requirements Document — V1.2
### Mis à jour : import IA multi-format + catalogue sectoriel + factures récurrentes + types de fichiers étendus

> **Sources de vérité :** BRIEF.md · DATA-MODEL.md · DEPLOY-PLAYBOOK.md
> **Principe directeur :** Chaque feature doit réduire le temps entre la demande client et le devis envoyé.

---

## SECTION 1 — VISION PRODUIT

**Vision :** Métier OS est l'outil de gestion qui donne aux entreprises de métier la puissance d'un ERP sans la complexité, grâce à une IA qui comprend vraiment leur secteur.

**Modèle de déploiement :** Une app par client — repo Git dupliqué, Supabase project dédié, domaine dédié, déployé sur Vercel. Chaque instance est isolée. La personnalisation se fait en 1 à 3 sessions dans l'IDE (voir DEPLOY-PLAYBOOK.md).

**Principe directeur :** Une feature qui prend plus de 3 clics dans le cas d'usage principal doit être repensée.

**KPIs mesurables V1 :**
- Temps de création d'un devis simple < 5 minutes
- Temps de redéploiement pour un nouveau client < 4 heures (client standard)
- Taux d'activation J7 (premier devis envoyé par le client final) > 60%
- North Star : nombre de devis générés via IA / mois / instance

**Hors scope V1 :**
- Application mobile native (React Native)
- Module de gestion de production / planning atelier
- Module de paie
- Portail client (espace de signature en ligne)
- Chorus Pro (facturation électronique B2G)
- API publique pour développeurs tiers

---

## SECTION 2 — UTILISATEURS ET RÔLES

### Rôles et permissions

| Action | owner | admin | manager | commercial | employee | viewer |
|--------|-------|-------|---------|------------|----------|--------|
| Créer/modifier devis | ✅ | ✅ | ✅ | ✅ | Brouillon | ❌ |
| Envoyer devis | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Créer/modifier factures | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Envoyer factures | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Créer/modifier clients | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Voir clients | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Gérer matériaux/tarifs | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Inviter utilisateurs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Paramètres organisation | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fixer objectifs CA | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Voir objectifs CA | Configurable par rôle dans les paramètres | | | | | |
| Gérer templates emails | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Lancer imports données | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Supprimer organisation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## SECTION 3 — PLANS ET LIMITES

> Dans le modèle app-par-client, il n'y a pas de SaaS multi-plan à gérer.
> Chaque app est livrée avec toutes les features débloquées.
> Le billing se fait hors-app (facturation mensuelle/annuelle directe au client).

```typescript
// /lib/plans.ts
export const CURRENT_PLAN = 'full' // Toutes les features actives par défaut

export const PLANS = {
  full: {
    limits: {
      users: -1,              // illimité
      quotes_per_month: -1,
      clients: -1,
      ai_quotes: -1,
      ai_voice: true,
      auto_reminders: true,
      saved_templates: -1,
      storage_gb: 50,
    }
  }
}
```

---

## SECTION 4 — ARCHITECTURE DE L'APP

### Structure des routes

```
app/
├── (auth)/
│   ├── login/page.tsx
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx
│   └── invite/[token]/page.tsx
│
├── (app)/                          ← Protégé par middleware auth
│   ├── layout.tsx                  ← Sidebar + top bar
│   │
│   ├── dashboard/page.tsx          ← Dashboard (CA, objectifs, actions prioritaires)
│   │
│   ├── quotes/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   ├── [id]/page.tsx
│   │   └── [id]/preview/page.tsx
│   │
│   ├── invoices/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   ├── [id]/page.tsx
│   │   └── recurring/             ← NOUVEAU : factures récurrentes
│   │       ├── page.tsx           ← Liste des modèles récurrents
│   │       ├── new/page.tsx
│   │       └── [id]/page.tsx
│   │
│   ├── clients/
│   │   ├── page.tsx
│   │   ├── new/page.tsx
│   │   └── [id]/page.tsx
│   │
│   ├── pipeline/page.tsx
│   │
│   ├── ai/
│   │   └── quote/page.tsx         ← Assistant IA : texte + fichier + vocal + photo
│   │
│   ├── reminders/page.tsx
│   │
│   ├── catalog/
│   │   ├── materials/page.tsx     ← Nom dynamique selon secteur
│   │   └── labor/page.tsx         ← Main d'œuvre / Taux horaires
│   │
│   └── settings/
│       ├── page.tsx
│       ├── team/page.tsx
│       ├── emails/page.tsx
│       ├── goals/page.tsx
│       └── import/
│           ├── page.tsx           ← Hub import (4 onglets)
│           ├── clients/page.tsx   ← Import clients multi-format + IA
│           ├── history/page.tsx   ← Import devis/factures
│           ├── catalog/page.tsx   ← Import catalogue + main d'œuvre ← NOUVEAU
│           └── revenue/page.tsx   ← Import CA / marges historiques  ← NOUVEAU
│
└── api/
    ├── quotes/[id]/pdf/route.ts
    ├── invoices/[id]/pdf/route.ts
    ├── invoices/recurring/cron/route.ts   ← NOUVEAU : cron factures récurrentes
    ├── ai/generate-quote/route.ts
    ├── ai/transcribe/route.ts             ← NOUVEAU : Whisper transcription
    ├── import/clients/route.ts
    ├── import/history/route.ts
    ├── import/catalog/route.ts            ← NOUVEAU
    ├── import/revenue/route.ts            ← NOUVEAU
    └── reminders/cron/route.ts
```

---

## SECTION 5 — FONCTIONNALITÉS P1/P2/P3

### P1 — BLOQUENT LE LANCEMENT

---

#### F01 — Authentification complète
**Comportement :** Email + password. Invitation par token. Reset password. Pas d'OAuth en V1 (app privée par client).
**Critère d'acceptation :** Connexion, reset, invitation fonctionnels. Route `/app/*` inaccessible sans auth.

---

#### F02 — Dashboard principal avec actions prioritaires
**Comportement :** Vue d'accueil avec 4 zones :

**Zone 1 — Métriques CA**
- CA du mois en cours vs objectif mensuel → barre de progression colorée (rouge < 50%, orange 50-80%, vert > 80%)
- CA de l'année en cours vs objectif annuel → barre de progression
- CA encaissé vs CA émis (taux de recouvrement en %)
- Évolution vs mois précédent (+X% / -X%)
- Visibilité conditionnelle selon le rôle et la config /settings/goals

**Zone 2 — Actions prioritaires**
Liste triée par urgence, mise à jour en temps réel :
```
URGENTES (rouge)
  Factures en retard de paiement
  → [Nom client] · [Montant] · [+X jours retard] · [Relancer en 1 clic]

À TRAITER (orange)
  Devis sans réponse > seuil configuré
  → [Nom client] · [Montant] · [envoyé il y a X jours] · [Relancer]

À FAIRE (bleu)
  Devis acceptés non encore convertis en facture
  → [Nom client] · [Montant] · [accepté il y a X jours] · [Créer la facture]

BIENTÔT (gris)
  Devis expirant dans < 5 jours
  Factures échéant dans < 3 jours
```
Chaque ligne = 1 bouton d'action directe. Zéro navigation inutile.
Champ de filtre rapide pour chercher un client ou document spécifique.

**Zone 3 — Graphe CA 12 mois glissants**
Bar chart : CA émis (barres) + CA encaissé (ligne). Tooltip au survol avec détail du mois.

**Zone 4 — Derniers documents (5)**
Devis/factures récents avec statut badge + montant + clic → document.

**Critère d'acceptation :** En < 10 secondes après ouverture, l'utilisateur sait exactement ce qu'il doit faire aujourd'hui.

---

#### F03 — Objectifs CA configurables
**Comportement :**
- Owner/Admin fixe objectif annuel et mensuel dans /settings/goals
- Option : objectif mensuel = saisie manuelle OU = annuel / 12
- Visibilité configurable : "Tout le monde" / "Managers et admin" / "Owner uniquement"
- Barres de progression sur le dashboard selon la visibilité par rôle

**Critère d'acceptation :** Objectif modifié → reflété sur le dashboard de tous les rôles autorisés dans les 5 secondes.
**Impact BDD :** goals table

---

#### F04 — CRM Clients complet
**Comportement :** CRUD complet clients/prospects/leads. Fiche avec historique devis/factures, solde dû, notes, tags, source, score. Kanban pipeline.
**Critère d'acceptation :** Fiche client complète accessible en < 3 clics depuis n'importe où dans l'app.

---

#### F05 — Import clients multi-format avec mapping IA
**Comportement :**

**Multi-format accepté :**
CSV, Excel (.xlsx/.xls), PDF (export logiciel tiers), export HubSpot/Salesforce/Sellsy/Pennylane.
L'utilisateur uploade ce qu'il a — pas besoin de respecter un template.

**Mapping IA automatique :**
Upload → Claude analyse la structure du fichier → propose automatiquement le mapping colonnes source → champs Métier OS → affiche un aperçu :
```
"J'ai détecté 3 colonnes que je ne reconnais pas :
  'Code affaire' → à ignorer ou stocker en champ personnalisé ?
  'Région' → à stocker en note ou ignorer ?
  'Référencement interne' → ?"
```
L'utilisateur valide ou corrige le mapping → prévisualisation 5 lignes → confirmation → import.

**Déduplication :**
Sur email ou nom+SIRET. Si doublon : "Ce client existe déjà — Ignorer / Mettre à jour / Créer quand même".

**Champs personnalisés sectoriels :**
Les colonnes non reconnues mais conservées sont stockées dans un champ `custom_fields JSONB` sur la fiche client — accessibles en consultation et exportables. Chaque secteur a ses spécificités (code chantier pour le BTP, référence site pour le nettoyage, etc.).

**Manuel guidé :**
Formulaire séquentiel avec auto-complétion SIRET (API Sirene). Barre de progression "X clients saisis". Sauvegarde à chaque client.

**Critère d'acceptation :** 200 clients importés depuis n'importe quel format courant avec rapport en < 3 minutes. Aucun doublon créé silencieusement.
**Impact BDD :** clients (bulk INSERT + custom_fields JSONB)

---

#### F06 — Import historique complet (mémoire d'entreprise)
**Comportement :**
Page /settings/import — 4 onglets :

**Onglet Devis/Factures (Excel/CSV) :** Mapping IA colonnes → aperçu → import. Colonnes attendues : numéro, client, date, montant HT, statut, lignes si disponibles.

**Onglet Devis/Factures (PDF) :** Dropzone multi-fichiers (jusqu'à 50 PDFs). Upload → extraction par l'IA Anthropic Vision → parsing structuré → prévisualisation liste (titre détecté, client, montant, date) → cases à cocher → confirmation → import.

**Onglet Catalogue produits/services :**
Import du catalogue existant de l'artisan — CSV, Excel, PDF catalogue fournisseur.
Claude détecte automatiquement : désignation, unité, prix unitaire, TVA applicable.
Pour la main d'œuvre : détecte les lignes "taux horaire" et les mappe vers la table `labor_rates`.
Exemples reconnus automatiquement :
```
"Taux horaire vitrier" → labor_rates (désignation: Vitrier, taux: X€/h)
"Nettoyage sols durs au m²" → labor_rates (désignation: Nettoyage sol, unité: m², taux: X€)
"Tôle acier galvanisé 2mm" → materials (nom: Tôle acier galva 2mm, unité: m², prix: X€)
```
Rapport : "X matériaux importés · Y taux horaires importés · Z lignes ignorées (pourquoi)"

**Onglet CA / Marges historiques :**
Import d'un export comptable ou d'un tableau Excel de suivi CA.
Claude extrait : CA par mois, CA par client, marges si disponibles.
Ces données alimentent directement le dashboard (graphe 12 mois) et la mémoire IA.
L'artisan voit son historique complet dès le premier jour — pas dans 6 mois.

**Construction de la mémoire après chaque import :**
- Prix moyens pratiqués par catégorie de prestation
- Marges moyennes par type de travaux
- Délais de paiement moyens par client
- Types de travaux les plus fréquents
- Saisonnalité (mois de pic)

Rapport final : "Mémoire construite — X patterns tarifaires · Y profils clients · Z données de saisonnalité"

**Critère d'acceptation :** Import de 12 mois Excel génère ≥ 5 entrées company_memory exploitables. Dashboard peuplé dès J0.
**Impact BDD :** quotes + invoices + invoice_items + materials + labor_rates + company_memory + clients (enrichissement) + goals (CA historique)

---

#### F07 — Catalogue matériaux et tarifs (sectoriel + import)
**Comportement :**

**Deux sections distinctes :**

**Section 1 — Catalogue produits/matériaux/fournitures**
Le nom de cette section varie selon le secteur configuré au déploiement :
- Tôlerie → "Matériaux & Fournitures" (tôles, profilés, visserie, membranes...)
- Nettoyage → "Produits & Consommables" (produits ménagers, équipements, EPI...)
- Menuiserie → "Bois & Matériaux" (panneaux, quincaillerie, colles...)
- BTP → "Matériaux & Matériel" (béton, parpaings, ferraillage...)
- Tout secteur → nom configurable librement au déploiement

Champs par ligne : désignation · référence (optionnel) · unité · prix d'achat · marge % · prix de vente (calculé auto) · TVA applicable · fournisseur (optionnel)

**Section 2 — Main d'œuvre (Taux horaires)**
Taux horaires par type de prestation. Exemples selon secteur :
- Tôlerie : "Pose bardage", "Soudure TIG", "Zinguerie", "Couverture bac acier"
- Nettoyage : "Nettoyage sols durs", "Vitrerie", "Remise en état", "Pressing moquette"
- Menuiserie : "Pose fenêtres", "Fabrication sur mesure", "Pose parquet"

Champs par ligne : désignation · unité (h, m², forfait, jour...) · taux · TVA

**Ajout manuel :**
Bouton "+ Ajouter" sur chaque section → formulaire inline → sauvegarde immédiate.
Disponible dans l'assistant devis instantanément.

**Import catalogue :**
Bouton "Importer" sur chaque section → dropzone acceptant :
CSV, Excel (.xlsx/.xls), PDF catalogue fournisseur, image photo d'un tarif papier
Claude mappe automatiquement les colonnes vers les champs Métier OS.
Rapport d'import : X lignes importées · Y ignorées (raison).

**Types de fichiers acceptés partout dans l'app (documents joints) :**
PDF · Excel (.xlsx/.xls) · Word (.docx) · CSV · Images (.jpg .png .webp .heic) · Texte (.txt)
→ Remplace la restriction "PDF uniquement" qui était dans la maquette initiale.

**Pré-peuplé au déploiement :**
Le catalogue est initialisé avec 20 à 50 entrées types selon le secteur (sector-templates/).
L'artisan arrive sur une base réaliste, pas sur un catalogue vide.

**Critère d'acceptation :** Import catalogue 100 lignes Excel en < 60 secondes. Article disponible dans l'assistant devis immédiatement.
**Impact BDD :** materials + labor_rates (+ custom_fields JSONB pour spécificités sectorielles)
**Critère d'acceptation :** Matériau disponible dans l'assistant devis instantanément après création.

---

#### F08 — Création de devis manuelle + champ cahier des charges
**Comportement :** Client + titre + sections + lignes (catalogue ou libres) + remise + acompte. Calcul HT/TVA/TTC en temps réel. Sauvegarde automatique brouillon (debounce 30s).

**Champ "Cahier des charges / Contexte du projet" :**
- Zone de texte libre, disponible sur chaque devis
- Visible uniquement en interne (jamais sur le PDF client)
- Utilisé comme contexte supplémentaire par l'IA lors de la génération ou révision du devis
- Peut contenir : notes de réunion, photos, contraintes techniques, exigences client
- Supporte Markdown basique (gras, listes, liens)

**Critère d'acceptation :** Devis de 10 lignes créé + cahier des charges saisi en < 7 minutes.

---

#### F09 — Assistant devis IA — Multi-modal
**Comportement :**
Page /ai/quote avec quatre modes de saisie unifiés dans une même interface :

**Mode Texte :**
Grand textarea "Décrivez le projet ou collez le cahier des charges". Possibilité de lier à un client existant. Bouton "Générer le devis".

**Mode Fichier :**
Dropzone acceptant : PDF · Excel · Word · CSV · Image (.jpg .png .webp .heic)
→ PDF texte : extraction directe
→ PDF scanné / image photo de plan / tarif papier / bon de commande : Claude Vision lit et extrait
→ Excel/CSV : Claude lit les données structurées
→ Word : Claude extrait le texte
Même flow de génération ensuite dans tous les cas.

**Mode Vocal :**
Bouton micro → enregistrement navigateur → envoi à Whisper (OpenAI) → transcription → texte transmis à Claude → génération devis.
L'artisan dicte naturellement sur chantier, le devis se construit automatiquement.

**Mode Photo cahier des charges :**
L'artisan prend en photo un plan, des mesures griffonnées, un ancien devis papier, ou un bon de commande client. Claude Vision extrait les informations pertinentes.

**Contexte enrichi envoyé à Claude dans tous les modes :**
- Secteur + terminologie métier (sector-config.ts)
- Catalogue matériaux actuel (pour des prix cohérents)
- Taux horaires configurés
- Mémoire entreprise pertinente (RAG — similarité vectorielle)
- Historique du client sélectionné si lié

**Résultat :** Formulaire de devis pré-rempli. Lignes IA surlignées ambre jusqu'à validation manuelle. Bouton "Tout valider". L'artisan révise, ajuste, envoie.

**Critère d'acceptation :** Cahier des charges 300 mots → devis 8-15 lignes cohérentes en < 30s. Photo d'un plan → devis en < 45s.
**Impact BDD :** quotes + quote_sections + quote_items + company_memory

---

#### F10 — Génération PDF conforme (normes françaises)
**Comportement :** PDF côté serveur. Contenu légal obligatoire : numéro séquentiel + dates + infos prestataire complètes (SIRET, RCS, TVA, adresse, certifications, assurances) + infos client + lignes détaillées + totaux par taux TVA + pénalités de retard + conditions de paiement + logo.
**Critère d'acceptation :** PDF conforme sur 10 points de vérification légale FR.

---

#### F11 — Templates emails éditables
**Comportement :**
Page /settings/emails — liste de tous les templates avec éditeur WYSIWYG simple.

**9 templates :**
- Envoi devis · Relance devis J+7 · J+14 · J+30
- Envoi facture · Relance facture J+0 · J+7 · J+15
- Confirmation paiement reçu

**Variables disponibles (affichées sous l'éditeur) :**
`{{client_name}}` `{{company_name}}` `{{document_number}}` `{{amount_ttc}}` `{{amount_ht}}` `{{due_date}}` `{{validity_date}}` `{{sender_name}}` `{{sender_title}}` `{{payment_link}}`

Bouton "Envoyer un email de test à [mon email]" sur chaque template.
Tone voice configuré au déploiement, modifiable librement ensuite.
Réinitialisation possible vers le template par défaut du secteur.

**Critère d'acceptation :** Template modifié → utilisé dès le prochain envoi sans redéploiement.

---

#### F12 — Envoi documents + relances
**Comportement :**

**Envoi :** Modal avec template pré-rempli (éditable), PDF joint, option copie à soi-même, tracking d'ouverture.

**Relance manuelle (1 clic) :** Bouton "Relancer" depuis le dashboard (Zone 2) OU depuis la liste OU depuis le document. Modal avec template du bon rang (1ère/2ème/3ème relance) pré-rempli.

**Relance automatique :** Cron job Vercel (toutes les heures). Vérifie les seuils configurés. Envoie. Log dans reminders. S'arrête si paiement/acceptation reçu. Configuration des délais dans /settings/emails.

**Critère d'acceptation :** Relance manuelle depuis le dashboard en < 30 secondes. Relance automatique dans les 60 minutes suivant le déclenchement.

---

#### F13 — Facturation conforme + suivi paiements
**Comportement :** Numérotation séquentielle immuable. Tous champs légaux FR. Suivi des paiements partiels. Avoirs. Calcul pénalités de retard. Statuts automatiques (émise → envoyée → échue → payée).
**Critère d'acceptation :** Facture validée conforme par expert-comptable.

---

#### F14 — Modèles de devis sauvegardés
**Comportement :** Sauvegarder un devis comme modèle réutilisable. Pour les commandes récurrentes identiques ou très similaires. Création depuis modèle en < 30 secondes.

---

#### F15 — Multi-utilisateurs et invitations
**Comportement :** Invitation email + rôle. Lien sécurisé 7j. Gestion équipe. Révocation.
**Critère d'acceptation :** Utilisateur invité opérationnel en < 5 minutes.

---

#### F16 — Paramètres organisation + branding in-app
**Comportement :** Logo, couleur, informations légales, tarifs, séquences. Modifications reflétées sur les nouveaux PDFs sans redéploiement. Paramètres templates emails. Objectifs CA.

---

#### F17 — Factures récurrentes avec confirmation
**Comportement :**
Pour les clients avec des prestations régulières (contrats maintenance, chantiers longue durée, abonnements de service).

**Configuration (une fois par client/contrat) :**
```
Client : Dupont Industrie
Intitulé récurrent : "Maintenance mensuelle site Nord"
Montant de base : 3 200 € HT
Fréquence : Mensuelle
Jour d'envoi : 1er du mois
Confirmation requise : OUI — délai 3 jours avant envoi
Lignes de base : (liste des prestations habituelles pré-remplies)
```

**Flow mensuel automatique :**
J-3 avant la date d'envoi → notification email + alerte dans l'app :
"La facture mensuelle de Dupont Industrie est prête. Montant prévu : 3 200 €. Vérifier et confirmer avant le [date]."

L'artisan ouvre la facture → ajuste si besoin (jours fériés, heures supplémentaires, prestations ponctuelles ajoutées ou retirées) → confirme → la facture part automatiquement à la date prévue.

**Si pas de confirmation dans le délai :**
Deuxième notification J-1. Si toujours pas de confirmation → la facture est mise en attente (jamais envoyée automatiquement sans confirmation) + alerte "Action requise".

**Gestion des variations :**
Chaque mois l'artisan peut modifier librement les lignes avant confirmation. Le montant de base reste le référentiel, les modifications sont tracées dans l'historique.

**Vue d'ensemble :**
Page /invoices/recurring → liste de tous les modèles récurrents actifs + statut du mois en cours (En attente de confirmation / Confirmée / Envoyée / En retard).

**Critère d'acceptation :** Facture récurrente configurée en < 3 minutes. Confirmation + envoi en < 30 secondes. Jamais d'envoi automatique sans confirmation explicite.
**Impact BDD :** recurring_invoices + invoice_schedules (nouvelles tables)

---

### P2 — DANS LES 60 JOURS POST-LANCEMENT

- **F18 — Import API logiciels tiers :** Connecteurs Sage, EBP, Pennylane selon client (cas par cas au déploiement).
- **F19 — Mémoire d'entreprise IA avancée :** RAG complet + suggestions de cohérence tarifaire.
- **F20 — Propositions commerciales enrichies :** Devis avec visuels, descriptions longues, PDF premium multi-pages.
- **F21 — Objectifs par commercial :** Vue individuelle + consolidée manager.
- **F22 — Ma Prime Rénov :** Calcul aides rénovation énergétique.
- **F23 — Import OCR cartes de visite :** Photo → fiche client (Anthropic Vision).
- **F24 — Intégration PA facturation électronique :** Connexion B2Brouter émission + réception + onglet "Factures reçues". À déployer avant septembre 2026.

### P3 — ROADMAP FUTURE

- Portail client + signature électronique en ligne
- Chorus Pro (facturation B2G)
- Application mobile React Native
- Planning / suivi de chantier
- Devis multi-prestataires (sous-traitance)

---

## SECTION 6 — ONBOARDING

> App livrée pré-configurée. Onboarding in-app minimal.

**Premier login :**
1. Email d'invitation → création mot de passe
2. Arrive directement sur Dashboard peuplé (clients, historique, objectifs déjà là)
3. Bannière de bienvenue + tooltip sur Zone 2 "Commencez par traiter ces actions"
4. First Value Moment : première action prioritaire traitée (relance ou devis créé)

**Checklist activation in-app (owner) :**
- [ ] Vérifier les informations légales
- [ ] Ajouter/vérifier le logo
- [ ] Créer le premier devis
- [ ] Envoyer le premier devis
- [ ] Configurer les templates emails

---

## SECTION 7 — EMAILS TRANSACTIONNELS

| Déclencheur | Sujet (personnalisable) | Timing |
|-------------|------------------------|--------|
| Invitation équipe | "[Prénom] vous invite à rejoindre [Org]" | Immédiat |
| Reset password | "Réinitialisation de votre mot de passe" | Immédiat |
| Envoi devis (client final) | Template éditable — sujet configurable | Immédiat |
| Relance devis J+7 | Template éditable | Auto ou Manuel |
| Relance devis J+14 | Template éditable | Auto ou Manuel |
| Relance devis J+30 | Template éditable | Auto ou Manuel |
| Envoi facture | Template éditable — sujet configurable | Immédiat |
| Relance facture J+0 | Template éditable | Auto ou Manuel |
| Relance facture J+7 | Template éditable | Auto ou Manuel |
| Relance facture J+15 | Template éditable (mention pénalités) | Auto ou Manuel |
| Paiement reçu | Template éditable | Immédiat |
| Devis accepté (notif interne) | "[Client] a accepté le devis DEV-[X]" | Immédiat |

---

## SECTION 8 — INTÉGRATIONS ET APIS

| Service | Usage | Clé env |
|---------|-------|---------|
| Anthropic API (claude-sonnet-4-6) | IA devis, extraction fichiers (PDF/Excel/Word/image), mémoire | ANTHROPIC_API_KEY |
| OpenAI Whisper | Transcription vocale → texte | OPENAI_API_KEY |
| Resend + React Email | Tous les emails | RESEND_API_KEY |
| Supabase (Postgres + Storage) | BDD + fichiers | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| API Sirene INSEE | Auto-complétion SIRET | SIRENE_API_KEY |
| Vercel Cron | Relances auto + notifications factures récurrentes | — |
| Sentry | Monitoring erreurs | SENTRY_DSN |

---

## SECTION 9 — CONTRAINTES TECHNIQUES

```
Stack           Next.js 14.2+ · Tailwind 3.4+ · shadcn/ui · TypeScript strict
Auth            Supabase Auth email/password
BDD             Supabase Postgres EU + RLS + Storage
Email           Resend + React Email
IA              Anthropic claude-sonnet-4-6
PDF             @react-pdf/renderer (Server Side)
Déploiement     Vercel EU — une app par client

Sécurité
  RLS toutes les tables · Zod toutes les routes API
  Rate limiting : auth 5/min · IA 10/min · API 100/min
  RGPD : pas de données client dans les logs Vercel

Performance
  LCP < 2.5s mobile · Pagination > 20 items · Lazy loading éditeur

Breakpoints : 375px · 768px · 1024px · 1440px
Accessibilité : WCAG 2.2 AA
```

---

## SECTION 10 — MÉTRIQUES DE SUCCÈS PAR INSTANCE CLIENT

| Moment | Métrique | Cible |
|--------|----------|-------|
| Livraison J0 | App déployée + données importées | ✅ |
| J0 | Premier devis créé par le client | < 10 min |
| J7 | Taux d'activation (≥ 1 devis/semaine) | > 60% |
| J30 | Temps moyen création devis | < 5 min |
| J90 | DAU/MAU | > 40% |
| J90 | NPS client final | > 50 |
