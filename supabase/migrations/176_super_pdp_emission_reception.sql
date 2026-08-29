-- 176_super_pdp_emission_reception.sql
-- Granularite emission/reception pour Super PDP : mode='super_pdp' + oauth_status='connected'
-- ne suffisent plus a activer quoi que ce soit. Chaque capacite (emission, reception) est
-- un booleen independant, pilote uniquement par le cockpit (formulaire /orsayn, propage par
-- config-sync), jamais par l'instance cliente elle-meme.
--
-- Justification produit : ce n'est pas tous les clients qui doivent transmettre/recevoir via
-- Atelier. Le calendrier legal renforce le besoin : reception obligatoire des le 01/09/2026
-- pour les artisans/TPE/PME, emission seulement au 01/09/2027 -- entre les deux, chaque client
-- choisit s'il veut etre pret plus tot ou attendre l'echeance. Voir
-- docs/atelier-facturation-electronique.md.

ALTER TABLE public.organization_einvoicing_config
  ADD COLUMN IF NOT EXISTS super_pdp_emission_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_pdp_reception_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_einvoicing_config.super_pdp_emission_enabled IS
  'Autorise la transmission de factures emises via Super PDP. Pilote uniquement par le cockpit (config-sync) ; l''instance cliente ne peut jamais l''activer elle-meme.';
COMMENT ON COLUMN public.organization_einvoicing_config.super_pdp_reception_enabled IS
  'Autorise le polling de reception (factures fournisseurs) via Super PDP pour cette organisation. Pilote uniquement par le cockpit (config-sync).';
