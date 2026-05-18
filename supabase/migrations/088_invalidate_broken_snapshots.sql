-- Invalide les snapshots PDF de contrats dont l'organisation est nulle dans le snapshot
-- (bug: organization_id manquant dans la requête de génération post-signature)
-- Ces contrats régénèreront leur PDF à la prochaine consultation.
UPDATE contracts
SET pdf_reference = NULL,
    pdf_generated_at = NULL,
    pdf_snapshot = NULL
WHERE pdf_snapshot IS NOT NULL
  AND (pdf_snapshot->>'organization' IS NULL OR pdf_snapshot->'organization' = 'null'::jsonb);
