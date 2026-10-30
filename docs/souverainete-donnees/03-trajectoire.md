# Trajectoire retenue

Dernière mise à jour : 2026-09-16 (bascule vers la mutualisation, voir en fin de document — la trajectoire du 2026-09-09 ci-dessous reste décrite intégralement pour la traçabilité de la décision qu'elle remplace).

## Décision (2026-09-16 — remplace celle du 2026-09-09)

Basculer l'offre setup 3k vers un **projet Supabase mutualisé** (une seule instance, N organisations clientes dedans, isolées par RLS) — c'est l'instance `atelier-app` déjà construite pour le self-service qui devient aussi le mode de livraison du setup 3k. Voir [DEPLOIEMENT_CLIENT.md](../../DEPLOIEMENT_CLIENT.md) (section « Instance mutualisée `atelier-app` ») pour le détail opérationnel, et « Ce qui a changé le 2026-09-16 » en fin de document pour ce qui a permis ce changement de décision.

La bascule self-hosted (phase 2 ci-dessous) reste la trajectoire de sortie de Supabase cloud, **indépendante** de ce choix mono-projet/multi-projet : un projet mutualisé se bascule vers un self-hosted exactement comme un projet dédié, le schéma et le code applicatif ne changent pas.

## Décision du 2026-09-09 (remplacée, conservée pour traçabilité)

Rester sur Supabase cloud pour l'amorçage commercial, avec le provisioning automatisé (couches A et B, voir [README](README.md)). Basculer vers un Supabase self-hosted sur un VPS opérateur dès que le cashflow le permet ou que 4 clients sont atteints : le premier des deux déclencheurs qui survient.

## Phase 1 : amorçage sur comptes Free (largement obsolète pour le setup 3k depuis la mutualisation du 2026-09-16)

Cette phase répondait à un problème que la mutualisation supprime pour l'essentiel : le quota de 2 projets Free par compte (voir [02-contraintes-supabase.md](02-contraintes-supabase.md)) ne contraint plus le nombre de **clients** setup 3k, puisqu'ils partagent tous le même projet `atelier-app` — il ne contraint plus que le nombre d'**instances** Supabase distinctes (test, cockpit, mutualisée), qui reste faible et stable. Le contenu ci-dessous reste pertinent pour un client qui exigerait explicitement une instance dédiée (hors mutualisée), cas qui devrait rester rare après le 2026-09-16.

**Contenu (contexte du 2026-09-09)** : 2 à 4 premiers clients, répartis sur une ou deux organisations Supabase Free (jamais plus, le quota est de 2 projets actifs par compte). Objectif : générer 6 à 12k€ de cashflow avant d'investir du temps dans l'infrastructure self-hosted.

**Pourquoi c'est défendable ici et ne le serait pas comme modèle permanent** : c'est un contournement des CGU Supabase (multiplier les comptes pour dépasser le quota par utilisateur), assumé consciemment, mais :
- borné à un petit nombre de clients et à une durée courte (jusqu'au premier déclencheur de la phase 2) ;
- adossé à une sortie déjà préparée et testée (couche A, voir plus bas), pas à une intention vague ;
- les seuls clients concernés sont des tests et des prospects à ce stade (2026-09-09), pas des comptes en production critique.

En modèle permanent à 20, 50 clients, ce même contournement deviendrait un risque opérationnel disproportionné : une suspension de compte tomberait sur des clients payants, pas sur un projet de test.

**Risques de la phase 1 et leur traitement** :

| Risque | Traitement |
|---|---|
| Pause à 7 jours d'inactivité rend un client indisponible | Cron keep-alive quotidien déjà en place (`workers/data-retention/`) : à vérifier explicitement actif sur chaque nouvelle instance dès son provisioning, sinon le problème se découvre par un appel client mécontent |
| Trousseau de comptes qui grandit (email, mot de passe, token Management par compte) | À centraliser dans un gestionnaire de secrets dès le premier compte, pas dans un fichier texte : sinon retrouver quelle base héberge quel client devient un problème après quelques mois |
| Suspension de compte par Supabase | Aucune parade technique : c'est le risque assumé de la phase 1, limité par sa durée et son échelle |

## Phase 2 : bascule vers un self-hosted

**Déclencheur** : cashflow suffisant pour absorber le coût d'un VPS et le temps de maintenance, ou 4 clients atteints (le quota Free devient alors structurellement insuffisant).

**Ce que ça change** : Supabase self-hosted (distribution Docker officielle) sur un VPS opérateur, plusieurs clients sur la même instance. Coût marginal par client supplémentaire proche de zéro (au-delà du dimensionnement du VPS), indépendance réelle vis-à-vis des CGU et de la tarification Supabase.

**Ce que ça n'élimine pas** : l'astreinte. Pas d'équipe dédiée à l'infrastructure pour l'instant : décision consciente d'assumer soi-même sauvegardes, mises à jour et disponibilité jusqu'à ce que le volume justifie une délégation. C'est un choix de "pas maintenant", pas un point aveugle.

**Procédure** : voir [04-runbook-bascule.md](04-runbook-bascule.md), écrite avant d'en avoir besoin.

## Ce qui a été écarté, et pourquoi (au 2026-09-09 — voir mise à jour ci-dessous)

- **Plan Pro Supabase comme solution structurelle.** Le coût marginal de compute par projet supplémentaire grandit avec chaque client, sans plafond connu (voir [02-contraintes-supabase.md](02-contraintes-supabase.md)) : préférable de viser directement l'indépendance plutôt que de payer pour un entre-deux dont le coût à l'échelle reste incertain. Toujours écarté au 2026-09-16, sans changement.
- ~~**Mutualisation immédiate (un seul projet Supabase pour tous les clients, isolés par RLS).** Les 168 policies RLS existantes en feraient un candidat technique sérieux (`docs/roadmap-saas-mutualise-2026-08.md` en pose déjà les bases), mais c'est un chantier de refonte architecturale plus lourd que ce que l'urgence actuelle justifie. Reste un cap à moyen terme, indépendant de la présente trajectoire.~~ **Réintégré comme décision retenue le 2026-09-16** (voir en tête de document et section dédiée ci-dessous) — conservé barré ici pour la traçabilité du raisonnement initial, qui reste valable dans l'absolu : c'est bien un chantier de refonte, il a juste été mené entre le 09 et le 16.
- **Migration complète hors Supabase (vers un autre fournisseur managé, sans self-host).** Les deux vrais verrous, RLS et GoTrue, demanderaient une réécriture de la couche d'accès aux données ou une réimplémentation de l'auth, pour un gain d'indépendance équivalent à celui du self-hosted mais sans le contrôle total. Le self-hosted est plus radical mais pas plus risqué, et il correspond mieux à l'objectif de souveraineté. Toujours écarté au 2026-09-16, sans changement — et sans rapport avec la décision mutualisation/per-client, qui est orthogonale à celle-ci.

## Ce qui a été préparé, indépendamment de la date de bascule

- **`scripts/apply-schema.mjs`** (couche A) : applique les 185 migrations contre n'importe quel Postgres, testé réellement contre un Postgres vierge en Docker (170/185 migrations passent, deux vrais bugs corrigés). C'est la même brique qui sert au provisioning quotidien sur Supabase cloud aujourd'hui et à la bascule vers un self-hosted demain : aucun travail à refaire au moment de la bascule. Reste valide en mutualisé : une seule instance à faire tourner sur ces migrations, pas N.
- **`scripts/provision-client.mjs`** (couche B) : spécifique à l'API Management Supabase cloud pour le provisioning **d'un nouveau projet**. En mutualisé, le provisioning d'un nouveau client setup 3k n'est plus « créer un projet Supabase » mais « créer une organisation dans le projet `atelier-app` existant » — ce script devient obsolète pour ce cas d'usage, mais reste pertinent pour les clients qui resteraient sur le modèle dédié le temps de la transition.

## Ce qui a changé le 2026-09-16

La mutualisation avait été écartée le 2026-09-09 pour une seule raison : c'était « un chantier de refonte architecturale plus lourd que ce que l'urgence actuelle justifie », pas un refus de principe — le document le disait déjà, « reste un cap à moyen terme ». Un audit de sécurité mené le 2026-09-16 (voir `/Users/useersm/.claude/plans/oui-on-audit-tout-compiled-music.md` pour le détail complet, et le sous-skill `auth-rls-access-control` du dossier `backend-orsayn` pour les patterns capitalisés) a :

1. Confirmé que le socle RLS était déjà solide (~70 tables, pattern `organization_id = get_user_org_id()`) — ce que ce document notait déjà comme un « candidat technique sérieux ».
2. Trouvé et corrigé deux RPC `SECURITY DEFINER` exploitables cross-tenant (`generate_invoice_number`, `generate_quote_number`) et une fuite d'information (`organization_write_access_allowed`), du même type que celles déjà corrigées le 2026-08-08.
3. Trouvé et supprimé une Edge Function (`whatsapp-webhook`) exposée sans vérification de signature — sans lien direct avec la mutualisation, mais une faille active sur `pyxnmohknxmbpbcuvudg` qu'il fallait fermer de toute façon.
4. Construit un socle de test d'isolation cross-tenant (`tests/isolation/`, 17 tests, prouvés rouges avant correctif puis verts après) et une CI qui les exécute sur chaque PR — **ce qui manquait le plus le 2026-09-09** : la mutualisation n'était pas praticable non pas parce que la RLS était faible, mais parce que rien ne prouvait qu'elle le resterait dans le temps.

Le chantier de refonte anticipé le 2026-09-09 s'est donc avéré être un audit + quatre correctifs ciblés + un socle de test, pas une réécriture architecturale. `atelier-app`, déjà construite pour le self-service, sert de base à la bascule — aucune nouvelle infrastructure à monter pour démarrer.

Pas de domaine personnalisé par client (décision du 2026-09-16, voir `DEPLOIEMENT_CLIENT.md`) : chaque organisation se connecte sur `app.atelier-btp.fr`, l'identité du client vit dans ses documents (logo, nom, SIRET déjà en base), pas dans l'URL. Clé OpenRouter par organisation construite le 2026-09-16 (`organization_ai_credentials`, voir `DEPLOIEMENT_CLIENT.md`). Reste non construit à ce jour : l'agent de migration des données client. Le rodage avec un vrai deuxième client payant sur `atelier-app` reste l'étape de validation avant généralisation à tout le parc setup 3k.
