-- Quote attachments are written and read only through server routes that
-- resolve the organization and request owner. Browser roles receive no direct
-- Storage policy, and the bucket remains private.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/acad',
      'application/dxf'
    ]
WHERE id = 'quote-attachments';

DROP POLICY IF EXISTS "quote_attachments_public_select" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS quote_attachments_anon_insert ON storage.objects;
DROP POLICY IF EXISTS quote_attachments_read ON storage.objects;
DROP POLICY IF EXISTS quote_attachments_delete ON storage.objects;
