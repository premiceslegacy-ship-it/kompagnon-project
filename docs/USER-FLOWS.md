# USER-FLOWS.md — Métier OS
### Cartographie complète des parcours utilisateurs — V1.1

---

## SECTION 1 — FLOWS D'AUTH

### CONNEXION (pas d'inscription publique — app privée par client)
```
1. /login — saisit email + password
2. Validation Zod côté serveur
   ├─ Mauvais mot de passe → "Email ou mot de passe incorrect"
   ├─ Compte non actif → "Votre accès a été révoqué — contactez votre responsable"
   └─ Succès → redirect vers /dashboard
3. Session stockée en cookie httpOnly (Supabase)

INVITATION (premier accès) :
1. Utilisateur reçoit email d'invitation avec lien /invite/[token]
2. Clique le lien
   ├─ Token expiré (> 7j) → "Lien expiré — demandez un nouvel accès à votre responsable"
   └─ Token valide → formulaire de création mot de passe
3. Choisit son mot de passe (min 8 chars)
4. Compte activé → redirect vers /dashboard
5. Bannière de bienvenue "Bienvenue [Prénom] — voici votre espace [Entreprise]"
```

### RESET PASSWORD
```
1. /forgot-password — saisit email
2. Si email dans la BDD → email envoyé (silencieux sinon — anti-enumération)
3. Clic lien (expire 2h) → formulaire nouveau mot de passe
4. Nouveau mot de passe → session créée → /dashboard
```

---

## SECTION 2 — FLOW DASHBOARD (accueil quotidien)

### Vue d'ensemble

```
CHARGEMENT DU DASHBOARD
  → Skeleton shimmer sur les 4 zones (< 200ms)
  → Données chargées en parallèle :
      Promise.all([getPriorityActions, getCAMetrics, getRecentDocs, getGoals])
  → Fade-in 200ms

ZONE 1 — MÉTRIQUES CA (haut de page)
  4 KPI cards côte à côte (2×2 sur mobile) :
  ┌─────────────────┬─────────────────┐
  │  CA ce mois     │  CA cette année │
  │  48 230 €       │  386 400 €      │
  │  Objectif: 70k  │  Objectif: 850k │
  │  ████░░░  68%   │  ██████░  45%   │
  ├─────────────────┼─────────────────┤
  │  Encaissé       │  Taux convrsion │
  │  41 800 €       │  devis→facture  │
  │  87% du CA émis │  62% ce mois    │
  └─────────────────┴─────────────────┘
  Visibilité conditionnelle selon rôle + paramètre goals.visibility

ZONE 2 — ACTIONS PRIORITAIRES (centre, zone la plus importante)
  Titre : "À traiter aujourd'hui" + compteur badge ambre si > 0

  Groupes pliables par priorité :
  
  🔴 URGENT (1) — Factures en retard de paiement
  ┌─────────────────────────────────────────────────────────┐
  │ Martin BTP · FAC-2024-0042 · 14 230,00 € · +15j retard │
  │                                    [Voir] [Relancer →]  │
  └─────────────────────────────────────────────────────────┘

  🟡 À TRAITER (2) — Devis sans réponse > 7 jours
  ┌─────────────────────────────────────────────────────────┐
  │ Renault Flins · DEV-2024-0055 · 8 400 € · il y a 12j   │
  │                                    [Voir] [Relancer →]  │
  └─────────────────────────────────────────────────────────┘

  🔵 À FAIRE (1) — Devis acceptés à facturer
  ┌─────────────────────────────────────────────────────────┐
  │ Total Énergie · DEV-2024-0051 · 45 000 € · hier        │
  │                             [Créer la facture →]        │
  └─────────────────────────────────────────────────────────┘

  Si aucune action → carte verte "Tout est à jour — rien à traiter aujourd'hui ✓"

ZONE 3 — GRAPHE CA 12 MOIS (en bas à gauche)
  Bar chart mensuel — hover = tooltip avec CA émis + encaissé du mois

ZONE 4 — DERNIERS DOCUMENTS (en bas à droite)
  5 lignes : [type] [numéro] [client] [montant] [statut badge] [date]
  Clic sur une ligne → ouvre le document
```

### Flow "Relancer depuis le dashboard"
```
1. Clic "Relancer →" sur une action prioritaire
2. Modal s'ouvre (sans quitter le dashboard) :
   → Destinataire (pré-rempli, email du client)
   → Objet (template correspondant pré-rempli, modifiable)
   → Corps (template pré-rempli, modifiable inline)
   → [Annuler] [Envoyer la relance]
3. Envoi → toast "Relance envoyée à [client]"
4. L'action disparaît de la Zone 2 (ou passe en "relancé")
5. Log dans reminders
Total : < 30 secondes depuis l'ouverture du dashboard
```

---

## SECTION 3 — FLOWS MÉTIER PRINCIPAUX

### FLOW : Créer un devis (manuel)
```
Entrée : Sidebar → Devis → "+ Nouveau devis"

1. Sélection du client (autocomplete)
   └─ Nouveau client → modal inline (nom + email) sans quitter la page
2. Titre du devis
3. Champ optionnel "Cahier des charges / Notes projet" (texte libre, interne)
4. Date d'émission + validité (défauts depuis client-config.ts)
5. Sections (optionnel) → "+ Ajouter une section"
6. Lignes dans chaque section :
   → Autocomplete catalogue (matériaux + prestations)
   → Champs : Qté · Unité · PU HT · TVA · Remise ligne
   → Total ligne calculé en temps réel
7. Remise globale + acompte (optionnels)
8. Récap HT/TVA/TTC en sticky bottom
9. Actions : [Sauvegarder brouillon] [Aperçu PDF] [Envoyer au client]

Sauvegarde auto : debounce 30s → toast discret "Brouillon sauvegardé"
```

### FLOW : Générer un devis depuis cahier des charges IA
```
Entrée : Sidebar → IA → "Assistant devis"
  OU depuis la page "Nouveau devis" → bouton "Générer avec l'IA"

ÉTAPE 1 — Saisie
  Sélection client (optionnel à cette étape)
  
  Deux onglets :
  [Texte] [PDF]
  
  Mode Texte :
  Grand textarea "Décrivez le projet ou collez le cahier des charges"
  Placeholder : "Ex: Fabrication de 50 capots de protection en tôle acier 2mm,
  dimensions 400×600mm, avec découpe laser et traitement galvanisation..."
  
  Mode PDF :
  Dropzone (PDF, max 10MB)
  Si PDF scanné → OCR automatique via Anthropic Vision
  Si PDF non lisible → "PDF illisible. Essayez de recopier le contenu en texte."
  
  Contexte additionnel (optionnel) :
  "Précisions supplémentaires pour l'IA"
  Ex: "TVA 10%, client secteur public, délai 6 semaines, urgence +15%"

ÉTAPE 2 — Génération
  Clic "Générer le devis"
  → Loading state (3 messages animés, max 30s) :
     "Analyse du document..."
     "Recherche dans votre catalogue..."
     "Construction du devis..."
  
  Contexte envoyé à Claude :
  - Secteur et terminologie métier (sector-config.ts)
  - Catalogue matériaux complet
  - Taux horaires configurés
  - company_memory pertinente (RAG — top 5 entrées les plus similaires)
  - Texte/PDF du client
  - Précisions additionnelles

ÉTAPE 3 — Révision
  Formulaire de devis pré-rempli s'ouvre
  Bannière : "Devis généré par l'IA — vérifiez chaque ligne avant d'envoyer"
  Lignes IA surlignées en ambre pâle
  Bouton "Tout valider" (retire le surlignage, marque ai_validated = true)
  
  L'utilisateur peut :
  → Modifier n'importe quelle ligne
  → Supprimer des lignes incohérentes
  → Ajouter des lignes manquantes
  → Ajuster les quantités et prix
  
  Puis : [Sauvegarder] [Envoyer au client]

ERREURS :
  API timeout → retry auto × 2 → "Génération temporairement indisponible.
  Votre cahier des charges est sauvegardé. Réessayez dans quelques minutes."
  Devis vide généré → "L'IA n'a pas pu extraire assez d'informations.
  Ajoutez plus de précisions et réessayez, ou créez le devis manuellement."
```

### FLOW : Import clients (CSV/Excel)
```
Entrée : /settings/import/clients → onglet "CSV / Excel"

ÉTAPE 1 — Upload
  Dropzone ou sélection fichier (CSV, XLS, XLSX — max 50MB)
  → Parsing côté serveur (Papa.parse)
  → Détection auto des colonnes (fuzzy matching sur les headers)

ÉTAPE 2 — Mapping colonnes
  Tableau de mapping :
  ┌──────────────────┬──────────────────────┬──────────────────┐
  │ Colonne fichier  │ → Champ Métier OS    │ Exemple (ligne 1)│
  ├──────────────────┼──────────────────────┼──────────────────┤
  │ "Raison sociale" │ → Nom entreprise ▼   │ Martin BTP       │
  │ "Mail"           │ → Email ▼            │ contact@mart...  │
  │ "Tel"            │ → Téléphone ▼        │ 01 23 45 67 89   │
  │ "SIRET"          │ → SIRET ▼            │ 123456789 ⚠️     │
  └──────────────────┴──────────────────────┴──────────────────┘
  Les champs non mappés peuvent être ignorés.
  Erreurs détectées = surligné orange (ex: SIRET trop court)

ÉTAPE 3 — Prévisualisation
  5 premières lignes après mapping
  Avertissements : "X lignes ont un SIRET invalide — elles seront importées sans SIRET"
  Doublons détectés : "3 clients existent déjà — [Ignorer les doublons] [Mettre à jour]"

ÉTAPE 4 — Import
  Barre de progression (X / Y clients)
  Rapport final :
  ┌─────────────────────────────────────────┐
  │ Import terminé                          │
  │ ✅ 187 clients importés                 │
  │ ⚠️ 8 lignes ignorées (doublons)         │
  │ ❌ 5 erreurs (voir détails)             │
  │ [Télécharger le rapport d'erreurs]      │
  │ [Voir les clients importés →]           │
  └─────────────────────────────────────────┘
```

### FLOW : Import historique devis/factures
```
Entrée : /settings/import/history

3 onglets : [Excel/CSV] [PDF] [Manuel]

ONGLET EXCEL/CSV :
  Même flow que import clients adapté pour les devis/factures
  Colonnes minimales : numéro, client (nom ou email), date, montant HT, statut
  Lignes de détail si disponibles (sinon = document sans items)
  Import en statut 'archived' + is_archived = true
  → Calcul automatique avg_payment_delay_days par client

ONGLET PDF :
  Dropzone multi-fichiers (jusqu'à 50 PDFs à la fois)
  Upload → traitement en queue (1 PDF à la fois)
  
  Pour chaque PDF :
  → Extraction texte (pdfjs-dist)
  → Si échec → OCR Anthropic Vision
  → Parsing structuré par Claude :
    "Extrait de ce document : {type: devis|facture, numero, client, date,
    montant_ht, montant_ttc, statut, lignes: [{nom, qté, pu, total}]}"
  
  Résultats présentés en liste avec cases à cocher :
  ┌──┬──────────────────────────────────────────────────┐
  │☑ │ DEV-2023-0142 · Schneider Electric · 22 400€ HT │
  │☑ │ FAC-2023-0089 · Total Énergie · 8 900€ HT       │
  │☐ │ [Document non reconnu] · 3 pages · [Ignorer]     │
  └──┴──────────────────────────────────────────────────┘
  
  [Importer les X sélectionnés]

ONGLET MANUEL :
  Formulaire simplifié : client + type + numéro + date + montant + statut
  "Ajouter" → s'ajoute à la liste → "Tout importer"
  Pour les grands devis importants à mémoriser sans avoir le fichier

APRÈS TOUT IMPORT :
  Bouton "Construire la mémoire d'entreprise"
  → Lance l'analyse IA de tout l'historique importé
  → Génère les entrées company_memory
  → Rapport : "Mémoire construite — X insights générés"
```

### FLOW : Configurer les templates emails
```
Entrée : /settings/emails

Liste de 9 templates avec statut (personnalisé / défaut)

Clic sur un template :
→ Drawer latéral s'ouvre
→ Éditeur avec 2 parties :
   [Objet]
   [Corps — éditeur WYSIWYG simple]

Variables disponibles affichées en bas :
  [{{client_name}}] [{{company_name}}] [{{document_number}}] ...
  Clic sur une variable → insérée à la position du curseur

[Aperçu] → modal avec l'email rendu (variables remplacées par des valeurs factices)
[Envoyer un email de test] → envoie à l'email de l'utilisateur connecté
[Réinitialiser au défaut secteur] → confirmation avant reset
[Sauvegarder]
```

### FLOW : Configurer les objectifs CA
```
Entrée : /settings/goals

Section "Objectif annuel" :
  Champ : Objectif CA HT pour 2024/2025
  [Calcul automatique mensuel : objectif annuel / 12]
  OU [Saisir les objectifs mensuels manuellement]

Section "Visibilité" :
  Radio : 
  ◉ Visible par tous les utilisateurs
  ○ Visible par les managers et admins uniquement
  ○ Visible par l'owner uniquement

[Sauvegarder les objectifs]

→ Dashboard mis à jour immédiatement pour tous les utilisateurs autorisés
```

---

## SECTION 4 — FLOWS DE BILLING (hors app)

> Pas de Stripe dans l'app. Le billing se fait hors-app.
> L'app est livrée avec toutes les features débloquées (plan "full").
> Si le client cesse de payer → le déploiement est archivé côté Vercel.

---

## SECTION 5 — LES 4 ÉTATS — APPLICATION SYSTÉMATIQUE

### LOADING
```
→ Skeleton shimmer qui préserve la forme du contenu
→ Dashboard : 4 KPI skeletons + 5 lignes action skeletons
→ Listes : 8 lignes skeleton de hauteur fixe
→ Drawer : skeleton du formulaire
→ Jamais de spinner pleine page sauf transitions de route (< 200ms)
```

### EMPTY

| Composant | Message | CTA |
|-----------|---------|-----|
| Dashboard (aucune action) | "Tout est à jour — rien à traiter aujourd'hui" | — |
| Liste devis | "Aucun devis encore. Votre premier devis est à 5 minutes." | "Créer un devis" |
| Liste factures | "Aucune facture encore." | "Créer une facture" |
| Liste clients | "Aucun client. Importez votre base ou ajoutez le premier." | "Importer" / "Ajouter" |
| Catalogue matériaux | "Catalogue vide. Ajoutez vos matériaux pour accélérer vos devis." | "Ajouter" |
| Mémoire entreprise | "Aucune donnée historique. Importez votre historique pour activer l'IA." | "Importer" |
| Relances | "Aucune relance à envoyer." | — |

### ERROR
```
→ Card border danger + icône AlertCircle + message humain
→ Bouton "Réessayer" (re-trigger le fetch)
→ Si persistant : "Contactez le support"
→ Jamais de code d'erreur visible (Sentry uniquement)
```

### LOADED
```
→ Fade-in 200ms depuis skeleton
→ Pagination en bas (> 20 items)
→ Filtres et recherche (> 10 items attendus)
→ Sort sur colonnes clés
```

---

## SECTION 6 — PERMISSIONS ET GARDE-FOUS

| Action | Sans permission | Comportement |
|--------|----------------|--------------|
| Envoyer facture (employee) | Bouton désactivé | Tooltip "Rôle insuffisant" |
| Voir objectifs CA (si owner_only) | Section masquée | — |
| Modifier templates emails (commercial) | Menu masqué | — |
| Lancer un import (manager+) | Accessible | — |
| Lancer un import (commercial/employee) | Page redirigée | Toast "Accès non autorisé" |
| Modifier un numéro de facture | Champ disabled | Tooltip "Numéro immuable (norme FR)" |

### Gardes-fous import
```
Import en cours → impossibilité de lancer un 2ème import simultané
"Un import est déjà en cours. Attendez qu'il soit terminé."

Doublon client détecté → jamais d'écrasement silencieux
→ Toujours proposer : "Ignorer / Mettre à jour / Créer quand même"

Historique importé → statut 'archived' = true systématiquement
→ Pas visibles dans les listes principales (filtre par défaut)
→ Accessibles via filtre "Inclure l'historique archivé"
```

---

## SECTION 7 — FLOW MOBILE (375px)

### Navigation mobile
```
Bottom navigation bar (5 icônes) :
[Dashboard] [Devis] [Clients] [IA] [+]

Hamburger → accès au reste (Factures, Catalogue, Paramètres)
FAB "+" pour les actions rapides (nouveau devis, nouveau client)
```

### Quick Win Flow — terrain (< 3 min)
```
Scénario : le dirigeant est sur le chantier, un client demande un devis maintenant.

1. Ouvre Métier OS sur son téléphone → Dashboard
2. Voit "À TRAITER : 1 devis sans réponse" → note mentalement
3. Tape FAB "+" → "Nouveau devis IA"
4. Sélectionne le client (autocomplete)
5. Tape dans le textarea ce qu'il a retenu de la discussion avec le client
6. "Générer le devis" → 20 secondes de génération
7. Revoit rapidement les lignes → "Envoyer"
8. Toast "Devis envoyé à [client]"
Total : < 3 minutes debout sur le chantier.
```
