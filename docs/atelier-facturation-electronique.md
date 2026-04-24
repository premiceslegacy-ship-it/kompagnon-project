# Atelier — Architecture Facturation Électronique (Double Vitesse)

## Contexte

La réforme de facturation électronique impose deux obligations :
- **Réception** : dès septembre 2026, toutes les entreprises doivent pouvoir recevoir des factures électroniques structurées
- **Émission** : obligatoire pour les TPE/artisans à partir de septembre 2027

Atelier génère toujours un PDF + un fichier XML conforme. La différence entre les deux modes porte uniquement sur ce qui se passe après la génération.

---

## Stack de déploiement

- **1 repo GitHub** pour tous les clients
- **1 Cloudflare Worker** par client (Next.js via OpenNext + Wrangler)
- Le mode facturation est piloté par **`organization_modules` en base de données** — zéro redéploiement pour activer ou changer de mode
- Les clés B2Brouter (propres à chaque client) sont stockées dans les **variables d'env Cloudflare** du Worker client

---

## Pilotage du mode facturation

Le mode est un flag dans `organization_modules`, exactement comme les modules IA :

```typescript
// organization-modules.ts — à ajouter quand on développe cette feature
'facturation_b2brouter': false  // false = export_only, true = b2brouter
```

Pour activer B2Brouter chez un client :
1. Cockpit Orsayn → modifier le flag `facturation_b2brouter` sur l'org du client
2. Ajouter `B2BROUTER_API_KEY` et `B2BROUTER_SENDER_ID` dans Cloudflare Workers → Settings → Secrets
3. Zéro redéploiement, zéro touche au repo

> **Note :** les clés B2Brouter restent dans les variables d'env Cloudflare (pas en DB) car ce sont des secrets d'API, pas des données applicatives.

---

## Lecture du mode dans le code

```typescript
// Via organization_modules (piloté depuis le cockpit)
const modules = await getOrganizationModules(orgId)
const isB2Brouter = modules.facturation_b2brouter

// Clés API (injectées dans Cloudflare Workers → Settings → Secrets)
const B2BROUTER_API_KEY    = process.env.B2BROUTER_API_KEY
const B2BROUTER_SENDER_ID  = process.env.B2BROUTER_SENDER_ID
```

---

## Générateur XML — Commun aux deux modes

Toutes les instances Atelier génèrent systématiquement deux fichiers à chaque facture émise :
- Un **PDF** lisible par l'humain (inchangé)
- Un **fichier XML structuré** conforme à la norme EN 16931

**Pourquoi XML et pas juste PDF ?**
Le PDF est lisible par un humain, pas par une machine. Le XML balise chaque champ (montant HT, TVA, SIRET, IBAN, échéance...). Il peut être ingéré automatiquement par une PA, un logiciel comptable, ou transmis sur le réseau Peppol/PPF.

**Deux profils selon l'usage :**
- **EN 16931 (COMFORT)** → PDF téléchargeable par le client, conforme légalement, importable dans toute PA (Indy, Pennylane, Sage…). C'est ce qu'Atelier génère aujourd'hui, validé Factur-X.
- **EXTENDED** → requis par B2Brouter pour la transmission automatisée sur le réseau Peppol/PPF. Sur-ensemble d'EN 16931 — les champs COMFORT restent valides, il faut en ajouter.

**Interopérabilité :** un client en mode `export_only` qui télécharge son Factur-X COMFORT et le dépose sur sa PA (Indy, Chorus Pro…) reste lisible par le réseau Peppol côté destinataire. Le format est standard, pas propriétaire.

**Formats acceptés par B2Brouter :** XML UBL 2.1, XML CII D16B, JSON, ou Factur-X EXTENDED. Atelier génère déjà du CII — l'envoi direct XML sans enveloppe PDF/A-3 est possible si besoin.

**Références :**
- Norme EN 16931 (Core)
- Format UBL 2.1 ou CII D16B
- Documentation PPF / Chorus Pro
- B2Brouter API Guides & Références (endpoints, webhooks)

**Ce que le dev fait :**
- Générateur Factur-X à partir du data model facture existant
- Validation des champs obligatoires selon EN 16931 avant génération
- Le fichier généré est disponible en interne pour les deux modes

---

## Mode 1 — `export_only` (`facturation_b2brouter: false`)

**Profil** : artisan qui veut être conforme, gère sa PA lui-même, ou qui n'a pas encore de budget pour l'intégration complète.

**Comportement attendu :**
- Atelier génère la facture en PDF + XML (Factur-X)
- Bouton "Télécharger pour dépôt PA" visible sur chaque facture
- Statut affiché : "À déposer manuellement" tant que l'artisan n'a pas confirmé
- L'artisan dépose le fichier sur sa PA de son choix (Indy, Chorus Pro, autre PDP)
- Les factures reçues : pas de webhook, saisie manuelle dans Atelier

**Ce que le dev fait :**
- Bouton téléchargement Factur-X dans l'UI facture
- Statut "À déposer" / "Déposé" (confirmation manuelle par l'artisan)
- Section factures reçues absente ou en saisie manuelle uniquement

---

## Mode 2 — `b2brouter` (`facturation_b2brouter: true`)

**Profil** : client qui veut zéro friction, volume de facturation suffisant pour justifier le coût B2Brouter.

**Prérequis format :** B2Brouter exige le profil Factur-X **EXTENDED** (ou XML CII/UBL brut). Le générateur EN 16931 existant devra être enrichi avec les champs EXTENDED pour ce mode. Même data model, champs supplémentaires conditionnels — pas un refactor complet.

**Sandbox disponible :** B2Brouter fournit un environnement de test complet (URL sandbox + clé sandbox) pour valider le format XML, les appels API, les statuts de transmission et les webhooks entrants — sans toucher au réseau Peppol/PPF de production. S'enregistrer sur la sandbox avant de développer l'intégration.

**Documentation B2Brouter transmise :**
- API Guides & API Références (endpoints, webhooks, authentification)
- Validateur de facture en ligne
- Enregistrement vidéo API en français
- Webinaire API Demo (anglais, vendredi 9h30)
- Grille tarifaire eDocExchange (mensuel et annuel)
- Manuel revendeur

> **TODO :** récupérer les URLs de documentation B2Brouter et les ajouter ici. S'enregistrer sur la sandbox et demander l'activation des droits.

**Comportement attendu :**

### Émission
- Atelier génère la facture en PDF + XML (Factur-X)
- Appel API B2Brouter automatique pour envoi sur réseau (Peppol ou PPF selon destinataire)
- Statut de la facture mis à jour en temps réel via webhook retour B2Brouter : `envoyée` → `délivrée` → `acceptée`
- Gestion des erreurs : destinataire introuvable, format rejeté, timeout

### Réception
- B2Brouter pousse les factures reçues via webhook entrant dans Atelier
- Elles atterrissent dans la table `received_invoices`
- Statuts : `reçue` → `à valider` → `validée` / `refusée`
- Notification dans l'app à l'artisan
- Possibilité de lier une facture reçue à un projet ou chantier

**Ce que le dev fait :**
- Intégration API B2Brouter (clé lue depuis `process.env.B2BROUTER_API_KEY`)
- Endpoint webhook entrant sécurisé pour réception des factures (`/api/webhooks/b2brouter`)
- UI : section "Factures reçues" avec liste, statuts, actions
- UI : statut de transmission visible sur chaque facture émise

---

## Règles d'affichage UI selon le mode

| Élément UI | `export_only` | `b2brouter` |
|---|---|---|
| Bouton "Télécharger XML / Factur-X" | Visible | Masqué |
| Statut facture | "À déposer manuellement" | Temps réel (envoyée / délivrée / acceptée) |
| Bouton "Envoyer électroniquement" | Masqué | Visible |
| Section "Factures reçues" | Absente | Visible |
| Badge config | "Export Factur-X" | "Connecté B2Brouter" |

---

## Priorité de développement suggérée

1. **Générateur Factur-X** — indépendant, aucune dépendance externe, couvre les deux modes
2. **UI export_only** — bouton téléchargement + statut "à déposer"
3. **Ajouter `facturation_b2brouter` dans `organization_modules`** — gate applicatif
4. **Intégration B2Brouter émission** — appel API + gestion statuts (après réception doc API)
5. **Webhook réception + section factures reçues** — finalise le mode b2brouter

---

## Ce qu'on ne fait pas pour l'instant

- Pas de multi-PA (B2Brouter uniquement pour le mode intégré)
- Pas d'import XML entrant en mode `export_only`
- Pas de rapprochement automatique facture reçue / commande
- Pas de signature électronique avancée (hors scope MVP)
