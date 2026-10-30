# Souveraineté des données, indépendance vis-à-vis de Supabase

Dernière mise à jour : 2026-09-16.

## Le problème en trois lignes

Historiquement (jusqu'au 2026-09-09), chaque client Atelier tournait sur son propre projet Supabase Free (500 Mo, pause après 7 jours d'inactivité, compensée par un cron keep-alive), avec un quota Free de **2 projets actifs par compte** qui plafonnait le modèle. **Depuis le 2026-09-16, l'offre setup 3k est passée en mode mutualisé** (un seul projet Supabase, `atelier-app`, N organisations clientes dedans, isolées par RLS) : ce problème de quota par client disparaît, il ne reste qu'un quota par instance Supabase (test, cockpit, mutualisée), qui ne grandit plus avec le nombre de clients. Le sujet de ce dossier reste entier pour autant : Supabase cloud a ses propres limites (quotas de l'instance, tarification, dépendance) et la sortie vers un self-hosted reste une trajectoire indépendante de ce choix mono/multi-projet.

## La trajectoire à jour (2026-09-16)

1. **Mutualisation de l'offre setup 3k** : les nouveaux clients setup sont provisionnés comme une organisation dans le projet Supabase mutualisé `atelier-app`, pas dans un projet dédié. Détail opérationnel : [DEPLOIEMENT_CLIENT.md](../../DEPLOIEMENT_CLIENT.md) (section « Instance mutualisée `atelier-app` »). Ce choix avait été écarté le 2026-09-09 comme « chantier trop lourd pour l'urgence du moment » ; un audit de sécurité du 2026-09-16 a fermé la dette qui le bloquait (voir [03-trajectoire.md](03-trajectoire.md), section « Ce qui a changé le 2026-09-16 »).
2. **Bascule VPS (indépendante du choix ci-dessus)** : Supabase self-hosted sur un VPS opérateur reste la trajectoire de sortie complète de Supabase cloud, déclenchée par le cashflow ou par une limite de l'instance mutualisée elle-même (pas par un nombre de clients comme avant, puisqu'un seul projet les héberge tous). Indépendance réelle, coût marginal quasi nul par client supplémentaire, astreinte assumée en interne (pas d'équipe dédiée pour l'instant, décision consciente).

Détail complet, y compris la trajectoire du 2026-09-09 conservée pour traçabilité : [03-trajectoire.md](03-trajectoire.md).

## État d'avancement (2026-09-16)

| Brique | Statut |
|---|---|
| Audit de couplage à Supabase | Fait (2026-09-09) : [01-etat-des-lieux.md](01-etat-des-lieux.md) |
| Vérification des contraintes tarifaires réelles | Fait (2026-09-09) : [02-contraintes-supabase.md](02-contraintes-supabase.md) |
| Décision de trajectoire | Mise à jour (2026-09-16) : [03-trajectoire.md](03-trajectoire.md) — mutualisation retenue pour le setup 3k |
| Audit sécurité cross-tenant + correctifs (préalable à l'ouverture du mutualisé à des clients payants) | Fait (2026-09-16) : 2 RPC `SECURITY DEFINER` corrigées, 1 Edge Function non signée supprimée. Détail : sous-skill `auth-rls-access-control` du dossier `backend-orsayn` |
| Socle de test d'isolation cross-tenant + CI | Fait (2026-09-16) : `tests/isolation/`, 17 tests, CI sur chaque PR. Détail : sous-skill `multi-tenant-test-harness` du dossier `backend-orsayn` |
| Domaine personnalisé par client | **Écarté (2026-09-16)** : chaque client se connecte sur `app.atelier-btp.fr`, son identité vit dans ses documents (logo/nom/SIRET déjà en base), pas dans l'URL — voir `DEPLOIEMENT_CLIENT.md` |
| Clé OpenRouter par organisation (setup 3k) | Fait (2026-09-16) : table `organization_ai_credentials` chiffrée AES-256-GCM, RLS sans policy (accessible uniquement service_role), UI dans `/settings`. Voir `DEPLOIEMENT_CLIENT.md` |
| Agent de migration des données client (fichier client → écriture directe dans son organisation) | **Non construit** : voir `DEPLOIEMENT_CLIENT.md` |
| Rodage mutualisé avec un vrai deuxième client payant | **Reste à faire** avant généralisation à tout le parc setup 3k |
| Couche A : script portable d'application du schéma (`scripts/apply-schema.mjs`) | Fait et **testé réellement** contre un Postgres vierge en Docker (2026-09-09). 170 des 185 migrations passent une fois les prérequis plateforme posés. Deux vrais bugs de migration trouvés et corrigés à cette occasion. Reste valide en mutualisé : une seule instance à faire tourner sur ces migrations. |
| Couche B : script de provisioning Supabase cloud (`scripts/provision-client.mjs`) | Écrit (2026-09-09), **devient secondaire pour le setup 3k** depuis la mutualisation (provisionner un client = créer une organisation dans `atelier-app`, pas un nouveau projet) ; reste pertinent pour un client qui exigerait explicitement une instance dédiée. |
| Couche C : bascule vers un self-hosted | Runbook écrit, **jamais exécuté, aucun VPS cible existant** : voir [04-runbook-bascule.md](04-runbook-bascule.md). Trajectoire inchangée par la mutualisation (orthogonale). |

## Index des documents

- [01-etat-des-lieux.md](01-etat-des-lieux.md) : l'audit de couplage, ce que le code utilise réellement de Supabase, chiffré.
- [02-contraintes-supabase.md](02-contraintes-supabase.md) : les faits tarifaires vérifiés sur la documentation officielle, avec citations et liens.
- [03-trajectoire.md](03-trajectoire.md) : la décision retenue, ce qui a été écarté et pourquoi, les risques de la phase 1 et leur traitement.
- [04-runbook-bascule.md](04-runbook-bascule.md) : la procédure opérationnelle de bascule vers un self-hosted, écrite avant d'en avoir besoin.

## Pourquoi ce dossier existe

La bascule interviendra sur des clients en production, potentiellement plusieurs mois après sa rédaction. Sans trace écrite, l'audit serait refait, les contraintes tarifaires re-cherchées, et la procédure improvisée le jour où elle devient urgente. C'est exactement le scénario que ce dossier évite.
