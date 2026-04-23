# Atelier — Architecture Envoi de Factures & Relances Auto

## Contexte réforme

Deux échéances impactent directement l'envoi de factures et les relances :

- **1er septembre 2026** : toutes les entreprises doivent pouvoir **recevoir** des factures électroniques
- **1er septembre 2027** : toutes les TPE/micro doivent **émettre** via une PA — envoyer un PDF par mail à un client professionnel français ne sera plus légalement valide

L'architecture doit être scalable dès maintenant pour absorber ces deux échéances sans refonte.

---

## Les deux modes de configuration (rappel)

Piloté par variable d'environnement Cloudflare par projet client :

```env
FACTURATION_MODE=export_only   # génère Factur-X, dépôt PA manuel
FACTURATION_MODE=b2brouter     # génère Factur-X, envoi automatique via B2Brouter
```

---

## Architecture envoi de factures

### Flux actuel (avant septembre 2027)

```
Artisan crée facture
        ↓
Atelier génère PDF + Factur-X
        ↓
        ├── [export_only]
        │     ├── Bouton "Envoyer par mail" → mail avec PDF joint (valide jusqu'en sept. 2027)
        │     └── Bouton "Télécharger Factur-X" → dépôt manuel sur PA
        │
        └── [b2brouter]
              ├── Bouton "Envoyer" → transmission automatique via B2Brouter (PA)
              └── Mail de notification au client : "votre facture a été transmise, réf. XXX"
```

### Flux après septembre 2027

```
Artisan crée facture
        ↓
Atelier génère PDF + Factur-X
        ↓
        ├── [export_only]
        │     ├── Bouton "Envoyer par mail" → DÉSACTIVÉ pour clients professionnel_fr
        │     │   Message affiché : "L'envoi par mail n'est plus conforme pour ce client.
        │     │   Téléchargez le Factur-X et déposez-le sur votre PA."
        │     └── Bouton "Télécharger Factur-X" → inchangé
        │
        └── [b2brouter]
              └── Inchangé — déjà conforme
```

---

## Architecture factures récurrentes

### Flux actuel

```
J-X (configurable) avant échéance
        ↓
Atelier génère un brouillon de facture récurrente
        ↓
Notification à l'artisan : "Votre facture récurrente pour [client] est prête à relire"
        ↓
Artisan valide ou modifie
        ↓
Artisan clique "Envoyer"
        ↓
Même flux que l'envoi manuel ci-dessus
```

### Ce qui ne change pas

Le mécanisme de brouillon J-X reste identique. Seul l'envoi final suit le flux décrit ci-dessus selon le mode configuré.

### À prévoir

Ajouter une alerte sur le brouillon si le client destinataire est `professionnel_fr` et que le mode est `export_only` :

> "Ce client nécessite une facture électronique conforme. Pensez à déposer le Factur-X sur votre PA après validation."

---

## Architecture relances automatiques

### Comportement actuel

- Relances impayées : automatiques ou semi-auto (bouton)
- Envoi par mail avec PDF joint

### Nouveau comportement selon mode et type client

#### Avant septembre 2027

| Mode | Type client | Comportement relance |
|---|---|---|
| `export_only` | `professionnel_fr` | Mail avec PDF joint + rappel "déposez le Factur-X sur votre PA" |
| `export_only` | `particulier` | Mail avec PDF joint — inchangé |
| `export_only` | `etranger` | Mail avec PDF joint — inchangé |
| `b2brouter` | `professionnel_fr` | Mail sans PDF, référence facture réseau + statut B2Brouter |
| `b2brouter` | `particulier` | Mail avec PDF joint — inchangé |
| `b2brouter` | `etranger` | Mail avec PDF joint — inchangé |

#### Après septembre 2027

| Mode | Type client | Comportement relance |
|---|---|---|
| `export_only` | `professionnel_fr` | Mail sans PDF joint. Corps du mail : "Votre facture n°XXX du JJ/MM/AAAA d'un montant de XX€ reste impayée. Elle a été transmise via votre plateforme agréée." |
| `export_only` | `particulier` | Mail avec PDF joint — inchangé |
| `b2brouter` | `professionnel_fr` | Inchangé — déjà conforme |
| `b2brouter` | `particulier` | Mail avec PDF joint — inchangé |

---

## Template mail de relance selon le cas

### Relance standard (export_only, particulier, avant et après 2027)

```
Objet : Rappel de paiement — Facture n°[NUM] — [MONTANT]€

Bonjour [PRENOM],

Sauf erreur de notre part, la facture n°[NUM] du [DATE] 
d'un montant de [MONTANT]€ TTC reste impayée.

Merci de procéder au règlement avant le [DATE_LIMITE].

[PDF en pièce jointe]
```

### Relance b2brouter (professionnel_fr)

```
Objet : Rappel de paiement — Facture n°[NUM] — [MONTANT]€

Bonjour [PRENOM],

Sauf erreur de notre part, la facture n°[NUM] du [DATE]
d'un montant de [MONTANT]€ TTC reste impayée.

Cette facture vous a été transmise électroniquement via notre
plateforme agréée (réf. [REF_B2BROUTER]).

Merci de procéder au règlement avant le [DATE_LIMITE].
```

### Relance export_only professionnel_fr (après septembre 2027)

```
Objet : Rappel de paiement — Facture n°[NUM] — [MONTANT]€

Bonjour [PRENOM],

Sauf erreur de notre part, la facture n°[NUM] du [DATE]
d'un montant de [MONTANT]€ TTC reste impayée.

Cette facture a été déposée sur votre plateforme agréée.

Merci de procéder au règlement avant le [DATE_LIMITE].
```

---

## Logique de décision dans le code

```typescript
function getEnvoiConfig(
  facturationMode: 'export_only' | 'b2brouter',
  typeClient: 'professionnel_fr' | 'particulier' | 'etranger',
  date: Date
): EnvoiConfig {

  const apres2027 = date >= new Date('2027-09-01')
  const clientPro = typeClient === 'professionnel_fr'

  return {
    // PDF joint dans le mail ?
    attachPdf: !(apres2027 && clientPro && facturationMode === 'export_only')
               && !(clientPro && facturationMode === 'b2brouter'),

    // Envoi via B2Brouter ?
    viaBrouter: facturationMode === 'b2brouter' && clientPro,

    // Avertissement conformité affiché à l'artisan ?
    showComplianceWarning: facturationMode === 'export_only' && clientPro,

    // Template mail à utiliser
    mailTemplate: clientPro && facturationMode === 'b2brouter'
      ? 'relance_brouter'
      : apres2027 && clientPro
        ? 'relance_post2027'
        : 'relance_standard'
  }
}
```

---

## Récapitulatif des champs nécessaires en base

Ces champs doivent exister sur les entités concernées pour que toute cette logique fonctionne :

**Sur la fiche client :**
```typescript
type_client: 'professionnel_fr' | 'particulier' | 'etranger'
```

**Sur le profil activité de l'artisan :**
```typescript
type_activite: 'vente_biens' | 'prestation_services' | 'mixte'
```

**Sur chaque facture :**
```typescript
type_client_facture: 'professionnel_fr' | 'particulier' | 'etranger' // hérité, modifiable
statut_transmission: 'non_transmise' | 'a_deposer' | 'deposee' | 'envoyee' | 'delivree' | 'acceptee' | 'rejetee'
ref_brouter?: string // rempli si b2brouter
```

---

## Priorité de développement

### Maintenant
1. Ajouter `type_client` sur fiche client
2. Ajouter `type_activite` sur profil artisan
3. Ajouter `statut_transmission` sur facture
4. Développer le générateur Factur-X

### Avant septembre 2026
5. Mode `export_only` : bouton téléchargement Factur-X + statut "à déposer"
6. Alerte conformité sur brouillons récurrents pour clients `professionnel_fr`

### Avant septembre 2027
7. Désactiver l'envoi PDF par mail pour `professionnel_fr` en mode `export_only`
8. Adapter les templates de relance selon la logique décrite
9. Mode `b2brouter` complet si pas déjà fait

---

## Ce qu'on ne gère pas dans cette version

- Accusé de réception légal de la facture par le destinataire (géré par la PA)
- Relance multicanal (SMS, courrier) — hors scope MVP
- Escalade automatique (relance 1, 2, 3 avec délais croissants) — V2
- Mise en demeure automatique — hors scope
