-- Politiques RLS pour le bucket logos (upload logo entreprise depuis les paramètres)

-- Lecture publique (les logos sont publics)
CREATE POLICY "logos_public_select"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'logos');

-- Upload authentifié (utilisateur peut uploader dans son propre dossier)
CREATE POLICY "logos_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logos');

-- Mise à jour (upsert)
CREATE POLICY "logos_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'logos');

-- Suppression
CREATE POLICY "logos_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'logos');
