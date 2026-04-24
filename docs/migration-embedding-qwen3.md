# Migration — Passage à Qwen3-Embedding-8B

## Contexte

Décision prise le 2026-04-20 : remplacer `text-embedding-3-small` (OpenAI, 1536 dims) par `qwen/qwen3-embedding-8b` (OpenRouter, 4096 dims) pour la table `company_memory`.

**Raisons :**
- MTEB rank #1 multilingual — meilleur sur le français BTP
- $0.01/M tokens (vs $0.02 pour OpenAI small)
- Dimension 4096 → meilleure représentation sémantique

---

## Migration SQL à appliquer

Créer le fichier `supabase/migrations/030_embedding_qwen3.sql` :

```sql
-- Passage de text-embedding-3-small (1536) à Qwen3-Embedding-8B (4096)
-- Les entrées existantes avec embedding NOT NULL devront être re-générées

ALTER TABLE public.company_memory
  ALTER COLUMN embedding TYPE public.vector(4096);

COMMENT ON COLUMN public.company_memory.embedding IS 'Qwen3-Embedding-8B via OpenRouter — 4096 dims';

-- Mettre à jour l'index vectoriel si existant
-- ivfflat est limité à 2000 dims — Qwen3 (4096) requiert HNSW
DROP INDEX IF EXISTS idx_company_memory_embedding;
CREATE INDEX idx_company_memory_embedding
  ON public.company_memory
  USING hnsw (embedding public.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

⚠️ Si des embeddings 1536 dims ont déjà été insérés, vider la colonne avant :
```sql
UPDATE public.company_memory SET embedding = NULL WHERE embedding IS NOT NULL;
```

---

## Code à implémenter

### `src/lib/ai/embeddings.ts` (à créer)

```typescript
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}
```

### Intégration dans `import-documents.ts`

Actuellement, les entrées `company_memory` sont insérées avec `embedding: null`.
Deux options :

**Option A — En ligne (simple, ralentit l'import)** :
```typescript
import { generateEmbedding } from '@/lib/ai/embeddings'
// Avant l'insert company_memory :
const embedding = await generateEmbedding(memoryContent)
// Puis : embedding: embedding
```

**Option B — Job background (recommandé)** :
Créer un cron Cloudflare Worker qui tourne toutes les heures et génère les embeddings manquants :
```sql
SELECT id, content FROM company_memory 
WHERE embedding IS NULL AND is_active = true 
LIMIT 50
```
→ Génère l'embedding → UPDATE la ligne.

---

## Utilisation RAG (futur)

Requête de similarité sémantique dans le system prompt des agents :

```sql
SELECT content, type, metadata
FROM company_memory
WHERE organization_id = $1
  AND is_active = true
  AND embedding IS NOT NULL
ORDER BY embedding <=> $2::vector  -- $2 = embedding de la requête utilisateur
LIMIT 5
```

---

## État actuel

- [x] Décision modèle prise (Qwen3-Embedding-8B)
- [x] `company_memory` commence à être alimentée (import factures/devis)
- [x] Migration SQL `057_embedding_qwen3.sql` créée et appliquée (numéro 030 déjà pris par chantiers_equipes)
- [x] `src/lib/ai/embeddings.ts` créé
- [x] `company_memory.embedding` est désormais `vector(4096)` en base
- [x] Cron background créé (`api/cron/embeddings` + `workers/embeddings/`)
- [x] Brancher le RAG dans les prompts agents (`analyze-quote` + `estimate-labor`)
- [x] Filtre optionnel par `activity_id` dans `match_company_memory`
- [x] Appliquer `058_rag_function.sql` en base Supabase
