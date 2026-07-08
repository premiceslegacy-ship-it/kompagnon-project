-- ============================================================
-- 166_quote_attachments_bucket.sql
-- Cree le bucket Storage quote-attachments manquant.
-- La migration 054 posait deja les policies RLS sur storage.objects
-- pour ce bucket, mais le bucket lui-meme n'avait jamais ete cree :
-- tout upload depuis le formulaire public /demande/[orgSlug] echouait
-- avec "Bucket not found" (404).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'quote-attachments'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'quote-attachments',
      'quote-attachments',
      true,
      10485760,
      ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/octet-stream'
      ]
    );
  END IF;
END $$;
