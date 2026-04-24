-- Migration 059 : WABA mutualisée + contacts autorisés avec labels
-- Rend phone_number_id et access_token optionnels pour l'architecture mutualisée
-- Remplace authorized_numbers TEXT[] par authorized_contacts JSONB[]
-- Format authorized_contacts : [{"number": "+33611...", "label": "Samuel"}, ...]

-- 1. Rendre phone_number_id et access_token optionnels
ALTER TABLE whatsapp_configs
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

-- 2. Flag WABA mutualisée
ALTER TABLE whatsapp_configs
  ADD COLUMN IF NOT EXISTS use_shared_waba BOOLEAN NOT NULL DEFAULT false;

-- 3. Nouvelle colonne authorized_contacts JSONB[]
ALTER TABLE whatsapp_configs
  ADD COLUMN IF NOT EXISTS authorized_contacts JSONB[] DEFAULT '{}';

-- 4. Migrer les données existantes : authorized_numbers → authorized_contacts sans label
UPDATE whatsapp_configs
SET authorized_contacts = (
  SELECT ARRAY_AGG(jsonb_build_object('number', num, 'label', ''))
  FROM UNNEST(authorized_numbers) AS num
)
WHERE authorized_numbers IS NOT NULL AND array_length(authorized_numbers, 1) > 0;

-- 5. Conserver authorized_numbers pour rétrocompatibilité (lecture seule désormais)
-- Ne pas supprimer la colonne pour ne pas casser les configs non-mutualisées existantes
