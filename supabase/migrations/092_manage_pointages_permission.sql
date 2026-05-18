-- ============================================================
-- 092_manage_pointages_permission.sql
-- Nouvelle permission : chantiers.manage_pointages
-- Permet à un rôle autorisé d'ajuster ou supprimer les pointages
-- de n'importe quel membre (pas seulement les siens).
-- ============================================================

-- 1. Ajouter la permission dans le référentiel
INSERT INTO public.permissions (key, label, category, position) VALUES
  ('chantiers.manage_pointages', 'Ajuster/supprimer les pointages de l''équipe', 'chantiers', 9)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- 2. Attribuer la permission aux rôles owner, admin et manager par défaut
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, 'chantiers.manage_pointages', true
FROM   public.roles r
WHERE  r.slug IN ('owner', 'admin', 'manager')
ON CONFLICT (role_id, permission_key) DO NOTHING;
