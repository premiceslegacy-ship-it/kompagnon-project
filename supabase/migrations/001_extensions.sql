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
CREATE EXTENSION IF NOT EXISTS "vector"    WITH SCHEMA extensions;
