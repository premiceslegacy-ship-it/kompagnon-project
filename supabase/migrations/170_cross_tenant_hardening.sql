-- Durcissement cross-tenant : policies Storage logos + verrouillage match_company_memory
-- Contexte : ces failles sont invisibles en single-tenant (1 org par instance) mais
-- deviennent exploitables dès qu'une base porte plusieurs organisations.

-- ─── 1. Policies Storage bucket logos : contraindre le chemin, pas seulement bucket_id ───
-- Les policies existantes (043_logos_storage_policies.sql) ne vérifient que bucket_id :
-- n'importe quel utilisateur authentifié peut écraser/supprimer le logo de n'importe
-- quelle autre organisation. Le code applicatif écrit déjà sous `${user.id}/logo.ext`
-- (SettingsClient.tsx, OnboardingClient.tsx) : on impose cette convention côté policy.

DROP POLICY IF EXISTS "logos_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "logos_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "logos_auth_delete" ON storage.objects;

CREATE POLICY "logos_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "logos_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "logos_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 2. match_company_memory : retirer EXECUTE à authenticated ───
-- SECURITY DEFINER, fait confiance au p_organization_id fourni par l'appelant sans le
-- valider contre l'adhésion réelle de l'utilisateur. La migration 125 a révoqué anon
-- mais authenticated conservait EXECUTE (accordé à PUBLIC par défaut sur les fonctions
-- Postgres) : un utilisateur connecté de l'org A pouvait appeler la RPC avec l'org B.
-- Seul appelant légitime : createAdminClient() côté serveur (src/lib/ai/rag.ts), qui
-- s'exécute avec le rôle service_role et n'a donc pas besoin d'EXECUTE via authenticated.

REVOKE EXECUTE ON FUNCTION public.match_company_memory(uuid, double precision[], integer, text)
  FROM authenticated, PUBLIC;

ALTER FUNCTION public.match_company_memory(uuid, double precision[], integer, text)
  SET search_path = public, pg_temp;
