-- Notes internes / doctrine client
-- Champ libre, invisible sur les documents client, affiché dans la fiche client et l'éditeur de devis
-- Usage : contexte commercial, préférences, habitudes de paiement, interlocuteurs clés, historique relationnel

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS internal_notes text NULL;

COMMENT ON COLUMN public.clients.internal_notes IS
  'Notes internes sur le client : contexte commercial, préférences, habitudes de paiement. Jamais transmises au client.';
