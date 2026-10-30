# Scope — Cockpit Orsayn : orchestrateur opérateur, abonnements, quotas, modules et CRM

> Dernière mise à jour : mai 2026, mis à jour le 2026-09-16 : Starter retiré du catalogue commercial (plus vendu, ni sur le tunnel self-service ni en per-client), B2Brouter remplacé par Super PDP dans tout ce document (voir `docs/atelier-facturation-electronique.md` pour le détail complet du modèle Super PDP).
> Ce document décrit le cockpit Orsayn comme centre opérateur des instances client : abonnement, modules, quotas, configuration produit, intégrations, conformité, santé technique, consommation, CRM commercial et actions d'orchestration.

---

## 1. Objectif

Le cockpit `/orsayn` n'est pas seulement un tableau de quotas. C'est le poste de pilotage Orsayn pour toutes les instances client.

Il sert à :

- l'abonnement client : `setup_only`, `pro`, `expert`
- le MRR HT, la devise, l'état actif, l'essai, la configuration facturation électronique, notes et renouvellement
- les modules activés côté instance cliente
- la configuration facturation électronique : `off`, `export_only`, `super_pdp`, environnement sandbox/prod (OAuth 2.1 multi-tenant, voir `docs/atelier-facturation-electronique.md`)
- les quotas commerciaux mensuels
- le suivi consommation/coût IA par client (tableau de bord opérateur)
- le mode de facturation IA : `orsayn_shared` ou `client_owned`
- le mode de dépassement : `block`, `upgrade_prompt`, `charge`
- la gestion des périodes d'essai et leur expiration automatique
- les actions commerciales : emails de relance, propositions d'upgrade, incitations à la conversion
- la santé opérationnelle des instances : dernière synchro, erreurs config, webhooks, intégrations, crons, versions déployées
- la préparation conformité : facturation électronique, export comptable, réversibilité, statut des prérequis client
- les actions opérateur : appliquer une offre, activer un module, déclencher une synchro, lancer un test d'intégration, tracer une intervention

La V1 n'appelle jamais le cockpit en temps réel avant un appel IA ou une action de facturation. Chaque instance cliente applique une copie locale de `quota_config` et de `einvoicing_config` synchronisée depuis le cockpit.

Le cockpit devient l'orchestrateur opérateur : il décide ce qui est activé, pousse la configuration vers l'instance client, et trace les états d'onboarding. Les secrets restent dans Cloudflare côté instance client.

## 1.1 Vision cible

Le cockpit doit répondre à quatre questions opérateur :

1. **Quel client est dans quel état ?** Offre, modules, santé technique, conformité, derniers événements.
2. **Qu'est-ce qui est activé chez lui ?** Modules IA, WhatsApp, facturation électronique, exports, intégrations, options métier.
3. **Qu'est-ce que ça coûte et rapporte ?** MRR, coût IA/Twilio/infra, dépassements, marge, opportunités d'upgrade.
4. **Quelle action dois-je faire maintenant ?** Corriger une config, relancer un client, activer un module, tester Super PDP, traiter une erreur webhook, préparer une échéance légale.

La première implémentation couvre les quotas IA, les abonnements et la facturation électronique. Les prochains domaines doivent suivre le même modèle : source cockpit, copie locale client, synchro signée, journal d'événements.

Le cockpit n'est pas l'interface métier des artisans. Il ne liste pas les factures reçues, ne remplace pas les écrans Finances, et ne sert pas à traiter les factures fournisseur au quotidien. Ces écrans vivent dans l'app cliente quand le mode le justifie, par exemple `super_pdp` pour la réception 2026.

Le cockpit pilote l'état produit et commercial : activer une offre, upgrade/downgrade un client, lancer un essai, convertir ou suspendre un abonnement, changer un mode de dépassement, pousser une configuration vers l'app cliente, constater la santé de synchro et tracer les actions opérateur.

## 1.2 Domaines orchestrés

| Domaine | Source cockpit | Copie locale client | Action cockpit |
|---|---|---|---|
| Abonnement | Tier, MRR, essai, statut actif | Modules + quotas appliqués | Appliquer offre, convertir essai |
| Modules IA | Activation par module | `organization_modules.modules` | Activer/désactiver |
| Quotas | Limites commerciales | `quota_config` | Réinitialiser période, changer overflow |
| WhatsApp | Activation agent, quotas, proactif | Modules + secrets Worker | Activer, surveiller usage |
| Facturation électronique | Mode, fournisseur, env, account id | `organization_einvoicing_config` | Passer export/Super PDP, tester sandbox, suivre onboarding |
| Export comptable | Disponibilité, prérequis org | Réglages organisation | Vérifier prérequis |
| Conformité/RGPD | DPA, réversibilité, suppression | Etats et logs client | Lancer export, tracer demande |
| Santé technique | Dernière synchro, erreurs, crons | Events remontés | Relancer sync, diagnostiquer |
| CRM commercial | Relances, emails, notes | Aucun ou historique minimal | Envoyer email, noter appel |

## 1.3 Suite de scope cockpit

La suite logique n'est pas une page Super PDP. C'est de rendre le cockpit vraiment opérable au quotidien :

| Phase | Scope | Résultat attendu |
|---|---|---|
| 1 | Abonnements | Boutons upgrade/downgrade, changement de MRR, renouvellement, pause/réactivation |
| 2 | Essais | Activer essai Pro 7j, convertir, expirer, relancer J-4/J-2/J+14 |
| 3 | Journal opérateur | Tracer chaque action : tier changé, config poussée, email envoyé, erreur sync |
| 4 | CRM commercial | Brouillons Resend, relances suggérées, historique par client |
| 5 | Quotas | Alertes, overflow `block`/`upgrade_prompt`/`charge`, ajustement ponctuel |
| 6 | Facturation électronique | Mode `off`/`export_only`/`super_pdp`, statut annuaire, tests sandbox, santé OAuth |
| 7 | Santé technique | Dernière config-sync, version déployée, erreurs cron/webhook, actions de resync |

Chaque phase doit rester pilotée depuis le cockpit et appliquée dans l'app cliente via config locale. L'app cliente reçoit les modules, quotas et modes, puis affiche ses propres écrans métier selon cette configuration.

---

## 2. Catalogue canonique

La source unique côté code est `src/lib/quota-catalog.ts`.

### Tiers

```ts
setup_only | pro | expert
```

### Modules produit

```ts
relances_ai
weekly_summary
quote_ai
planning_ai
chantier_assistant
suggest_tasks
catalog_ai
document_import_ai
chantier_report_ai
labor_estimate_ai
receipt_ocr
voice_input
whatsapp_agent
whatsapp_ocr
whatsapp_proactive
```

### Configuration produit hors IA

Ces réglages ne sont pas des quotas IA. Ils sont synchronisés par le cockpit mais appliqués par des modules métier dédiés.

```ts
einvoicing_mode: 'off' | 'export_only' | 'super_pdp'
```

Le modèle Super PDP (OAuth 2.1 multi-tenant) remplace B2Brouter/`edoc_exchange` : il n'y a plus de création manuelle de compte par client dans une UI tierce, ni d'`account_id`/`onboarding_model`/`provider` à pousser depuis le cockpit — l'artisan autorise lui-même la connexion depuis son instance Atelier. Détail complet, colonnes réelles et migration de bascule : `docs/atelier-facturation-electronique.md`.

### Quotas commerciaux

| Quota | Unité | Module requis |
|---|---|---|
| `relances_ai` | call | `relances_ai` |
| `weekly_summary` | call | `weekly_summary` |
| `quote_ai` | call | `quote_ai` |
| `planning_ai` | call | `planning_ai` |
| `chantier_assistant` | call | `chantier_assistant` |
| `suggest_tasks` | call | `suggest_tasks` |
| `catalog_ai` | call | `catalog_ai` |
| `document_import_ai` | document | `document_import_ai` |
| `chantier_report_ai` | call | `chantier_report_ai` |
| `labor_estimate_ai` | call | `labor_estimate_ai` |
| `receipt_ocr` | document | `receipt_ocr` |
| `voice_input` | minute | `voice_input` |
| `wa_messages` | message | `whatsapp_agent` |
| `wa_vocal_minutes` | minute | `whatsapp_agent` |
| `wa_proactive_messages` | message | `whatsapp_proactive` |
| `whatsapp_ocr` | document | `whatsapp_ocr` |

### Mapping technique → commercial

| Feature technique (`usage_logs.feature`) | Quota cockpit |
|---|---|
| `quote_analysis` | `quote_ai` |
| `reminder_draft`, `auto_reminder_draft` | `relances_ai` |
| `weekly_summary` | `weekly_summary` |
| `planning_ai` | `planning_ai` |
| `task_suggestion` | `suggest_tasks` |
| `chantier_assistant` | `chantier_assistant` |
| `catalog_extract` | `catalog_ai` |
| `document_parse` | `document_import_ai` |
| `receipt_ocr` | `receipt_ocr` |
| `labor_estimate` | `labor_estimate_ai` |
| `chantier_report_summary` | `chantier_report_ai` |
| `voice_transcription` | `voice_input` |
| `whatsapp_reply` | `wa_messages` |
| `whatsapp_transcription` | `wa_vocal_minutes` |
| `whatsapp_proactive` | `wa_proactive_messages` |
| `whatsapp_document_ocr` | `whatsapp_ocr` |

---

## 3. Quotas par tier

`-1` signifie illimité.

Ces valeurs datent de mai 2026 (avant le durcissement des quotas et l'abandon de WhatsApp) — les valeurs réelles à jour sont dans `src/lib/quota-catalog.ts` (`QUOTAS_BY_TIER`), source unique de vérité.

| Quota | setup_only | pro | expert |
|---|---:|---:|---:|
| `relances_ai` | 0 | 40 | -1 |
| `weekly_summary` | 0 | 8 | -1 |
| `quote_ai` | 0 | 40 | -1 |
| `planning_ai` | 0 | -1 | -1 |
| `chantier_assistant` | 0 | 60 | -1 |
| `suggest_tasks` | 0 | 40 | -1 |
| `catalog_ai` | 0 | 30 | -1 |
| `document_import_ai` | 0 | 30 | -1 |
| `chantier_report_ai` | 0 | -1 | -1 |
| `labor_estimate_ai` | 0 | -1 | -1 |
| `receipt_ocr` | 0 | -1 | -1 |
| `voice_input` | 0 | 60 | -1 |
| `wa_messages` | 0 | 0 | 0 |
| `wa_vocal_minutes` | 0 | 0 | 0 |
| `wa_proactive_messages` | 0 | 0 | 0 |
| `whatsapp_ocr` | 0 | 0 | 0 |

WhatsApp (`wa_*`) est abandonné (2026-09-16) : quotas à 0 sur tous les tiers, voir `DEPLOIEMENT_CLIENT.md`.

---

## 4. Données opérateur

Migration : `supabase/operator-migrations/003_operator_subscriptions_quotas.sql`.

Extension actions cockpit : `supabase/operator-migrations/005_operator_cockpit_actions.sql`.

### `operator_client_subscriptions`

Source de vérité pour tier/MRR/statut :

- `source_instance`
- `tier`
- `ai_billing_mode` : `orsayn_shared` si Orsayn porte le coût OpenRouter/Mistral, `client_owned` si le client utilise sa propre clé
- `mrr_ht`
- `billing_currency`
- `is_active`
- `started_at`, `renews_at`
- `trial_tier`, `trial_ends_at`, `trial_converted`
- `einvoicing_mode`
- `einvoicing_environment`
- `oauth_status`, `oauth_connected_at`, `super_pdp_connection_id`
- `einvoicing_annuaire_status`
- `overflow_mode`
- `notes`

`operator_client_settings` conserve les infos de compatibilité cockpit : label, `app_url`, état de dernière synchro config.

Colonnes historiques retirées par `supabase/operator-migrations/014_super_pdp_einvoicing_config.sql` : `b2brouter_active`, `b2brouter_account_id`, `einvoicing_onboarding_model`, `einvoicing_provider` — concepts propres à B2Brouter, sans équivalent Super PDP (OAuth 2.1, pas d'`account_id` ni de `provider` à stocker). Détail : `docs/atelier-facturation-electronique.md`.

### `operator_client_events`

Journal générique des actions opérateur :

- `source_instance`
- `event_category` : `subscription`, `trial`, `config_sync`, `einvoicing`, `module`, `crm`, `note`
- `event_type` : `subscription_updated`, `trial_started`, `trial_converted`, `trial_ended`, `config_resync_requested`, etc.
- `actor_email`
- `metadata`
- `notes`
- `created_at`

Ce journal permet de comprendre qui a modifié quoi dans le cockpit avant d'automatiser les emails et les crons commerciaux.

### Coût IA porté vs usage indicatif

Le cockpit conserve toujours la consommation IA par client, même quand la clé OpenRouter appartient au client. La différence se fait dans l'interprétation commerciale :

| `ai_billing_mode` | Qui paie OpenRouter/Mistral ? | Usage visible cockpit | Impact marge Orsayn |
|---|---|---|---|
| `orsayn_shared` | Orsayn | Oui | Le coût IA est soustrait de la marge |
| `client_owned` | Client | Oui | Le coût IA reste indicatif pour pricing, mais n'est pas soustrait de la marge |

Cette séparation permet de voir les features qui consomment le plus, d'ajuster les prix et de proposer des upgrades sans fausser la marge réelle.

### `operator_client_quotas`

Une ligne par `(source_instance, quota_feature, period_start)`.

- `quota_unit`
- `quota_monthly`
- `current_quantity`
- `current_cost_eur`
- `period_start`

Le renouvellement mensuel crée une nouvelle période. On ne remet pas à zéro les anciennes lignes.

### `operator_quota_usage_events`

Ledger idempotent par `(source_instance, local_usage_log_id, quota_feature)`.

La RPC `increment_quota_counter(...)` insère d'abord dans ce ledger. Si l'event existe déjà, elle retourne `false` et ne modifie pas `operator_client_quotas`.

---

## 5. Données client

Migration : `supabase/migrations/083_organization_quota_config.sql`.

Ajouts sur `organization_modules` :

- `quota_config jsonb`
- `overflow_mode`
- `quota_synced_at`

Nouvelle config locale de facturation électronique (colonnes réelles depuis la bascule Super PDP, `supabase/migrations/173_super_pdp_einvoicing_config.sql`) :

- `organization_einvoicing_config.mode` (`off` | `export_only` | `super_pdp`)
- `organization_einvoicing_config.environment`
- `organization_einvoicing_config.oauth_status`, `.oauth_connected_at`, `.super_pdp_connection_id`
- `organization_einvoicing_config.annuaire_status`

Ajouts sur `usage_logs` :

- `quota_feature`
- `quota_unit`
- `quota_quantity`
- `overflow_mode`
- `over_quota`

Index local : `(organization_id, quota_feature, created_at)`.

---

## 6. Config sync

Endpoint client : `POST /api/operator/config-sync`.

Sécurité :

- signature HMAC `x-operator-signature`
- secret `OPERATOR_CONFIG_SYNC_SECRET`
- fallback autorisé : `OPERATOR_INGEST_SECRET`

Payload (illustratif — voir `docs/atelier-facturation-electronique.md` pour le payload exact à jour) :

```json
{
  "source_instance": "atelier-client",
  "organization_id": "uuid",
  "modules": { "quote_ai": true },
  "quota_config": { "quote_ai": 40 },
  "overflow_mode": "block",
  "einvoicing_config": {
    "mode": "export_only",
    "environment": "sandbox",
    "annuaire_status": "not_started"
  }
}
```

Le cockpit appelle cet endpoint lors de “Appliquer tier” ou “Appliquer facturation électronique”. Si `app_url` ou `organization_id` manque, la subscription est enregistrée mais la synchro reste `pending_manual`.

Règles :
- `export_only` est le défaut pour les clients préparés mais non encore connectés à Super PDP.
- `super_pdp` s'active par le flux OAuth 2.1 déclenché par l'artisan lui-même depuis son instance — pas par une configuration manuelle du cockpit vers un `account_id` pré-existant (différence structurante avec l'ancien modèle B2Brouter).
- Le cockpit ne pousse jamais `SUPER_PDP_CLIENT_SECRET` ni `SUPER_PDP_ENCRYPTION_KEY` (restent uniquement dans `.env.cockpit`).

---

## 7. Enforcement local

### App Next

`callAI()` vérifie :

1. module actif
2. quota local via `checkQuota()`
3. rate-limit horaire existant
4. appel provider

Si `overflow_mode = block` et quota atteint : `AIQuotaExceededError`, provider non appelé.

Si `upgrade_prompt` ou `charge` : provider appelé, log marqué `over_quota = true`.

### WhatsApp

Le webhook Supabase applique le même principe local :

- `whatsapp_reply` consomme `wa_messages`
- `whatsapp_transcription` consomme `wa_vocal_minutes`
- V1 compte un vocal comme `1` minute si la durée exacte n'est pas disponible

En `block`, l'artisan reçoit un message WhatsApp indiquant que le quota mensuel est atteint.

---

## 8. Cockpit UI

Dans `/orsayn`, chaque client affiche :

- tier courant
- MRR HT
- devise
- URL app client
- mode overflow
- renouvellement
- essai Pro 7 jours
- mode facturation électronique (`off`, `export_only`, `super_pdp`)
- notes
- statut de dernière synchro config
- quotas du mois courant avec quantité, limite, coût et badge visuel

Seuils badge :

| Situation | Badge |
|---|---|
| < 70% | vert |
| ≥ 70% | jaune |
| ≥ 90% | orange |
| dépassement | rouge |
| illimité | neutre |

---

## 9. Tableau de bord IA — vue globale opérateur

Cette vue est la page d'accueil du cockpit. Elle donne une lecture immédiate de l'état commercial et de la santé technique de tous les clients.

### 9.1 KPIs agrégés (en-tête du dashboard)

```
MRR total HT      : 1 247€       Clients actifs : 14
Coût IA ce mois   : 38,20€       Marge brute IA  : 96,9%
Clients en essai  : 2            Expirent dans 7j : 1
Clients > 90% quota : 3          Clients bloqués  : 1
```

### 9.2 Bloc "Conso IA & pricing"

Le cockpit doit distinguer trois lectures :

| Lecture | Source | But |
|---|---|---|
| Coût IA porté | `operator_usage_events` + `ai_billing_mode = 'orsayn_shared'` | Calculer la marge réelle Orsayn |
| Usage IA indicatif | Tous les events, y compris `client_owned` | Comprendre les vrais usages et ajuster le pricing |
| Signal upgrade | Quotas, coût indicatif, fréquence d'appel, tier | Proposer Pro → Expert ou sur-mesure |

Vue V1 :

- top features coûteuses du mois
- top modèles coûteux du mois
- clients à usage élevé avec badge `Cle Orsayn` / `Cle client`
- affichage séparé "coût porté" vs "usage indicatif"

Cette vue sert à répondre à : "Qui consomme le plus ?", "Quelle feature coûte vraiment ?", "Quel modèle tire les coûts ?", "Quel client devrait changer de tier ?".

### 9.3 Tableau clients — colonnes

| Colonne | Description |
|---------|-------------|
| Client | Nom + URL app |
| Tier | Badge coloré (setup_only / pro / expert) |
| MRR | Montant HT + statut (actif / essai / expiré) |
| Essai | Badge "J-X" si `trial_ends_at` dans le futur, "Expiré" sinon |
| Quota max | Feature la plus consommée ce mois (% + badge couleur) |
| Coût mois | Coût réellement porté par Orsayn ; usage indicatif affiché à part si clé client |
| Marge | MRR / coût |
| Actions | Boutons contextuels (voir section 10) |

### 9.4 Vue drill-down par client

Clic sur un client → fiche détaillée avec :

- Infos abonnement (tier, MRR, overflow, mode facturation électronique, renouvellement, essai)
- Tableau quotas par feature : quantité / limite / % / coût / badge
- Décomposition du coût : OpenRouter + Twilio + Supabase/CF
- Historique des emails commerciaux envoyés (section 11)
- Boutons d'action (section 10)

---

## 10. Gestion des périodes d'essai

### 10.1 Principe

L'essai porte uniquement sur le MRR — pas sur le setup. Le client paie le setup au tarif normal, et bénéficie de 7 jours à tier Pro sans engagement MRR et sans carte bancaire. Il n'existe pas d'autre essai gratuit (pas d'essai Expert). Si non-converti à l'expiration, les modules IA sont désactivés depuis le cockpit sans toucher au code.

### 10.2 Modèle de données

Sur `operator_client_subscriptions` :

- `trial_tier` : tier actif pendant l'essai (toujours `pro`)
- `trial_ends_at` : timestamp d'expiration de l'essai, `null` si pas d'essai
- `trial_converted` : `boolean` — converti après essai ou non

### 10.3 Activation d'un essai depuis le cockpit

Bouton "Activer 7 jours Pro" sur la fiche client :

1. `trial_tier = 'pro'`, `trial_ends_at = now() + interval '7 days'`
2. Appel config-sync vers l'instance cliente — modules Pro activés
3. Quotas copiés depuis le tier Pro dans `operator_client_quotas`
4. Note automatique ajoutée : "Essai Pro activé le [date]"
5. Email de bienvenue envoyé au client via Resend (template `trial-start`)

### 10.4 Expiration automatique — cron cockpit

Cron quotidien `cockpit/crons/trial-expiry-check` (ex. 2h du matin) :

```ts
// Pseudo-logique
const expiredTrials = await db
  .from('operator_client_subscriptions')
  .select('*')
  .lt('trial_ends_at', new Date())
  .eq('trial_converted', false)
  .not('trial_ends_at', 'is', null)

for (const client of expiredTrials) {
  // 1. Désactiver les modules IA côté instance
  await configSync(client, { tier: 'setup_only', modules: allFalse, quota_config: allZero })
  // 2. Mettre à jour le cockpit
  await db.update('operator_client_subscriptions').set({ tier: 'setup_only', trial_ends_at: null })
  // 3. Email de relance commerciale
  await sendEmail(client, 'trial-expired')
}
```

### 10.5 Conversion d'un essai

Bouton "Marquer comme converti" sur la fiche client, ou sélection du tier MRR cible :

1. `trial_converted = true`, `trial_ends_at = null`
2. `tier` mis à jour vers le tier choisi
3. Config-sync avec les quotas du tier choisi
4. Email de confirmation envoyé (template `subscription-activated`)

### 10.6 Alertes cockpit liées aux essais

| Condition | Signal | Action suggérée |
|-----------|--------|----------------|
| Essai expire dans 7 jours | Badge orange sur la fiche | Envoyer email de relance J-7 |
| Essai expire dans 2 jours | Badge rouge + notification | Appel ou email urgent |
| Essai expiré sans conversion | Badge gris "Expiré" | Relancer dans les 48h |
| Client en essai utilise > 70% quota | Signal proactif | Conversion plus probable — contacter |

---

## 11. CRM commercial — emails et relances

### 11.1 Principe

Le cockpit centralise tous les envois commerciaux vers les clients. Pas d'automatisation aveugle : chaque email est déclenché par une action cockpit (bouton ou cron avec confirmation), et tracé dans `operator_commercial_events`.

### 11.2 Modèle de données — `operator_commercial_events`

```sql
CREATE TABLE operator_commercial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance text NOT NULL,
  event_type text NOT NULL,         -- 'trial_start' | 'trial_expiry_7d' | 'trial_expiry_2d'
                                    -- | 'trial_expired' | 'upgrade_prompt' | 'quota_alert'
                                    -- | 'subscription_activated' | 'manual_email'
  tier_context text,                -- tier au moment de l'envoi
  sent_at timestamptz DEFAULT now(),
  sent_by text,                     -- 'cron' | 'operator_manual'
  email_template text,              -- nom du template Resend
  subject_preview text,
  notes text                        -- note manuelle opérateur si applicable
);

CREATE INDEX ON operator_commercial_events (source_instance, event_type, sent_at);
```

### 11.3 Templates d'emails commerciaux

Tous les templates sont gérés via Resend depuis le cockpit. Chaque template est personnalisable avec les variables de la fiche client.

| Template | Déclencheur | Contenu |
|----------|-------------|---------|
| `trial-start` | Activation essai | Bienvenue + ce qui est activé + durée + lien app |
| `trial-expiry-7d` | J-7 avant fin essai | Rappel valeur utilisée ce mois + bouton "Je continue en Pro/Expert" |
| `trial-expiry-2d` | J-2 avant fin essai | Derniers jours + offre de transition + contact direct |
| `trial-expired` | Expiration sans conversion | "Votre accès IA a été mis en pause" + relance avec témoignage |
| `trial-expired-14d` | 14 jours après expiration sans conversion | Relance tardive — "retour d'expérience ?" + offre de réactivation |
| `upgrade-prompt-quota` | Client > 90% quota | "Vous approchez de votre limite" + comparaison tier sup + bouton upgrade |
| `upgrade-prompt-wa` | WA > 80% quota sur Pro | "Vous utilisez intensément l'agent" + pitch Expert |
| `subscription-activated` | Conversion MRR | Confirmation abonnement + récap quotas + lien settings |
| `manual-email` | Bouton "Email client" | Corps libre, context pré-rempli (tier, usage, nom) |

### 11.4 Flux de relance automatique — essais

```
J0  : Essai activé → email trial-start
J23 : (J-7)  → email trial-expiry-7d                    [cron]
J28 : (J-2)  → email trial-expiry-2d                    [cron]
J30 : Expiration → désactivation modules + email trial-expired  [cron]
J44 : (J+14 post-expiration sans conversion) → email trial-expired-14d  [cron]
```

Le cron vérifie une fois par jour. Les emails ne sont pas renvoyés si `operator_commercial_events` contient déjà un event du même type pour le même client dans la fenêtre attendue (idempotence).

### 11.5 Flux de relance automatique — quotas

Le cron de vérification quota (existant, section 8.5) alimente aussi les emails :

| Seuil | Email envoyé | Cooldown |
|-------|-------------|---------|
| Feature > 90% quota, tier Pro | `upgrade-prompt-quota` | 7 jours |
| WA messages > 80% quota, tier Pro | `upgrade-prompt-wa` | 7 jours |
| Feature dépassée, overflow `upgrade_prompt` | `upgrade-prompt-quota` | 3 jours |

### 11.6 Interface cockpit — onglet "Emails & Relances"

Sur la fiche client, un onglet liste :

```
Historique des emails commerciaux
──────────────────────────────────────────────────────────────
15/05/2026  trial-start          Envoyé (cron)
22/05/2026  trial-expiry-7d      Envoyé (cron)
27/05/2026  trial-expiry-2d      Envoyé (cron)
──────────────────────────────────────────────────────────────
[Envoyer manuellement ▼]
  trial-expired-14d
  upgrade-prompt-quota
  manual-email
```

Depuis le cockpit global, vue "Relances à faire" :

```
Relances suggérées aujourd'hui
──────────────────────────────────────────────────────────────
Weber Tôlerie    — Essai expire dans 2 jours   [Envoyer J-2]
Batignac SARL    — Essai expiré il y a 14 jours [Envoyer relance]
Dupré Menuiserie — WA à 87% quota Pro           [Envoyer upgrade-wa]
──────────────────────────────────────────────────────────────
```

### 11.7 V1 implémentée — actions commerciales depuis les signaux

Le bloc "Conso IA & pricing" propose déjà une action opérateur sur les clients à usage élevé :

- **Tracer** : insère une ligne `operator_commercial_events` sans envoyer d'email.
- **Envoyer** : envoie un email via Resend si `RESEND_API_KEY` et `RESEND_FROM_ADDRESS` sont configurés sur le Worker cockpit, puis trace l'action.

Chaque action crée aussi un event dans `operator_client_events` pour garder une timeline opérateur unifiée.

La V1 utilise des templates simples :

| Signal | `event_type` | Template |
|---|---|---|
| Usage IA élevé / quota | `upgrade_prompt_quota` | `upgrade-prompt-quota` |
| Usage WhatsApp élevé | `upgrade_prompt_wa` | `upgrade-prompt-wa` |

Le champ `metadata.delivery_status` indique `draft`, `sent`, `failed` ou `skipped`.

### 11.8 Recommandations typées

La V1 qualifie les signaux avant action :

| Recommandation | Condition | Action suggérée |
|---|---|---|
| WhatsApp proche limite Pro | Client Pro avec `wa_messages` ≥ 80% | `upgrade_prompt_wa` vers Expert |
| Quota proche limite | Feature ≥ 90% et tier non Expert | `upgrade_prompt_quota` vers tier supérieur |
| Marge à surveiller | `ai_billing_mode = 'orsayn_shared'` et marge < 85% | Conversation tarifaire / tier supérieur |
| Usage client-owned élevé | `client_owned` avec usage indicatif élevé | Signal pricing sans impact marge |
| Usage IA actif | Usage régulier mais sans alerte critique | Opportunité commerciale douce |

Chaque recommandation reçoit une sévérité `high`, `medium` ou `low`, puis peut être tracée ou envoyée depuis le cockpit.

---

## 12. Tests attendus

- mapping technique → quota commercial
- complétude des quotas par tier
- normalisation de tous les modules produit
- comportement `block`, `upgrade_prompt`, `charge`
- duplicate ingest avec même `local_usage_log_id` ne double pas le compteur
- event `error` ne consomme pas de quota
- config-sync refuse une signature invalide
- config-sync met à jour `organization_modules` avec une signature valide
- cron expiration essai : désactive les modules et envoie `trial-expired` une seule fois
- cron relance quota : ne renvoie pas si email déjà envoyé dans la fenêtre de cooldown
- `operator_commercial_events` est idempotent — doublon de cron ne génère pas deux emails
- conversion d'essai : `trial_converted = true` + config-sync tier choisi + email `subscription-activated`
