-- ============================================================
-- 185_sarah_autonomy_always_on.sql
--
-- L'autonomie de Sarah sur les actions "low risk" n'est plus un
-- réglage optionnel (migration 177) : elle est désormais toujours
-- active dans le code (src/app/api/ai/sarah-secretary/route.ts).
-- Les actions sensibles (medium/high : facture, encaissement, email
-- client...) restent toujours soumises à confirmation, cette garde
-- est indépendante de cette colonne.
--
-- La colonne organizations.sarah_auto_low_risk n'est plus lue nulle
-- part dans le code : on la supprime.
-- ============================================================

ALTER TABLE organizations
  DROP COLUMN IF EXISTS sarah_auto_low_risk;
