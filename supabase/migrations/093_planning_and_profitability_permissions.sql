-- 093_planning_and_profitability_permissions.sql
-- Permissions dédiées : planning/tournées + rentabilité chantier
-- Remplace l'usage générique de chantiers.edit pour ces deux fonctions

-- ─── 1. Nouvelles permissions ────────────────────────────────────────────────

INSERT INTO public.permissions (key, label, category, position) VALUES
  ('chantiers.planning',           'Gérer le planning et les tournées',  'chantiers', 9),
  ('chantiers.profitability.view', 'Voir la rentabilité des chantiers',  'chantiers', 10)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- ─── 2. Attribution aux rôles owner / admin / manager ────────────────────────
-- Ces rôles ont déjà chantiers.edit ; on leur attribue les nouvelles permissions.
-- employee / collaborateur / viewer n'ont pas chantiers.edit → pas de planning ni rentabilité.

INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT ro.id, perm.key, true
FROM public.roles ro
CROSS JOIN (
  VALUES
    ('chantiers.planning'),
    ('chantiers.profitability.view')
) AS perm(key)
WHERE ro.slug IN ('owner', 'admin', 'manager')
ON CONFLICT (role_id, permission_key) DO UPDATE SET is_allowed = true;
