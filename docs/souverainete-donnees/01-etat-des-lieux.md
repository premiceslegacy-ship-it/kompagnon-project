# État des lieux du couplage à Supabase

Dernière mise à jour : 2026-09-09. Chiffres vérifiés sur le repo à cette date (185 migrations, incluant les 4 nouvelles posées le 2026-09-09 : 181 et 182 pour l'index vectoriel, 183 pour l'apprentissage prix de Chloé, 184 pour la persistance des conversations Sarah).

## Chiffres clés

| Mesure | Valeur |
|---|---|
| Fichiers `.ts`/`.tsx` important Supabase | 188 |
| Occurrences de `.from(...)` (appels PostgREST) | 1529, répartis sur 196 fichiers |
| Appels `supabase.auth.*` | 165 (dont `getUser()` appelé dans le middleware sur chaque requête) |
| Policies RLS (`CREATE POLICY`) | 168 |
| Migrations SQL | 185 |
| Tables | 79 |
| Fonctions SQL | 41 |
| Triggers | 18 |
| Fonctions RPC appelées depuis l'app | 7 |
| Buckets Storage | 3 (`logos`, `chantier-photos`, `quote-attachments`) |
| Edge Functions | 1 (`whatsapp-webhook`) |
| Usage Realtime | 0 |
| Usage pg_cron / pg_net | 0 (toute la planification est sur des Cloudflare Workers cron) |

## Verdict par brique

| Brique Supabase | Usage | Portabilité |
|---|---|---|
| Postgres | Massif (1529 `.from()`) | Native : Postgres standard, aucune fonctionnalité propriétaire au-delà de PostgREST |
| PostgREST | Massif | Composant open source, réutilisable hors Supabase |
| GoTrue (Auth) | Fort (165 appels, dont le middleware) | Composant open source, réutilisable hors Supabase |
| RLS | Critique (168 policies) | Postgres natif : **c'est le vrai verrou**, voir plus bas |
| Storage | Modéré (19 appels, 3 buckets) | Composant open source |
| pgvector | Présent (`company_memory`, embeddings Qwen3 4096 dims) | Extension Postgres standard |
| Realtime | Zéro | Sans objet |
| pg_cron / pg_net | Zéro | Sans objet : le compute tourne déjà sur Cloudflare Workers |
| Edge Functions | Minime (1 fonction) | Facile à réécrire ailleurs |

## Les deux vrais verrous

Le SDK `supabase-js` et le dialecte PostgREST ne sont **pas** le problème : ce sont des façons d'écrire des requêtes, remplaçables mécaniquement. Les deux verrous réels :

1. **Les 168 policies RLS.** C'est le modèle de sécurité multi-tenant primaire de l'application : l'isolation entre organisations vit dans la base, pas dans une couche applicative. Hors Supabase, il faut soit reproduire RLS sur un Postgres géré compatible (Neon, RDS, ou tout Postgres qui supporte RLS nativement : c'est du Postgres standard depuis la version 9.5), soit réécrire cette isolation en couche applicative sur les 196 fichiers concernés. La première option ne casse rien ; la seconde est un chantier de refonte, pas une migration d'infra.

2. **GoTrue (Auth).** 152 appels à `getUser()`, dont un dans `src/middleware.ts` exécuté à chaque requête. Migrer l'auth implique de rejouer les sessions existantes, les cookies `sb-*`, la logique `verifyOtp`/`generateLink`, et les FK vers `auth.users(id)` présentes dans plusieurs tables (ex. `quotes.created_by`, `sarah_conversation_messages.user_id`).

## Le piège pgvector, résolu

Un audit antérieur (juillet-août 2026) notait qu'aucun index vectoriel n'existait sur `company_memory`, avec un commentaire dans la migration 057 indiquant « pgvector < 0.7, pas d'index possible au-delà de 2000 dimensions ». Ce commentaire est **périmé** : le projet de production tourne sur **pgvector 0.8.0**, qui supporte le type `halfvec` jusqu'à 4000 dimensions en index HNSW/IVFFlat.

Un index a été posé le 2026-09-09 (migrations 181 et 182) sur `subvector(embedding, 1, 4000)::halfvec(4000)`, avec reclassement exact sur le vecteur complet en 4096 dimensions pour ne perdre aucune précision. Testé en base réelle : résultats strictement identiques à l'ancienne méthode. Sans rapport direct avec la question Supabase, mais cette page en gardait la trace : le sujet est clos.

## Ce qui rend une sortie réaliste

- **4 extensions Postgres, toutes standard** : `pgcrypto`, `uuid-ossp`, `vector`, `pg_trgm`. Rien de propriétaire.
- **Le compute est déjà ailleurs.** L'app tourne sur Cloudflare Workers (via OpenNext), avec 4 workers cron indépendants qui ne font que déclencher des routes `/api/cron/*`. Supabase ne sert que de base de données, d'auth et de stockage de fichiers : pas de compute.
- **Zéro Realtime, zéro pg_cron.** Les deux dépendances qui compliquent d'habitude une migration sont absentes ici.
- **181 migrations SQL versionnées et rejouables.** Le schéma est reproductible sur n'importe quel Postgres : voir la validation réelle dans [04-runbook-bascule.md](04-runbook-bascule.md) et le script `scripts/apply-schema.mjs`.

## Ce qui a été vérifié en conditions réelles

Le 2026-09-09, `scripts/apply-schema.mjs` a été testé contre un Postgres vierge (image `pgvector/pgvector:pg17`, Docker, aucun autre composant Supabase). **170 des 185 migrations passent** une fois posés les prérequis suivants : tous relèvent de ce que Supabase fournit nativement sur un projet cloud, aucun n'est applicatif :

- schémas `extensions` et `auth` ;
- une table minimale `auth.users(id uuid primary key)` (nécessaire aux FK) ;
- les fonctions `auth.uid()` et `auth.role()` (des stubs suffisent, les policies RLS elles-mêmes ne sont pas exercées par un simple push de schéma) ;
- les rôles Postgres `anon`, `authenticated`, `service_role`.

Au-delà de la migration 170, un vrai service Storage devient nécessaire (fonctions comme `storage.foldername()`) : hors du périmètre du script, qui n'installe que le schéma applicatif. Un self-hosted réel tourne la stack Supabase complète (Docker Compose officiel) et fournit cela nativement.

Ce test a aussi révélé et corrigé deux vrais bugs de migration, invisibles sur les instances existantes (déjà appliquées depuis longtemps) mais bloquants pour tout **nouveau** provisioning :

- `004_business_tables.sql` utilisait `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`, syntaxe qui n'existe pas en PostgreSQL (contrairement à `CREATE TABLE/INDEX IF NOT EXISTS`).
- `008_rls.sql` contenait une référence de colonne ambiguë (`id` non qualifié dans un sous-select où deux tables portent cette colonne) : la policy déployée en production stockait déjà la forme corrigée, preuve que ce texte source n'avait jamais été rejoué depuis son écriture initiale.

Les deux sont corrigés dans le repo (voir le commit correspondant).
