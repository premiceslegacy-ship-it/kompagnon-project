'use client'

import * as Sentry from '@sentry/nextjs'
import { getClientInstanceLabel } from '@/lib/client-instance'

// Suivi d'erreurs côté navigateur uniquement (React, error.tsx, interactions
// client). Volontairement pas de sentry.server.config.ts / sentry.edge.config.ts :
// bug non résolu (AsyncLocalStorage) sur OpenNext/Cloudflare Workers rend le
// suivi serveur instable — voir docs/backend-audit-2026-07.md.
//
// Monté comme composant (pas src/instrumentation-client.ts, convention Next
// 15.3+ non supportée par Next 14.2 — le fichier était silencieusement ignoré)
// pour garantir l'exécution sur ce projet.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (typeof window !== 'undefined' && dsn) {
  Sentry.init({
    dsn,
    // Échantillonnage des traces de performance — faible car app métier interne,
    // pas un site à fort trafic public.
    tracesSampleRate: 0.1,
    // Pas de session replay : app métier avec données financières/personnelles
    // affichées à l'écran (montants, coordonnées clients) — éviter la capture
    // d'écran par défaut tant qu'un masquage explicite des champs sensibles
    // n'est pas mis en place.
    debug: false,
    // Compte Sentry Orsayn partagé entre tous les clients per-client : cet
    // environment permet de filtrer les erreurs par instance déployée dans
    // le dashboard Sentry (Issues → filtrer par Environment).
    environment: getClientInstanceLabel(),
    // NEXT_NOT_FOUND est le signal interne que Next.js utilise pour déclencher
    // le rendu de not-found.js (ex: notFound() sur un token de signature
    // expiré/invalide, ou un lien de partage périmé) — un 404 normal, pas un bug.
    // Sans ce filtre, chaque lien mort remonte comme une erreur applicative.
    ignoreErrors: ['NEXT_NOT_FOUND'],
  })
}

export function SentryInit() {
  return null
}
