-- Recalcul des totaux de tous les devis en excluant les lignes internes
UPDATE public.quotes q
SET
  total_ht  = sub.ht,
  total_tva = sub.tva,
  total_ttc = sub.ht + sub.tva
FROM (
  SELECT
    quote_id,
    COALESCE(SUM(CASE WHEN NOT is_internal THEN quantity * unit_price ELSE 0 END), 0)                          AS ht,
    COALESCE(SUM(CASE WHEN NOT is_internal THEN quantity * unit_price * COALESCE(vat_rate, 20) / 100 ELSE 0 END), 0) AS tva
  FROM public.quote_items
  GROUP BY quote_id
) sub
WHERE q.id = sub.quote_id;
