# Atelier — Architecture Facturation Électronique (Super PDP)

> **Doc de référence** pour l'implémentation Super PDP dans Atelier. À tenir à jour à chaque évolution de l'archi ou de l'API Super PDP.
>
> Remplace le plan B2Brouter précédent (aucune implémentation réelle n'existait) — voir [[project_pdp_alternatives_2026_08]] pour la comparaison qui a mené à ce choix. Beaucoup de détails techniques Super PDP restent marqués **(à confirmer en sandbox)** : leur doc technique (`superpdp.tech/openapi/`, `/documentation/`) est une SPA JavaScript illisible par les outils de fetch automatiques disponibles au moment de l'écriture de ce doc — seules les informations obtenues par recherche web recoupée ou par action réelle dans leur console sont présentées comme confirmées.

---

## 1. Contexte réglementaire

La réforme française de facturation électronique impose deux obligations :
- **Réception** : à partir du **1er septembre 2026**, toutes les entreprises doivent pouvoir recevoir des factures électroniques via une plateforme agréée (PA), dès lors qu'un fournisseur soumis à l'obligation émet vers elles. Si l'entreprise n'a pas choisi de PA, la DGFiP lui en assigne une par défaut (mécanisme de repli) — pas de blocage légal immédiat à ne rien faire, seulement un risque produit (perte d'opportunité si Atelier ne pilote pas ce flux).
- **Émission** : obligatoire au **1er septembre 2026** pour les grandes entreprises et ETI ; obligatoire au **1er septembre 2027** pour les PME, TPE, artisans et micro-entreprises.

Atelier distingue donc deux sujets :
- **Être prêt à recevoir** : l'entreprise doit avoir une PA opérationnelle dès 2026. Si Atelier pilote Super PDP, la réception passe par Super PDP ; sinon elle reste dans la PA choisie par le client.
- **Émettre depuis Atelier** : tant que le client n'est pas obligé d'émettre électroniquement, Atelier peut continuer à envoyer le PDF classique. Dès que l'émission électronique devient obligatoire ou souhaitée, la facture doit être déposée/transmise via une PA.

Atelier génère un PDF et un XML à partir de l’autorité documentaire disponible. Une pièce émise sans archive vérifiable n’est pas reconstruite avec les coordonnées actuelles : sa génération est refusée explicitement. La génération locale ne certifie ni la conformité de chaque facture ni sa transmission ; les validations et accusés de la PA restent des preuves distinctes. La différence entre les modes porte sur l’orchestration après génération : préparation/téléchargement sans transmission dans `export_only`, ou transmission via Super PDP.

### Autorité fiscale et renvoi — cutover du 27 octobre 2026

- Les nouvelles émissions capturent les faits fiscaux et les parties dans `issuance_snapshot`, sous contrôle transactionnel des lignes et totaux. PDF, XML et éligibilité PDP consomment ces faits, pas le profil mutable de l’entreprise.
- La revendication d’un renvoi d’une facture déjà émise est indépendante du statut financier. Un succès, un échec ou une réponse fournisseur ambiguë ne doit pas réécrire le paiement, les montants ou `sent_at`.
- L’archivage d’interface ne retire pas une facture émise des pièces et encaissements du rapport mensuel. Les montants et la TVA proviennent de l’autorité de chaque facture, même si le profil courant ou la visibilité de la pièce a changé.
- Une annulation de brouillon reste non émise : absence d’autorité originale et marqueur DB `unissued_cancelled_at`. Les anciennes annulations ne sont pas rétroactivement classées sans preuve.
- Un import CSV conserve ses états historiques comme données **non vérifiées**, sans créer de paiement, signature ou archive originale. L’accès au PDF/XML original peut donc rester indisponible.
- Avant l’anonymisation, `legacy_legal_retention_contexts` peut conserver le dernier contexte connu pour une ancienne pièce sans autorité disponible. Cette observation privée ne sert jamais de source au PDF/XML ni à l’éligibilité PDP.
- Déployer la chaîne principale complète jusqu’à `214`, ainsi que la migration cockpit `019`. `213` enregistre le paiement et son état financier dans la même transaction ; `214` vérifie les publications contre le JSONB stocké, sans changer les sceaux historiques après un aller-retour numérique JSON. Réconcilier les anciennes pièces jointes et faire passer le contrôle de cutover avant déploiement ou effacement. Les fixtures locales ne remplacent pas une qualification de bout en bout auprès de la PA ; aucun nouveau test fournisseur réel n’est revendiqué par ce cutover.

---

## 2. Stack de déploiement

- **1 repo GitHub**, plusieurs déploiements Cloudflare Workers (Next.js via OpenNext + Wrangler) — un déploiement par client, plus un déploiement dédié au cockpit Orsayn (`orsayn-cockpit`, basculé en mode cockpit via `OPERATOR_MODE=true` + `OPERATOR_SUPABASE_URL`/`OPERATOR_SUPABASE_SERVICE_ROLE_KEY`).
- Le mode facturation est piloté par une **configuration synchronisée depuis le cockpit** — zéro redéploiement pour activer ou changer de mode.
- **Les tokens OAuth Super PDP vivent uniquement côté cockpit**, jamais répliqués vers les instances clientes (voir §3 et §7 — l'application OAuth est portée par une seule "Entreprise", Orsayn).

---

## 3. Pilotage du mode facturation

Le mode n'est pas un simple module IA. Il fait partie de la configuration opérateur synchronisée depuis le cockpit vers l'instance client.

```typescript
type EinvoicingMode = 'off' | 'export_only' | 'super_pdp'

type EinvoicingConfig = {
  mode: EinvoicingMode
  provider: 'super_pdp' | 'external_pa' | null
  environment: 'sandbox' | 'production'
  annuaire_status: 'not_started' | 'pending' | 'active' | 'error'
  oauth_status: 'not_connected' | 'pending' | 'connected' | 'error' | 'revoked'
  oauth_connected_at: string | null
  super_pdp_connection_id: string | null
}
```

Modes retenus :

| Mode | Sens produit | Usage |
|---|---|---|
| `off` | Aucune assistance e-facturation dans Atelier | Client pas encore préparé ou hors périmètre MVP |
| `export_only` | Atelier prépare le PDF/Factur-X, mais l'envoi reste normal jusqu'à l'obligation 2027 et Atelier ne transmet pas à une PA | Préparation conformité, tests, fallback, ou client ayant une autre PA |
| `super_pdp` | Atelier transmet et suit les statuts via Super PDP | Client géré par Orsayn/Super PDP |

**Différence structurante avec le plan B2Brouter précédent** : Super PDP fonctionne en OAuth 2.1 multi-tenant, pas en création manuelle de compte par client dans une UI tierce. L'activation se fait par un flux d'autorisation déclenché par le client lui-même depuis son instance Atelier — pas par une configuration manuelle du cockpit vers un `account_id` pré-existant. Voir §7.

`oauth_status`/`oauth_connected_at`/`super_pdp_connection_id` sont pilotés par ce flux OAuth, pas par le formulaire cockpit `/orsayn` (qui reste en lecture seule sur ces champs).

---

## 4. Lecture du mode dans le code

```typescript
const config = await getEinvoicingConfig(orgId)
const isExportOnly = config.mode === 'export_only'
const isSuperPdp = config.mode === 'super_pdp'
const isSandbox = config.environment === 'sandbox'
const isConnected = config.oauth_status === 'connected'
```

Les tokens OAuth ne sont **jamais** lus côté instance cliente — toute opération de facturation passe par un endpoint proxy côté cockpit (voir §7.3). L'instance ne connaît que le statut de connexion (`oauth_status`), pas les credentials.

---

## 5. Générateur XML — Commun aux deux modes

Toutes les instances Atelier génèrent systématiquement deux fichiers à chaque facture émise :
- Un **PDF** lisible par l'humain (inchangé)
- Un **fichier XML structuré** conforme à la norme EN 16931

État actuel : Atelier sait déjà produire un Factur-X **profil EN 16931 / Comfort** (`src/lib/pdf/facturx-xml.ts`, `facturx-embed.ts`, `facturx-profile.ts`). Ce générateur est **entièrement indépendant du fournisseur PA** — acquis, ne nécessite aucune adaptation pour Super PDP. Format retenu côté Super PDP : Factur-X (confirmé — champ "Format préféré de conversion AFNOR" de l'application OAuth, cohérent avec l'existant).

**Pourquoi XML et pas juste PDF ?**
Le PDF est lisible par un humain, pas par une machine. Le XML balise chaque champ (montant HT, TVA, SIRET, IBAN, échéance...). Il peut être ingéré automatiquement par une PA, un logiciel comptable, ou transmis sur le réseau Peppol/PPF.

**Interopérabilité :** un client en mode `export_only` récupère un Factur-X standard, exploitable par des outils ou plateformes compatibles. Atelier ne présume pas du workflow réel de la PA tierce tant qu'il n'a pas été validé en conditions terrain.

---

## 6. Mode 1 — `export_only` (`einvoicing_config.mode = 'export_only'`)

Section inchangée par rapport au plan précédent — indépendante du fournisseur PA.

**Profil** : artisan qui ne veut pas que Atelier pilote sa PA.

`export_only` signifie : Atelier produit un fichier exploitable par une PA, mais **la responsabilité du dépôt/transmission reste hors Atelier**.

Ce mode couvre trois cas :
- **Avant le 1er septembre 2027** pour les TPE/PME : l'émission électronique n'est pas encore obligatoire, mais Atelier peut déjà préparer des Factur-X propres pour tester.
- **Après le 1er septembre 2027** : le client a choisi une PA autre que Super PDP. Atelier fournit le Factur-X, mais ne confirme pas le workflow d'entrée de la PA tierce ni que la facture a été transmise.
- **Fallback opérationnel** : Super PDP indisponible ou connexion OAuth incomplète ; l'artisan peut récupérer le fichier et traiter manuellement.

Ce mode ne couvre pas la réception 2026. Pour recevoir, le client doit consulter sa PA. Si Orsayn/Super PDP pilote la réception, il faut passer en mode `super_pdp`.

En 2026, la section "Factures reçues" dans Atelier n'est donc affichée que pour les clients en mode `super_pdp`.

**Comportement attendu :**
- Atelier génère la facture en PDF + XML (Factur-X)
- Avant le 1er septembre 2027 pour TPE/PME/artisans : l'envoi PDF/mail reste le comportement normal
- Bouton "Télécharger Factur-X" visible sur chaque facture éligible
- Statut affiché : "Factur-X généré" / "Factur-X à corriger" selon les validations
- Aucune action "marquer comme déposé" en V1 : ce statut serait trompeur tant que les PA tierces et leurs workflows ne sont pas validés
- **Pas de section "Factures reçues"** dans ce mode — réévalué après retours terrain

---

## 7. Mode 2 — `super_pdp` (`einvoicing_config.mode = 'super_pdp'`)

**Profil** : client qui veut que Orsayn/Atelier orchestre la PA Super PDP : émission, réception, statuts, audit trail.

### 7.1. Statut Super PDP — confirmé

| Élément | Valeur |
|---|---|
| Immatriculation DGFiP | Définitive au 22/12/2025 |
| Certification | Peppol AP (Access Point) + SMP |
| ISO 27001 | Certifié par le LNE |
| Format AFNOR retenu | Factur-X |
| Environnements | Production + sandbox ("bac à sable"), sandbox avec entreprises/SIREN pré-configurés pour tests |

### 7.2. Modèle d'authentification — OAuth 2.1

**Confirmé par exécution réelle du flux le 25/08/2026**, contre l'app sandbox Atelier, avec le script `scripts/super-pdp-sandbox-probe.mjs` (calqué sur les exemples officiels [`github.com/superpdp/examples`](https://github.com/superpdp/examples) : `erp.go`, `quick_start.js`, `facturx.js` — Go et Node, tous deux lisibles malgré la SPA JS du site principal).

Base API confirmée : `https://api.superpdp.tech`.

Deux flux distincts :

- **`client_credentials`** : l'application agit sur ses propres données (style clé API simple) — usage propre d'Orsayn, pas pour piloter un client. `POST /oauth2/token` avec `grant_type=client_credentials`.
- **`authorization_code`** via `GET /oauth2/authorize` : l'application agit "pour le compte" d'une entité tierce. **Testé en conditions réelles et fonctionnel** : le tunnel a authentifié l'entreprise sandbox préconfigurée "Tricatel" (SIREN fictif du bac à sable), distincte du porteur Orsayn de l'application. **Le modèle multi-tenant est donc confirmé — un tiers peut bien autoriser l'app Atelier.**

**Détails de l'échange confirmés (réponse brute, sandbox) :**
```json
// POST /oauth2/token (grant_type=authorization_code) →
{
  "access_token": "…",
  "expires_in": 1800,
  "refresh_token": "…",
  "scope": "",
  "token_type": "bearer"
}
```
- `expires_in` = **1800s (30 min)** — access_token court, refresh systématique à prévoir.
- `refresh_token` est à usage unique : la rotation doit être conservée avant tout appel métier.
- `scope` vide accepté (aucun scope explicite demandé dans l'exemple officiel ni dans ce test) — aucune restriction de scope observée.
- Client secret envoyé en **body** du POST (`client_id` + `client_secret`), pas en Basic Auth HTTP.
- **PKCE absent** des deux implémentations de référence (Go et Node) et du flux testé — `code_verifier`/`code_challenge` non requis malgré la recommandation OAuth 2.1 générale. Le `state` (aléa 16 octets base64url) reste la seule protection CSRF du flux.

```json
// GET /v1.beta/companies/me (Bearer access_token) →
{
  "id": 68809,
  "created_at": "2026-08-22T16:02:22.407685Z",
  "env": "sandbox",
  "number_scheme": "sandbox",
  "number": "000000001",
  "formal_name": "Tricatel",
  "trade_name": "",
  "address": "Avenue de la République",
  "postcode": "37170",
  "city": "Chambray-lès-Tours",
  "country": "FR",
  "vat_regime": "vat_exemption",
  "has_vat_on_debits": false
}
```
**`id` (entier, ex. `68809`) est l'identifiant stable à stocker dans `super_pdp_connection_id`** — pas un SIREN. `env`/`number_scheme` permettent de vérifier côté callback qu'on ne mélange pas un token sandbox avec une config `environment = 'production'`.

**Application OAuth Atelier** : une seule application créée (confirmé par action réelle dans la console Super PDP) :
- Champ "Entreprise" **verrouillé à une seule option pré-remplie** (Orsayn, le porteur de l'application — pas une restriction à un seul client final, confirmé par test réel de l'utilisateur).
- Type d'application : **Confidentielle** (client_secret côté serveur Cloudflare Workers).
- Format AFNOR : **Factur-X**.
- URL de redirection production : `https://orsayn-cockpit.mbebourasam.workers.dev/api/einvoicing/oauth/callback?env=production`. Elle doit correspondre exactement à celle enregistrée chez le fournisseur ; le callback utilise l’environnement configuré côté cockpit, pas une valeur choisie par l’appelant.
- Une deuxième application dédiée au bac à sable existe, même configuration.

**Conséquence architecturale** : puisqu'une seule application = un seul porteur (Orsayn), **c'est le cockpit qui détient et rafraîchit tous les tokens OAuth**, pas chaque instance cliente. Chaque instance passe par un endpoint proxy côté cockpit pour les opérations de facturation électronique.

### 7.3. Flux d’activation OAuth

1. L’owner d’une organisation lance la connexion depuis les paramètres de son instance Atelier, après contrôle de `einvoicing.configure`.
2. L’instance signe un `state` HMAC contenant `source_instance`, `organization_id`, un nonce et l’heure d’émission, avec son propre secret dérivé. Le state est valable dix minutes.
3. L’instance redirige vers `/oauth2/authorize` de Super PDP. Au retour, seul le cockpit vérifie le state : `OPERATOR_MASTER_SECRET` est obligatoire et sert à dériver la clé attendue pour le `source_instance` décodé. Aucun accès au contexte client avant validation du HMAC ; les anciens alias partagés ne sont pas un fallback de vérification.
4. L'owner autorise côté Super PDP — **partiellement confirmé** : dans le test sandbox du 25/08/2026, le tunnel a directement authentifié une entreprise déjà préconfigurée dans le bac à sable ("Tricatel"), sans étape KYC visible. **Reste non confirmé** : le comportement pour un SIREN client réel qui n'a jamais eu de compte Super PDP en production — création à la volée vs redirection vers un formulaire séparé (email/mot de passe/KYC). À revalider avec le support Super PDP ou un premier client pilote avant la mise en production.
5. Super PDP redirige vers le callback unique côté cockpit (`/api/einvoicing/oauth/callback`).
6. Le cockpit échange le `code` contre `access_token`/`refresh_token`, les chiffre (AES-256-GCM, `src/lib/crypto/secrets.ts`), les stocke dans `super_pdp_oauth_credentials` (DB opérateur uniquement).
7. Le cockpit met à jour `organization_einvoicing_config` de l'instance cliente concernée (`oauth_status = 'connected'`, `super_pdp_connection_id`) via le mécanisme `config-sync` existant.
8. Le cockpit redirige l'utilisateur vers son instance d'origine (décodée depuis le `state`), avec le statut de connexion affiché.

### 7.4. Émission et réception de factures (Phase 2-3)

**Endpoints réels, lus dans les exemples officiels `github.com/superpdp/examples`** (`quick_start.js`, `facturx.js` — pas encore exécutés en conditions réelles côté Atelier, contrairement au flux OAuth du §7.2) :

| Opération | Endpoint | Détail |
|---|---|---|
| Émission | `POST /v1.beta/invoices` | Body = **XML brut** (UBL ou CII), pas de JSON structuré. `Authorization: Bearer` du vendeur. |
| Facture de test | `GET /v1.beta/invoices/generate_test_invoice?format=ubl\|cii` | Utile pour les tests d'intégration. |
| Liste / réception | `GET /v1.beta/invoices?starting_after_id=N&order=desc` | **Polling, aucun webhook observé dans les exemples officiels.** Côté acheteur, avec son propre token. |
| Détail facture | `GET /v1.beta/invoices/{id}` | Champ `en_invoice` non nul = facture traitée (JSON EN 16931 normalisé). |
| Statuts métier | `POST /v1.beta/invoice_events` | `{ invoice_id, status_code, details: [{ amounts: [...] }] }`. Ex. `status_code: "fr:212"` = encaissée. Codes `fr:xxx` à mapper (liste complète non trouvée dans les exemples). |
| Validation | `POST /v1.beta/validation_reports` | Multipart `file` → `{ data: [{ is_valid }] }`. |
| Conversion CII→JSON | `POST /v1.beta/invoices/convert?from=cii&to=en16931` | Body = XML brut. |
| Conversion JSON+PDF→Factur-X | `POST /v1.beta/invoices/convert?from=en16931&to=factur-x` | Multipart `invoice` (JSON) + `pdf`. |
| Identité vendeur/acheteur | `GET /v1.beta/companies/me` | Voir §7.2 — confirmé en sandbox. |

**Toujours non confirmé** (voir §15, réduit) :
- Format exact des erreurs API sur ces endpoints spécifiquement (le flux OAuth confirme un HTTP standard, à revérifier sur `/v1.beta/invoices`).
- Existence d'un webhook alternatif au polling en production (les exemples n'en montrent pas, mais ne prouvent pas son absence).
- Liste complète des `status_code` `fr:xxx`.
- Équivalent de l'annuaire Peppol/vérification `in_dgfip_annuaire` et son délai de propagation.
- Support des avoirs (notes de crédit).

Toute opération de facturation passera par un **endpoint proxy côté cockpit** (cohérent avec l'architecture retenue en §7.2) plutôt que par un appel direct instance → Super PDP.

### 7.5. Réception de factures — modèle produit (indépendant du fournisseur)

Tables déjà existantes et **génériques, réutilisables sans migration** : `received_invoices` et `pa_status_events` (`supabase/migrations/005_advanced_tables.sql`). Les colonnes utilisent un préfixe `pa_` générique (Plateforme Agréée), pas spécifique à un fournisseur — confirmé en lisant le schéma, aucune colonne nommée `b2brouter_*` dedans.

**Positionnement produit** (validé, indépendant du fournisseur — voir [[project_received_invoices]]) : Atelier n'est pas un logiciel comptable. Pour les factures reçues, l'UI expose seulement `Reçue → À payer → Payée`. Le lien vers un projet/chantier est **optionnel**. Pas de saisie comptable, pas de plan de comptes — un export CSV/PDF pour l'expert-comptable suffit.

---

## 8. Modèle de données

### 8.1. Tables existantes, réutilisées sans changement

- `received_invoices`, `pa_status_events` (`005_advanced_tables.sql`) — génériques, voir §7.5.

### 8.2. Tables modifiées (Phase 0, faite)

**`organization_einvoicing_config`** (instance cliente, `supabase/migrations/173_super_pdp_einvoicing_config.sql`) :
- Retiré : `onboarding_model`, `b2brouter_account_id` (concepts propres à B2Brouter/eDocExchange, sans équivalent Super PDP).
- Ajouté : `oauth_status`, `oauth_connected_at`, `super_pdp_connection_id` (métadonnées de statut uniquement, aucun secret).
- `mode` CHECK : `off | export_only | super_pdp`. `provider` CHECK : `external_pa | super_pdp`.

**`operator_client_subscriptions`** (DB opérateur, `supabase/operator-migrations/014_super_pdp_einvoicing_config.sql`) : même changement en miroir, pour affichage cockpit. Colonne `b2brouter_active` (booléen legacy redondant, jamais consommé dans l'UI) retirée.

### 8.3. Table nouvelle et état de refresh (migrations cockpit 013 et 020)

**`super_pdp_oauth_credentials`** (DB opérateur uniquement, `supabase/operator-migrations/013_super_pdp_oauth_credentials.sql`) :
```sql
CREATE TABLE public.super_pdp_oauth_credentials (
  source_instance          TEXT        NOT NULL,
  organization_id           UUID        NOT NULL,
  access_token_encrypted    TEXT        NOT NULL,
  refresh_token_encrypted   TEXT        NOT NULL,
  token_expires_at          TIMESTAMPTZ NOT NULL,
  refresh_state             TEXT        NOT NULL DEFAULT 'ready',
  refresh_claim_owner       UUID,
  refresh_claimed_at        TIMESTAMPTZ,
  credential_revision       UUID        NOT NULL DEFAULT gen_random_uuid(),
  scopes                    TEXT[],
  environment               TEXT        NOT NULL DEFAULT 'sandbox',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_instance, organization_id)
);
```
La migration cockpit `020_super_pdp_refresh_claims.sql` ajoute l’état durable et les RPC `claim_super_pdp_oauth_refresh`, `complete_super_pdp_oauth_refresh`, `fail_super_pdp_oauth_refresh` et `store_super_pdp_oauth_grant`, exécutables uniquement par `service_role`. Le claim verrouille la paire `(source_instance, organization_id)` pendant sa décision et ne renvoie aucun ciphertext si `environment` ne correspond pas au `SUPER_PDP_ENV` explicite du cockpit (`sandbox` ou `production`). Le callback vérifie aussi que le `env` retourné par `/v1.beta/companies/me` correspond à cette configuration, avant d’enregistrer le grant ou de déclarer la connexion active.

Un claim est borné à 30 secondes et la requête fournisseur à 10 secondes. Les réponses concurrentes obtiennent `busy` sans recevoir le refresh token. Un timeout, une réponse mal formée, une erreur de persistance ou un claim expiré impose `reconnect_required` : l’ancien refresh token n’est jamais rejoué. La complétion CAS vérifie le propriétaire et la révision, puis enregistre les deux tokens chiffrés et l’expiration atomiquement avant de rendre l’accès utilisable. `store_super_pdp_oauth_grant` remplace le grant et efface tout claim en une seule transaction; une réponse de refresh déjà en vol ne peut alors écraser les nouveaux identifiants.

Un trigger bloque toute insertion ou modification directe de `super_pdp_oauth_credentials` : seules les RPC du protocole posent leur marqueur transactionnel pendant l’écriture. RLS est activée sans policy; la table et les RPC restent hors d’accès `anon`/`authenticated`. Les tokens restent exclusivement côté cockpit via `createOperatorAdminClient()` et ne sont jamais lus par les instances clientes.

### 8.4. Frontière des tables opérateur (migration cockpit 021)

La migration `supabase/operator-migrations/021_operator_table_security.sql` établit la frontière cible `service_role` seul pour `operator_client_events`, `operator_client_quotas`, `operator_client_settings`, `operator_client_subscriptions`, `operator_clients`, `operator_commercial_events`, `operator_quota_usage_events` et `operator_usage_events`. La qualification en lecture seule du cockpit de production a confirmé RLS active et zéro policy sur ces tables, mais aussi des privilèges effectifs `anon`/`authenticated`, dont DML et `TRUNCATE`; 021 révoque ces privilèges puis accorde `SELECT`/`INSERT`/`UPDATE`/`DELETE` à `service_role`. Cette révocation distante requiert un accord explicite préalable. La migration ne crée ni ne supprime de policy.

L’assertion read-only `assert_operator_table_security()` vérifie l’existence des huit tables, RLS active, l’absence de toute policy divergente, les privilèges effectifs des rôles et le bypass RLS de `service_role`. `scripts/operator-schema-check.mjs` exige cette assertion en plus du garde 020; une policy inattendue ou une RLS désactivée bloque donc le déploiement au lieu d’être masquée.

---

## 9. Architecture code

```
src/
├── app/api/
│   ├── einvoicing/oauth/callback/route.ts   # Callback OAuth, cote cockpit uniquement (a creer)
│   └── operator/config-sync/route.ts        # Existant, deja adapte (Phase 0)
├── lib/crypto/
│   └── secrets.ts                           # Chiffrement AES-256-GCM (Phase 0, fait)
├── lib/super-pdp/                           # A creer en Phase 1+
│   ├── client.ts                            # Wrapper API (auth, refresh token)
│   ├── types.ts                             # Types TS des payloads Super PDP
│   └── oauth-state.ts                       # sign/verify du parametre state (reutilise src/lib/operator.ts)
├── lib/einvoicing-config.ts                 # Existant, deja adapte (Phase 0)
└── lib/pdf/
    └── facturx-xml.ts                       # Generateur existant, inchange
```

### 9.1. Edge runtime

Le callback OAuth doit tourner sur le runtime Cloudflare Workers (cohérent avec le reste de l'app). `crypto.subtle` (Web Crypto API) y est nativement disponible — c'est le choix fait pour `src/lib/crypto/secrets.ts` plutôt que le module `crypto` de Node (déjà évité ailleurs dans le repo, `src/lib/operator.ts`, pour la même raison de fiabilité runtime).

---

## 10. Sécurité

| Vecteur | Mitigation |
|---|---|
| Fuite de token OAuth | Chiffrement AES-256-GCM avant stockage (`src/lib/crypto/secrets.ts`), clé maître en secret Cloudflare (`SUPER_PDP_ENCRYPTION_KEY`), jamais en DB |
| Token répliqué vers une instance compromise | Non applicable — les tokens ne quittent jamais le cockpit |
| Spoofing du `state` OAuth | Signature HMAC-SHA256 avec la clé dérivée de l’instance ; vérification cockpit avec master obligatoire, sans fallback partagé, avant lecture du contexte client ou échange du code |
| Lecture `super_pdp_oauth_credentials` | RLS activée sans policy : accessible uniquement via `service_role` |
| Lecture `organization_einvoicing_config` (statuts, pas de secrets) | RLS existante : lecture par tout membre org, écriture réservée `settings.edit_org` |
| Insertion `received_invoices` | RLS : INSERT uniquement via `service_role` (webhook/cron, mécanisme exact à définir en Phase 3) |

---

## 11. Règles d'affichage UI selon le mode

| Élément UI | `off` | `export_only` | `super_pdp` |
|---|---|---|---|
| Bouton "Télécharger XML / Factur-X" | Masqué | Visible | Option debug/admin |
| Statut facture émise | PDF classique | "Factur-X prêt" / "Données à compléter" | Temps réel (structure exacte à confirmer en sandbox) |
| Bouton "Activer la facturation électronique" | Masqué | Masqué | Visible si `oauth_status != 'connected'` |
| Section "Factures reçues" | Absente | Absente | Visible si `oauth_status == 'connected'` |
| Badge config (cockpit `/orsayn`) | "Non configuré" | "Factur-X prêt" | "Super PDP connecté" / "non connecté" / "en erreur" selon `oauth_status` (`src/app/(app)/orsayn/utils.ts`, `getEinvoicingBadge`) |

### 11.1. Lecture selon calendrier

| Date / obligation | Mode recommandé | Pourquoi |
|---|---|---|
| Avant le 01/09/2026 | `off` ou `export_only` | Préparation et tests sans contrainte légale de réception dans Atelier |
| Du 01/09/2026 au 31/08/2027 pour TPE/PME | `super_pdp` si Orsayn pilote la réception, sinon `export_only` | Réception obligatoire via une PA ; émission encore non obligatoire pour TPE/PME |
| À partir du 01/09/2027 pour TPE/PME | `super_pdp` ou `export_only` avec PA externe | Émission obligatoire via une PA |

---

## 12. Plan de développement

### Phase 0 — Fondations (faite)
1. Migration `organization_einvoicing_config` (instance) — retrait B2Brouter, ajout colonnes OAuth.
2. Migration `operator_client_subscriptions` (cockpit) — miroir, retrait `b2brouter_active`.
3. Table `super_pdp_oauth_credentials` (cockpit uniquement).
4. Lib de chiffrement `src/lib/crypto/secrets.ts` (AES-256-GCM, Web Crypto API).
5. Adaptation `src/lib/einvoicing-config.ts`, `config-sync/route.ts`, UI cockpit `/orsayn` (`OffreTab.tsx`, `actions.ts`, `types.ts`, `utils.ts`), et les deux points d'intégration Stripe (`webhooks/stripe/route.ts`, `stripe/cancel-subscription/route.ts`).
6. Ce doc.

### Phase 1 — Flux OAuth de bout en bout en sandbox
7. `src/lib/super-pdp/oauth-state.ts` — sign/verify du `state`, réutilise le pattern HMAC existant.
8. UI "Activer la facturation électronique" côté instance cliente (`/settings`, à créer — n'existe pas aujourd'hui).
9. `src/app/api/einvoicing/oauth/callback/route.ts` — échange du code, chiffrement, stockage, mise à jour `organization_einvoicing_config` via `config-sync`, redirection finale.
10. Validation avec les entreprises factices du bac à sable Super PDP avant tout code de facturation réelle.

### Phase 2 — Émission de facture via API
11. Résoudre les inconnues du §15 en sandbox.
12. `src/lib/super-pdp/client.ts` — wrapper API (auth via token cockpit, refresh, retry).
13. Endpoint proxy côté cockpit pour l'émission (pas d'appel direct instance → Super PDP).
14. Mapper facture Atelier → payload Super PDP.

### Phase 3 — Réception
15. Mécanisme de réception (webhook ou polling, selon ce qui est confirmé en Phase 2).
16. Insertion `received_invoices` + `pa_status_events`.
17. UI section "Factures reçues" (liste, statuts, lien chantier optionnel).

### Phase 4 — Conformité avancée et UI complète
18. Statuts temps réel sur facture émise.
19. Export CSV factures reçues pour expert-comptable.
20. Notification artisan sur nouvelle facture reçue.

---

## 13. Hors scope MVP

- **Multi-PA** : Super PDP uniquement pour le mode intégré.
- **Chorus Pro B2G** : pas de clients secteur public à date — flux DGFiP/Peppol couvre 100% de l'usage artisan.
- **Rapprochement automatique** facture reçue ↔ commande.
- **Signature électronique avancée** (eIDAS qualifié).
- **Section Factures reçues en mode `export_only`** : réévalué après retours terrain.
- **Saisie comptable** : Atelier reste un outil de gestion de chantier, pas un logiciel comptable.
- **Avoirs (notes de crédit)** : support Super PDP non vérifié à date — à confirmer en sandbox si le besoin se présente.

---

## 14. Références

- **Doc Super PDP** : https://www.superpdp.tech/documentation/ (SPA JS, nécessite lecture manuelle en navigateur)
- **DGFiP officiel** : https://www.impots.gouv.fr/facturation-electronique-702
- **Peppol BIS 3.0** : https://docs.peppol.eu/poacc/billing/3.0/
- **France CIUS (FR-B2B)** : https://www.fnfe-mpe.org/
- **CGI Article 261** (exemptions TVA) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000006162554/
- **Norme EN 16931** (Core)
- **Format UBL 2.1 / CII D16B**

---

## 15. À éclaircir

### Résolu (confirmé par exécution réelle du flux OAuth, 25/08/2026 — voir §7.2)

- [x] Le flux `authorization_code` multi-tenant fonctionne réellement : testé de bout en bout contre l'app sandbox Atelier avec une entreprise du bac à sable ("Tricatel"), distincte du porteur Orsayn. Confirme que le modèle architectural retenu est viable.
- [x] Durée de vie de l'`access_token` : **1800s (30 min)**. `refresh_token` présent dans la réponse d'échange (`grant_type=authorization_code`).
- [x] Contenu de la réponse d'échange : `access_token`, `expires_in`, `refresh_token`, `scope`, `token_type`. Pas de champ d'identifiant de compte — il faut un appel séparé à `GET /v1.beta/companies/me`.
- [x] Identifiant à stocker dans `super_pdp_connection_id` : **`company.id`** (entier, ex. `68809`), retourné par `GET /v1.beta/companies/me`. Pas un SIREN.
- [x] Endpoints réels de création/émission de facture, format des payloads (XML brut, pas JSON), endpoints de conversion et de validation — voir §7.4, lus dans les exemples officiels `github.com/superpdp/examples`.
- [x] Existence de webhooks : **aucun trouvé dans les exemples officiels** — le modèle de référence utilise un polling sur `GET /v1.beta/invoices?starting_after_id=`. À traiter comme l'hypothèse de travail pour la Phase 3, sauf découverte contraire.
- [x] PKCE : absent des implémentations de référence (Go et Node) et du flux testé — non requis malgré OAuth 2.1.

### Résolu (confirmé par exécution réelle émission/réception, 29/08/2026 — script `scripts/super-pdp-emission-reception-probe.mjs`, voir §7.4)

- [x] **Rotation du `refresh_token` : confirmée.** Chaque `POST /oauth2/token` avec `grant_type=refresh_token` renvoie un nouveau `refresh_token`, différent du précédent. Le code de refresh (`src/lib/super-pdp/client.ts`) doit persister le nouveau token à chaque appel, jamais réutiliser l'ancien après un refresh réussi.
- [x] **Format d'une émission réussie** (`POST /v1.beta/invoices`, body XML brut, `Authorization: Bearer` vendeur) :
  ```json
  {
    "id": 374903,
    "company_id": 68809,
    "created_at": "2026-08-29T09:18:15.901188Z",
    "events": [{ "id": 1063493, "created_at": "...", "invoice_id": 374903, "status_code": "api:uploaded", "status_text": "Téléversée" }],
    "direction": "out",
    "processing_rule": "B2B"
  }
  ```
  `id` (entier) est l'identifiant stable à stocker dans `invoices.pa_message_id`. `events[].status_code` porte le premier statut du cycle de vie (`api:uploaded`) — préfixe `api:`, pas `fr:` (voir plus bas).
- [x] **Format exact des erreurs API, confirmé sur `/v1.beta/invoices`** : HTTP standard (400 testé), body `{ "http_status_code": 400, "message": "..." }`. Testé avec un XML volontairement invalide → `{"http_status_code":400,"message":"etree: invalid XML format"}`. Simple à mapper côté client.
- [x] **`GET /v1.beta/invoices/{id}`** renvoie exactement le même objet que la réponse d'émission (mêmes champs, `events` inclus) — pas de champ `en_invoice` observé sur une facture tout juste émise (peut apparaître après traitement asynchrone, non confirmé).
- [x] **Format de la liste/pagination** (`GET /v1.beta/invoices?starting_after_id=N&order=desc`) :
  ```json
  { "data": [{ "id": 374903, "company_id": 68809, "created_at": "...", "direction": "out", "processing_rule": "B2B" }], "count": 1, "has_before": false, "has_after": false }
  ```
  Pagination par booléens `has_before`/`has_after`, pas de curseur opaque séparé — le curseur pour l'appel suivant est le plus grand `id` vu (`starting_after_id`). À utiliser pour `super_pdp_reception_state.last_synced_invoice_id`.
- [x] **`POST /v1.beta/invoice_events` échoue juste après émission** : `{"http_status_code":400,"message":"La facture liée est en cours de traitement. Réessayer plus tard"}`. Il existe donc un **délai de traitement asynchrone** entre l'émission et la possibilité de poser un statut métier — le polling de réception (ou un retry différé) devra en tenir compte, ne pas considérer un premier échec `invoice_events` comme définitif juste après soumission.
- [x] **Validation du format CII, confirmée compatible EN 16931 — sur le XML maison, pas seulement la facture de test** : `POST /v1.beta/validation_reports` sur le XML produit par `generateFacturXml()` pour une vraie facture Weber (Groupe Deschamps Industrie, 846€ TTC) → `is_valid: true`, 0 échec sur 3 validateurs cumulés (XSD `CrossIndustryInvoice_100pD22B`, XSLT `FACTUR-X_EN16931`, Schematron `BR-FR-Flux2`). Confirmé le 31/08/2026, après ajout du `GlobalID schemeID="0225"` (SIRET, annuaire Peppol) sur `SellerTradeParty`/`BuyerTradeParty` — absent avant, sans lien avec le problème ci-dessous mais alignement utile avec la structure que Super PDP produit lui-même.
- [x] **Le SIREN vendeur du XML doit correspondre exactement à l'entreprise réellement connectée en OAuth, sinon `POST /v1.beta/invoices` échoue avec un message trompeur.** Découverte le 31/08/2026 en tentant une vraie transmission pour Weber Tôlerie (SIREN 483125678, connecté en sandbox à l'entreprise préconfigurée "Tricatel", SIREN fictif `000000001`) : la soumission échouait systématiquement avec `"invalid B2C invoice for e-reporting: B2C invoice with legal registration identifier for buyer."`, un message qui ne pointe pas du tout vers la vraie cause. Diagnostic par élimination (BT-23 `S1`→`M1`, `GlobalID` Peppol, SIRET valide au sens Luhn, numéro de TVA acheteur — aucun de ces changements n'a résolu l'erreur) puis par comparaison différentielle : en repartant du XML de test que Super PDP génère lui-même (`generate_test_invoice`, accepté en `processing_rule=B2B`) et en y substituant progressivement les identités, seul le remplacement du SIREN vendeur par le vrai SIREN Weber (483125678, différent de Tricatel) a fait échouer la soumission — avec un message enfin explicite : `"L'entreprise (000000001) liée à cette session ne correspond pas au vendeur de la facture (483125678)."` En remettant le SIREN vendeur `000000001` (Tricatel) avec l'acheteur Deschamps inchangé, la soumission passe et `processing_rule=B2B`. **Conclusion : ce n'est pas un bug de `generateFacturXml()` — c'est un artefact du sandbox, où toute organisation cliente est connectée à la même entreprise fictive préconfigurée, dont le SIREN ne peut jamais correspondre au vrai SIREN de l'organisation qu'elle représente.** Ne se reproduira pas en production, où le SIREN OAuth connecté sera bien celui du client réel. Un artisan verra ce message trompeur uniquement si sa connexion Super PDP a été faite via un compte/environnement ne correspondant pas au SIREN réellement facturé (cas normalement impossible en production, à surveiller si observé malgré tout).

### Toujours ouvert

- [ ] Comportement du flux `authorization_code` pour un **SIREN client réel sans compte Super PDP préexistant** : les deux tests réalisés (25/08 OAuth, 29/08 émission/réception) ont authentifié la même entreprise déjà préconfigurée dans le bac à sable ("Tricatel"), donc ne tranchent pas la question pour un premier compte en production — création à la volée vs redirection vers un formulaire séparé (email/mot de passe/KYC). Impacte directement le parcours d'onboarding artisan.
- [ ] Déclenchement exact et scope du KYC à 2€HT : par SIREN client connecté, ou facturé globalement à Orsayn — impacte le pricing à présenter aux artisans.
- [ ] Équivalent de l'annuaire Peppol/vérification `in_dgfip_annuaire` et son délai de propagation.
- [ ] Support des avoirs (notes de crédit), si le besoin se présente.
- [ ] **Liste complète des `status_code`** : le seul observé jusqu'ici est `api:uploaded` (préfixe `api:`, pas `fr:` comme supposé initialement dans la doc — l'exemple `fr:212` du §7.4 vient des exemples officiels superpdp/examples et reste à confirmer, distinct du cycle `api:*` observé côté upload). Le test volontaire d'un `status_code: "fr:212"` a échoué avant même d'atteindre la validation du code (blocage "facture en cours de traitement") — à retester une fois ce délai écoulé.
- [ ] **Validation du XML produit par `generateFacturXml()`** via `/v1.beta/validation_reports` — tentée le 29/08/2026 sur une vraie facture de la DB de test (`invoices.id=a15a4298...`, statut `sent`, 1706,40 € TTC) : le XML se génère sans erreur (7417 octets, structure CII conforme visible en preview), mais le test a été interrompu par l'expiration du `refresh_token` utilisé (déjà consommé une fois lors de la vérification de rotation ci-dessus — comportement attendu, à usage unique). **La génération XML n'est donc pas en cause, seul l'appel de validation reste à rejouer** avec un cycle OAuth frais avant d'activer l'émission en production.

Chaque point restant doit être vérifié concrètement en sandbox avant d'écrire le code correspondant.
