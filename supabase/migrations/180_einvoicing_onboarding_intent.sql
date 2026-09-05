-- 180_einvoicing_onboarding_intent.sql
-- Intention exprimee a l'onboarding, avant toute connexion Super PDP (qui n'a pas sa
-- place dans le funnel d'inscription -- le callback OAuth redirige toujours vers
-- /settings, jamais vers /onboarding). Sert uniquement a afficher un rappel cible dans
-- les Settings si le client a dit vouloir activer la facturation electronique des que
-- possible. N'active rien par elle-meme.

ALTER TABLE public.organization_einvoicing_config
  ADD COLUMN IF NOT EXISTS onboarding_intent TEXT CHECK (onboarding_intent IN ('activate', 'later'));

COMMENT ON COLUMN public.organization_einvoicing_config.onboarding_intent IS
  'Intention exprimee a l''onboarding avant toute connexion Super PDP : activate = veut activer des que possible (rappel affiche en Settings), later = pas pret. NULL = onboarding non passe par cette etape (comptes crees avant son introduction).';
