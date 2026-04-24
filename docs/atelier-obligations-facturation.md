# Atelier — Obligations Facturation Électronique & Comportement App

## Les 3 obligations distinctes

### 1. E-invoicing (facturation électronique inter-entreprises)

Concerne les transactions **B2B entre entreprises françaises assujetties à la TVA**.

**Qui est concerné :**
- Toutes les entreprises françaises assujetties à la TVA, quelle que soit leur taille
- Y compris les micro-entrepreneurs et auto-entrepreneurs en franchise de TVA (assujettis mais non redevables)
- Y compris les entreprises qui ne facturent pas la TVA

**Qui n'est pas concerné :**
- Les transactions avec des particuliers (B2C)
- Les transactions avec des entreprises étrangères
- Les activités exonérées de TVA par nature : professions médicales, paramédicales, enseignement, formation, activités agricoles

**Calendrier :**

| Taille | Réception | Émission |
|---|---|---|
| Grandes entreprises (CA > 1,5 Mds€ ou effectif > 5 000) | 1er septembre 2026 | 1er septembre 2026 |
| ETI (250 < effectif < 5 000) | 1er septembre 2026 | 1er septembre 2026 |
| PME, TPE, micro-entreprises | 1er septembre 2026 | 1er septembre 2027 |

---

### 2. E-reporting de transaction

Concerne les ventes qui **ne font pas l'objet de l'e-invoicing** : ventes B2C (particuliers) et ventes à des entreprises étrangères.

L'entreprise ne transmet pas une facture électronique mais des **données de vente agrégées** à l'administration fiscale via sa PA.

**Qui est concerné :**
- Toutes les entreprises assujetties à la TVA qui ont des clients particuliers ou étrangers

**Calendrier :**
- 1er septembre 2027 pour les TPE, micro-entreprises et PME

---

### 3. E-reporting de paiement

Concerne les **prestations de services** dont la TVA est exigible à l'encaissement (pas à la facturation). Ça concerne directement les artisans du bâtiment.

L'entreprise doit signaler à l'administration quand elle est effectivement payée.

**Qui est concerné :**
- Les entreprises dont la TVA est exigible à l'encaissement et qui n'ont pas opté pour le paiement sur les débits
- Cas typique : artisans, prestataires de services

**Calendrier :**
- 1er septembre 2027 pour les TPE, micro-entreprises et PME

---

## Récapitulatif par profil client Atelier

| Profil | E-invoicing | E-reporting transaction | E-reporting paiement |
|---|---|---|---|
| Artisan 100% B2B (pros français) | Oui | Non | Oui si prestation de services |
| Artisan 100% B2C (particuliers) | Non | Oui | Oui si prestation de services |
| Artisan mixte B2B + B2C | Oui (sur factures B2B) | Oui (sur ventes B2C) | Oui si prestation de services |
| Profession médicale / paramédicale | Non | Non | Non |
| Artisan avec clients étrangers | Non (sur ces factures) | Oui (sur ces ventes) | Oui si prestation de services |

---

## Ce que l'app doit faire

### Champ critique : type de destinataire

Sur chaque fiche client dans Atelier, ajouter :

```typescript
type_client: 'professionnel_fr' | 'particulier' | 'etranger'
```

Ce champ conditionne tout le comportement de l'app sur chaque facture. Il est hérité automatiquement à la création d'une facture mais modifiable à la volée si besoin.

---

### Comportement par type de destinataire

**Client `professionnel_fr`**
- Atelier génère la facture en PDF + Factur-X (XML embarqué)
- La facture transite via PA (export manuel ou B2Brouter selon le mode configuré)
- Obligation : e-invoicing + e-reporting de paiement si prestation de services

**Client `particulier`**
- Atelier génère la facture en PDF standard
- Pas de Factur-X nécessaire
- La PA transmet les données agrégées à l'administration (e-reporting transaction)
- Obligation : e-reporting transaction + e-reporting paiement si prestation de services

**Client `etranger`**
- Atelier génère la facture en PDF standard
- Pas d'e-invoicing
- La PA transmet les données agrégées (e-reporting transaction)
- Obligation : e-reporting transaction

---

### Champ prestation de services

Sur chaque facture ou sur le profil activité du client Atelier, ajouter :

```typescript
type_activite: 'vente_biens' | 'prestation_services' | 'mixte'
```

Ce champ détermine si l'e-reporting de paiement s'applique. Pour les artisans du bâtiment, ce sera quasi systématiquement `prestation_services`.

---

### Ce que Atelier génère selon les cas

| Destinataire | Document généré | Ce que la PA reçoit |
|---|---|---|
| Professionnel FR | PDF + Factur-X | Facture structurée transmise au destinataire |
| Particulier | PDF standard | Données agrégées de vente |
| Étranger | PDF standard | Données agrégées de vente |

La PA gère le routage vers l'administration. Atelier fournit les bons inputs, pas besoin de gérer la logique fiscale côté app.

---

### Sanctions en cas de non-conformité

- **15€ par facture non conforme** pour manquement à l'émission électronique
- **Plafond : 15 000€ par an**
- **500€** pour manquement à l'obligation de réception, **1 000€** en cas de manquement renouvelé

---

## Priorité de développement

### À faire maintenant (avant septembre 2026)

1. Ajouter le champ `type_client` sur la fiche client (professionnel_fr / particulier / étranger)
2. Ajouter le champ `type_activite` sur le profil activité (vente_biens / prestation_services / mixte)
3. Lancer le développement du générateur Factur-X (commun aux deux modes)

### À faire avant septembre 2027

4. Finaliser le mode `export_only` : bouton téléchargement Factur-X + statut "à déposer"
5. Intégrer le mode `b2brouter` pour les clients qui veulent l'automatisation complète
6. S'assurer que la PA choisie gère bien les trois obligations (e-invoicing + les deux e-reporting)

---

## Ce que Atelier ne gère pas

- Le routage fiscal vers l'administration (c'est le rôle de la PA)
- La déclaration de TVA (hors scope)
- Le rapprochement automatique e-reporting de paiement / encaissement réel (V2)
- Les factures B2C internationales avec règles TVA spécifiques (hors scope MVP)

---

## Ce que la réforme ne concerne pas

- **Les devis** : aucune obligation légale, pas de format imposé. Le PDF simple suffit.
- **Les factures B2C** : pas d'e-invoicing, PDF standard. La PA gère l'e-reporting agrégé.

---

## Interopérabilité PA : le client reste libre

Un client Atelier en mode `export_only` télécharge son Factur-X (profil EN 16931 COMFORT) et peut le déposer sur **n'importe quelle PA de son choix** (Indy, Pennylane, Chorus Pro, Sage…). Le format est standard et lisible par tout l'écosystème comptable français. Atelier ne crée pas de dépendance : si un client veut utiliser Indy pour sa comptabilité et Atelier pour ses devis et factures, les deux coexistent sans friction.
