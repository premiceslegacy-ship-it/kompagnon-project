-- Complète la migration 009 : deux cas légitimes n'ont structurellement aucune
-- organisation à résoudre au moment de l'écriture — un paiement Stripe orphelin
-- (source_instance non identifiable) et un email broadcast manuel (non lié à un
-- client précis). NOT NULL sur organization_id est correct pour tous les autres
-- cas (settings/subscriptions/quotas d'un vrai client), donc on ne l'assouplit
-- pas globalement.
--
-- operator_client_settings/subscriptions/quotas : organization_id fait partie
-- de la PK/UNIQUE, ne peut pas être NULL. On introduit un UUID sentinelle
-- explicite représentant "aucune organisation résolue", nommé et documenté,
-- réservé au seul cas orphelin (jamais un vrai organization_id applicatif).
--
-- operator_client_events/operator_commercial_events : pas de contrainte PK sur
-- organization_id, rendu NULLABLE directement — plus honnête qu'une sentinelle
-- pour un simple log d'événement.

COMMENT ON COLUMN public.operator_client_settings.organization_id IS
  'UUID de l''organisation cliente. Valeur sentinelle 00000000-0000-0000-0000-000000000000 réservée aux paiements Stripe orphelins (source_instance non résolue) — jamais un organization_id applicatif réel.';

ALTER TABLE public.operator_client_events
  ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE public.operator_commercial_events
  ALTER COLUMN organization_id DROP NOT NULL;
