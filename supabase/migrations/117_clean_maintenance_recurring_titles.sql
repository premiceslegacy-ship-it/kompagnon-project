-- Nettoie les anciens libellés de modèles récurrents maintenance.
-- Ex: "Entretien — Entretien - Nouveau devis" -> "Entretien - Nouveau devis"
UPDATE public.recurring_invoices
SET title = regexp_replace(title, '^Entretien\s*[—-]\s*(Entretien\s*[—-]\s*)+', 'Entretien - ', 'i')
WHERE title ~* '^Entretien\s*[—-]\s*Entretien\s*[—-]';

UPDATE public.recurring_invoice_items
SET description = regexp_replace(description, '^Contrat d''entretien\s*[—-]\s*(Entretien\s*[—-]\s*)+', 'Contrat d''entretien - ', 'i')
WHERE description ~* '^Contrat d''entretien\s*[—-]\s*Entretien\s*[—-]';

UPDATE public.recurring_invoice_items
SET description = replace(description, ' — ', ' - ')
WHERE description LIKE '% — %';

UPDATE public.chantiers
SET title = regexp_replace(title, '^Entretien\s*[—-]\s*(Entretien\s*[—-]\s*)+', 'Entretien - ', 'i')
WHERE is_maintenance = true
  AND title ~* '^Entretien\s*[—-]\s*Entretien\s*[—-]';
