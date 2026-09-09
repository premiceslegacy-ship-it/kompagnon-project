-- ============================================================
-- 001_extensions.sql
-- Extensions PostgreSQL requises par Kompagnon
-- À appliquer en premier sur tout nouveau projet Supabase
-- ============================================================

-- pgcrypto : gen_random_bytes() pour les tokens d'invitation
CREATE EXTENSION IF NOT EXISTS "pgcrypto"  WITH SCHEMA extensions;

-- uuid-ossp : gen_random_uuid() (aussi disponible nativement en PG 13+)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- pgvector : embeddings vectoriels pour company_memory (IA)
-- Découvert le 2026-09-09 en testant le provisioning contre un Postgres
-- vierge : sur le projet Supabase cloud de production, l'extension "vector"
-- vit en réalité dans le schéma public (Supabase la préinstalle ainsi,
-- indépendamment du WITH SCHEMA demandé ici — ce n'est donc pas un no-op
-- comme pour pgcrypto/uuid-ossp/pg_trgm, qui eux respectent bien
-- "extensions"). Les migrations suivantes (005_advanced_tables.sql
-- notamment) référencent le type comme public.vector : installer dans
-- public ici aligne un Postgres nu ou self-hosted sur le comportement réel
-- de prod, plutôt que sur ce que la ligne WITH SCHEMA extensions suggérait
-- à tort.
CREATE EXTENSION IF NOT EXISTS "vector"    WITH SCHEMA public;
