/**
 * Règles commerciales partagées entre le code (cron, cockpit, résiliation) et les
 * emails. Fichier volontairement sans dépendance : il est importé côté serveur
 * comme dans les templates.
 */

/** Le seul essai gratuit : formule Pro, sans carte bancaire. */
export const TRIAL_TIER = 'pro' as const
export const TRIAL_DURATION_DAYS = 7

/** Après une demande de résiliation, l'accès reste actif ce nombre de jours. */
export const CANCELLATION_NOTICE_DAYS = 30
