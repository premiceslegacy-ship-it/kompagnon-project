-- Politique RLS pour le bucket quote-attachments
-- Permet aux visiteurs anonymes (formulaire public) d'uploader des fichiers

-- Lecture publique (URLs publiques utilisées dans les demandes de devis)
CREATE POLICY "quote_attachments_public_select"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'quote-attachments');

-- Upload anonyme (formulaire public, utilisateur non connecté)
CREATE POLICY "quote_attachments_anon_insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'quote-attachments');

-- Upload authentifié (côté app, si besoin futur)
CREATE POLICY "quote_attachments_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'quote-attachments');

-- Suppression réservée aux utilisateurs authentifiés
CREATE POLICY "quote_attachments_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'quote-attachments');
