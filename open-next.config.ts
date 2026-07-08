import type { OpenNextConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";

// Cache branché sur Cloudflare KV (bindings NEXT_INC_CACHE_KV / NEXT_TAG_CACHE_KV
// dans wrangler.jsonc). Sans ça, ISR/unstable_cache/revalidateTag sont des no-op
// et chaque page recalcule tout à chaque requête (cf. docs/backend-audit-2026-07.md).
// Note : le tag cache KV est "eventually consistent" côté OpenNext (jusqu'à ~60s
// de délai sur une revalidation) — acceptable ici, aucune donnée affichée n'a
// besoin d'une cohérence immédiate à la seconde près.
const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
      proxyExternalRequest: "fetch",
      incrementalCache: () => Promise.resolve(kvIncrementalCache),
      tagCache: () => Promise.resolve(kvTagCache),
      queue: "direct",
    },
  },
  edgeExternals: ["node:crypto"],
  middleware: {
    external: true,
    override: {
      wrapper: "cloudflare-edge",
      converter: "edge",
      proxyExternalRequest: "fetch",
      incrementalCache: () => Promise.resolve(kvIncrementalCache),
      tagCache: () => Promise.resolve(kvTagCache),
      queue: "direct",
    },
  },
};

export default config;
