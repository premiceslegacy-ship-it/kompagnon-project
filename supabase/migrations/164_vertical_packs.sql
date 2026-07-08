-- Pack verticale métier
-- Axe transversal aux profils/activités : pilote presets catalogue, trade contrat
-- dédié et enrichissement du contexte IA pour une profondeur métier partagée
-- entre plusieurs activités (ex: metallerie + tolerie + chaudronnerie + soudure
-- partagent tous business_vertical_pack = 'metal', même si leur business_profile
-- diffère). Indépendant de has_metal_pricing (module pricing matières, séparé).
--
-- Activé automatiquement à l'onboarding si l'activité choisie est éligible,
-- ou manuellement depuis le cockpit Orsayn pour une organisation existante.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_vertical_pack TEXT NULL;

COMMENT ON COLUMN public.organizations.business_vertical_pack IS
  'Pack verticale métier actif (ex: metal). Indépendant de business_profile et business_activity_id : pilote presets catalogue, trade de contrat dédié et enrichissement du contexte IA. Activé automatiquement à l''onboarding si l''activité est éligible, ou manuellement depuis le cockpit Orsayn pour une organisation existante.';

-- Liste fermée alignée sur VERTICAL_PACKS dans src/lib/vertical-packs.ts.
-- À étendre (nouvelle migration ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...)
-- à chaque nouveau pack livré (ex: renovation_premium, cvc).
-- Postgres ne supporte pas ADD CONSTRAINT ... IF NOT EXISTS : bloc conditionnel
-- pour que cette migration reste rejouable sans erreur si déjà appliquée.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_business_vertical_pack_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_business_vertical_pack_check
      CHECK (business_vertical_pack IS NULL OR business_vertical_pack IN ('metal'));
  END IF;
END $$;

-- Requêtes cockpit ("quelles organisations ont le pack metal actif ?").
CREATE INDEX IF NOT EXISTS idx_organizations_business_vertical_pack
  ON public.organizations(business_vertical_pack)
  WHERE business_vertical_pack IS NOT NULL;
