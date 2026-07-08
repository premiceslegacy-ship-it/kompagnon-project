-- Rappel automatique J-3 avant expiration du lien magique /mon-espace.
-- reminder_sent_at sert de verrou anti-doublon : une fois le rappel envoyé
-- pour un token donné, on ne le renvoie plus même si le cron tourne
-- plusieurs fois dans la fenêtre J-3.

ALTER TABLE public.member_space_tokens
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_member_space_tokens_reminder_pending
  ON public.member_space_tokens(expires_at)
  WHERE reminder_sent_at IS NULL;

COMMENT ON COLUMN public.member_space_tokens.reminder_sent_at IS
  'Horodatage du rappel J-3 envoyé avant expiration — NULL tant qu''aucun rappel n''est parti pour ce token';
