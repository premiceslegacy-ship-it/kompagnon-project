# Atelier — Architecture Facturation Électronique (Double Vitesse)

## Contexte

La réforme de facturation électronique impose deux obligations :
- **Réception** : dès septembre 2026, toutes les entreprises doivent pouvoir recevoir des factures électroniques structurées
- **Émission** : obligatoire pour les TPE/artisans à partir de septembre 2027

Atelier génère toujours un PDF + un fichier XML conforme. La différence entre les deux modes porte uniquement sur ce qui se passe après la génération.

---

## Stack de déploiement

- **1 repo GitHub** pour tous les clients
- **1 projet Cloudflare** par client (Pages ou Workers)
- Le mode facturation est piloté par les **variables d'environnement Cloudflare** du projet client
- Zéro modification de code entre clients

---

## Variables d'environnement par projet Cloudflare

```env
# Mode export manuel
FACTURATION_MODE=export_only

# Mode intégration B2Brouter
FACTURATION_MODE=b2brouter
B2BROUTER_API_KEY=xxxx
B2BROUTER_SENDER_ID=xxxx
```

Quand un client upgrade de `export_only` vers `b2brouter` :
1. Dashboard Cloudflare du projet client
2. Modifier `FACTURATION_MODE` + ajouter les clés B2Brouter
3. Redéploiement
4. Zéro touche au repo

---

## Lecture du mode dans le code

```typescript
const FACTURATION_MODE = process.env.FACTURATION_MODE ?? 'export_only'
```

Valeurs possibles : `'export_only'` | `'b2brouter'`

---

## Générateur XML — Commun aux deux modes

Toutes les instances Atelier génèrent systématiquement deux fichiers à chaque facture émise :
- Un **PDF** lisible par l'humain (inchangé)
- Un **fichier XML structuré** conforme à la norme EN 16931

**Pourquoi XML et pas juste PDF ?**
Le PDF est lisible par un humain, pas par une machine. Le XML balise chaque champ (montant HT, TVA, SIRET, IBAN, échéance...). Il peut être ingéré automatiquement par une PA, un logiciel comptable, ou transmis sur le réseau Peppol/PPF.

**Format cible recommandé : Factur-X profil EXTENDED**
Factur-X = PDF lisible + XML embarqué dans le même fichier. L'humain voit un PDF normal, la machine lit le XML en dessous. C'est le format le plus adapté à la période de transition.

**Références :**
- Norme EN 16931 (Core)
- Format UBL 2.1 ou CII D16B
- Documentation PPF / Chorus Pro

**Ce que le dev fait :**
- Générateur Factur-X à partir du data model facture existant
- Validation des champs obligatoires selon EN 16931 avant génération
- Le fichier généré est disponible en interne pour les deux modes

---

## Mode 1 — `export_only`

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

## Mode 2 — `b2brouter`

**Profil** : client qui veut zéro friction, volume de facturation suffisant pour justifier le coût B2Brouter (modèle eDocExchange — une clé API par client).

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
- Intégration API B2Brouter (clé lue depuis env var `B2BROUTER_API_KEY`)
- Endpoint webhook entrant sécurisé pour réception des factures
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
3. **Intégration B2Brouter émission** — appel API + gestion statuts
4. **Webhook réception + section factures reçues** — finalise le mode b2brouter

---

## Ce qu'on ne fait pas pour l'instant

- Pas de multi-PA (B2Brouter uniquement pour le mode intégré)
- Pas d'import XML entrant en mode `export_only`
- Pas de rapprochement automatique facture reçue / commande
- Pas de signature électronique avancée (hors scope MVP)
