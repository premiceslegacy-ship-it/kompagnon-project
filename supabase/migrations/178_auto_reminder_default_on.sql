-- Migration 178 — Relances automatiques activees par defaut pour les nouveaux clients
-- Decision produit : ca ne scale pas de demander a chaque artisan d'aller
-- activer les relances lui-meme. Change uniquement le DEFAULT de la colonne
-- (nouvelles organisations creees via initialize_organization_for_user,
-- voir migration 171) -- ne touche PAS les organisations existantes, qui
-- gardent leur reglage actuel meme si elles n'ont jamais rien configure.

ALTER TABLE public.organizations
  ALTER COLUMN auto_reminder_enabled SET DEFAULT true;

COMMENT ON COLUMN public.organizations.auto_reminder_enabled IS
  'Active les relances automatiques par email (cron quotidien). Actif par defaut pour les nouvelles organisations depuis la migration 178 ; reglable par l''owner dans /settings.';
