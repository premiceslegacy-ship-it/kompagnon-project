# Runbook de bascule vers Supabase self-hosted

Dernière mise à jour : 2026-09-09.

**Statut : rédigé à partir d'un test partiel réel, jamais exécuté de bout en bout. Aucun VPS cible n'existe à ce jour.** Les sections marquées « testé » ont été vérifiées en conditions réelles le 2026-09-09 contre un Postgres vierge en Docker. Les sections marquées « non testé » sont une intention documentée, à valider avant tout usage sur un client réel.

## Avant de commencer

**La trajectoire a évolué vers la mutualisation le 2026-09-16** (voir [03-trajectoire.md](03-trajectoire.md)) : l'essentiel du parc setup 3k vit désormais dans un seul projet Supabase (`atelier-app`), pas dans N projets dédiés. Cette procédure reste écrite « par client/par projet » parce qu'elle a été rédigée avant ce changement et n'a pas encore été retestée dans le nouveau contexte ; dans le cas mutualisé, l'étape 3/4 (export/import) devient un export/import **par organisation** au sein du même projet source, pas par projet Supabase entier — à adapter au premier essai réel plutôt qu'à deviner ici sans l'avoir vérifié.

Prérequis qui doivent être vrais avant de commencer sur un client en production :
- Le VPS self-hosted tourne déjà la stack Supabase complète (Docker Compose officiel), testée avec au moins un client de test de bout en bout : pas directement avec un premier client réel.
- Les sauvegardes automatiques et le monitoring du VPS sont en place *avant* d'y accueillir des données de production. Un self-hosted sans sauvegarde n'est pas une amélioration par rapport à Supabase cloud, c'est une régression.
- Une fenêtre de maintenance a été communiquée au client si la bascule implique une interruption de service (probable, voir plus bas).

## 1. Prérequis VPS et dimensionnement

**Non testé.** Un ordre de grandeur à valider avant la première bascule réelle :

- Distribution Docker officielle Supabase self-hosted (Postgres + PostgREST + GoTrue + Storage + Realtime, même si Realtime n'est pas utilisé par l'app : voir [01-etat-des-lieux.md](01-etat-des-lieux.md)).
- Dimensionnement : dépend du nombre de clients hébergés sur le même VPS. Pour quelques clients (échelle de la phase 2 de [03-trajectoire.md](03-trajectoire.md)), un VPS de la gamme 4 vCPU / 8 Go RAM est un point de départ raisonnable, à ajuster avec de la mesure réelle une fois en place : pas une valeur vérifiée par un test de charge.
- Un client = soit une base Postgres dédiée sur le même cluster, soit un schéma isolé dans une base partagée. Le choix a un impact sur l'isolation (RLS reste nécessaire dans les deux cas, c'est elle qui protège entre organisations) et sur la simplicité des sauvegardes par client. Non tranché à ce jour.

## 2. Appliquer le schéma (testé)

C'est l'étape validée réellement. `scripts/apply-schema.mjs` (couche A) applique les 185 migrations contre l'URL de connexion Postgres du VPS self-hosted, exactement comme il le fait contre Supabase cloud aujourd'hui :

```bash
node scripts/apply-schema.mjs --db-url "postgresql://postgres:<motdepasse>@<host-vps>:5432/postgres"
```

**Prérequis plateforme à poser avant de lancer le script**, découverts en testant contre un Postgres nu (voir [01-etat-des-lieux.md](01-etat-des-lieux.md) pour le détail) :
- schémas `extensions` et `auth` ;
- une table `auth.users` (fournie nativement par GoTrue sur une vraie stack self-hosted : sur un Postgres nu de test, un stub minimal suffit) ;
- les fonctions `auth.uid()` / `auth.role()` (fournies nativement par GoTrue) ;
- les rôles Postgres `anon`, `authenticated`, `service_role` (fournis nativement par la stack Supabase self-hosted).

Sur la distribution Docker officielle Supabase self-hosted, ces quatre prérequis sont déjà en place : ils n'ont dû être stubés à la main que parce que le test du 2026-09-09 utilisait un Postgres nu sans le reste de la stack, pour isoler la validation du schéma applicatif. **Sur un vrai VPS self-hosted, il ne devrait rester qu'à lancer la commande ci-dessus.** Cette hypothèse elle-même n'a pas encore été vérifiée contre une vraie stack self-hosted : à faire au premier essai réel.

Au-delà de la migration 170, un vrai service Storage est nécessaire (fonctions comme `storage.foldername()`) : fourni nativement par la stack self-hosted, jamais un problème en dehors d'un test isolé comme celui du 2026-09-09.

## 3. Exporter les données du client (non testé)

Pour chaque table avec des données (79 tables au total, voir [01-etat-des-lieux.md](01-etat-des-lieux.md)) :

```bash
pg_dump --data-only --no-owner --no-privileges \
  "postgresql://postgres:<motdepasse>@db.<ref>.supabase.co:5432/postgres" \
  > client-export.sql
```

Points de vigilance non vérifiés :
- L'ordre d'insertion doit respecter les FK (`pg_dump --data-only` gère normalement cet ordre automatiquement en triant par dépendances, mais les FK circulaires connues du schéma, ex. `quotes.invoice_id` / `invoices.quote_id` (voir la correction de la migration 004), méritent une vérification explicite).
- Les 3 buckets Storage (`logos`, `chantier-photos`, `quote-attachments`) ne sont **pas** couverts par `pg_dump` : les fichiers eux-mêmes doivent être copiés séparément (l'API Storage de Supabase permet de lister et télécharger les objets d'un bucket).
- Taille des données : à mesurer avant l'export sur le client concerné, pour estimer la durée de la fenêtre de maintenance.

## 4. Importer sur le VPS self-hosted (non testé)

```bash
psql "postgresql://postgres:<motdepasse>@<host-vps>:5432/postgres" < client-export.sql
```

À faire une fois le schéma déjà en place (étape 2). Vérifier après import que les compteurs de séquences (numérotation auto des devis/factures, gérée par trigger selon l'audit initial) repartent bien après le dernier numéro importé, pas de zéro.

## 5. Bascule des variables d'environnement Cloudflare (non testé)

Le déploiement applicatif reste sur Cloudflare Workers (voir [01-etat-des-lieux.md](01-etat-des-lieux.md), « le compute est déjà ailleurs ») : seule la base change. Mettre à jour, pour le Worker du client concerné :

- `SUPABASE_URL` → l'URL du VPS self-hosted (ou de son reverse proxy avec certificat TLS valide : nécessaire, `supabase-js` s'attend à du HTTPS).
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` → les clés générées par la stack self-hosted pour ce client/schéma (mécanisme de génération à documenter au premier essai réel, diffère du flow API Management de Supabase cloud utilisé par `scripts/provision-client.mjs`).

`scripts/prepare-cloudflare-env.mjs` (`npm run cf:env`) gère déjà l'injection de variables Cloudflare pour le flow actuel : à vérifier s'il est directement réutilisable ou s'il faut l'adapter pour ce nouveau cas.

## 6. Vérification

Avant de considérer la bascule terminée pour ce client :
- Connexion à l'app avec un compte existant du client (pas un compte de test) : authentification, lecture d'une fiche client, d'un devis.
- Écriture : créer puis supprimer un enregistrement de test, confirmer qu'il atterrit bien sur le VPS et pas sur l'ancien projet Supabase cloud.
- RLS : confirmer qu'un autre client (si mutualisé sur le même VPS) ne peut pas voir les données de celui qu'on vient de basculer.
- Cron : les 4 workers cron (`embeddings`, `auto-reminder`, `data-retention`, `operator-cron`) doivent pointer vers la nouvelle base pour ce client.

## 7. Rollback

Non testé. Le principe : tant que l'ancien projet Supabase cloud n'a pas été supprimé, revenir en arrière consiste à annuler l'étape 5 (remettre les anciennes variables d'environnement Cloudflare). Ne pas supprimer le projet Supabase cloud d'origine avant d'avoir confirmé, sur une période d'observation raisonnable (quelques jours d'usage réel du client), que la bascule est stable.

## Ce qu'il reste à faire avant le premier usage réel

Dans l'ordre où ça devrait être abordé :

1. Monter un VPS de test avec la stack Supabase self-hosted complète (pas juste Postgres nu comme le test du 2026-09-09).
2. Vérifier que `scripts/apply-schema.mjs` tourne sans aucun stub manuel contre cette vraie stack (hypothèse de la section 2, non encore confirmée).
3. Provisionner un client de test fictif de bout en bout sur ce VPS (étapes 2 à 6 de ce runbook), pas un vrai client.
4. Une fois ce parcours validé, documenter les commandes exactes de génération de clés API côté self-hosted (absentes de ce runbook faute d'avoir été exécutées).
5. Seulement alors, envisager la bascule d'un premier client réel, et le choisir parmi les moins critiques du parc.
