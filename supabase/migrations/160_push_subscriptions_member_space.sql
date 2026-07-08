-- ============================================================
-- 160 — Notifications push pour les membres sans compte auth (audit push juillet 2026)
-- ------------------------------------------------------------
-- Constat : push_subscriptions.user_id référence auth.users et est NOT NULL.
-- Un intervenant terrain géré via /mon-espace (session HMAC, sans compte Supabase
-- Auth — chantier_equipe_membres.profile_id NULL) ne peut donc jamais s'abonner :
-- getPlanningRecipientUserIds() l'ignore silencieusement, aucune alerte ne part.
--
-- Correctif : user_id devient nullable, ajout de member_id (chantier_equipe_membres)
-- également nullable, avec une contrainte garantissant qu'exactement l'un des deux
-- est renseigné. La policy RLS "own" reste valable pour les comptes auth ; les
-- membres sans compte n'ont pas de session Supabase Auth (auth.uid() est NULL pour
-- eux) — leur abonnement est géré exclusivement via le client admin, dans la route
-- API qui vérifie la session HMAC /mon-espace (voir src/app/api/push/subscribe-member).
-- ============================================================

ALTER TABLE public.push_subscriptions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_one_owner
  CHECK ((user_id IS NOT NULL) <> (member_id IS NOT NULL));

-- L'ancienne contrainte unique (user_id, endpoint) ne couvre pas le cas member_id.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_uniq
  ON public.push_subscriptions(user_id, endpoint) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_member_endpoint_uniq
  ON public.push_subscriptions(member_id, endpoint) WHERE member_id IS NOT NULL;

-- Pas de policy RLS pour member_id : les membres sans compte n'ont pas de session
-- Supabase Auth, donc pas d'auth.uid(). Leur écriture/lecture passe uniquement par
-- le client admin (service_role) dans les routes qui vérifient la session HMAC.
