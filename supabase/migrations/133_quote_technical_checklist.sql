-- Checklist technique sur les devis
-- Stockée en JSONB : tableau d'objets { id, label, checked, category }
-- Permet de suivre : plan reçu, cotes terrain, tolérances validées, finition confirmée, transport prévu, pose planifiée, soudure validée

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS technical_checklist jsonb NULL;

COMMENT ON COLUMN public.quotes.technical_checklist IS
  'Checklist technique du devis : [{id, label, checked, category}]. Utilisée pour valider les points clés avant envoi (plans, tolérances, finition, transport, pose).';
