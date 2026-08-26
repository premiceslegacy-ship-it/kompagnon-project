-- 175_einvoicing_permission_label.sql
-- Corrige le libelle seede en base pour la permission einvoicing.configure :
-- affichait encore "(B2Brouter)" apres la bascule vers Super PDP (173_super_pdp_einvoicing_config.sql).
-- Miroir de la constante TS src/lib/permissions/labels.ts.

UPDATE public.permissions
  SET label = 'Configurer la PA (Super PDP)'
  WHERE key = 'einvoicing.configure';
