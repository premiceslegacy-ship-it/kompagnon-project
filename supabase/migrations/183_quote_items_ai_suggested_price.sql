-- Conserve le prix initialement propose par Chloe a la creation IA d'un
-- devis, jamais retouche ensuite (contrairement a unit_price, modifie a
-- chaque edition manuelle). Compare a l'envoi (sendQuote) pour detecter
-- ce que l'artisan a garde vs modifie, et alimenter company_memory en
-- consequence -- objectif : Chloe s'affine aux prix/appellations reels
-- de l'entreprise au fil des devis envoyes.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS ai_suggested_unit_price numeric;

COMMENT ON COLUMN public.quote_items.ai_suggested_unit_price IS
  'Prix unitaire suggere par Chloe a la creation IA du devis (jamais mis a jour ensuite). NULL si la ligne n a pas ete creee par IA. Compare a unit_price au moment de l envoi pour detecter les corrections de l artisan.';
