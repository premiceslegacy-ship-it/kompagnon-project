-- ============================================================
-- 184_sarah_conversation_messages.sql
--
-- Persistance serveur des tours de conversation avec Sarah.
-- Jusqu'ici l'historique n'existait que côté client (historyRef dans
-- SarahWidget.tsx, conversationId généré par crypto.randomUUID() à
-- chaque montage du widget) : Sarah ne se souvenait de rien d'une
-- session à l'autre au-delà de ce que le tool save_memory avait
-- explicitement capturé dans company_memory.
--
-- Écrite par sarah-secretary/route.ts (service role) après chaque
-- échange ; lue au premier message d'une nouvelle session pour
-- recharger le contexte récent de l'organisation, indépendamment du
-- conversationId côté client (qui change à chaque ouverture du
-- widget, contrairement à l'organisation qui, elle, ne change pas).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sarah_conversation_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id TEXT        NOT NULL,
  role            TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sarah_conversation_messages_role_check
    CHECK (role IN ('user', 'sarah')),
  CONSTRAINT sarah_conversation_messages_content_len_check
    CHECK (char_length(content) <= 8000)
);

-- Lecture du contexte récent d'une organisation (tous utilisateurs
-- confondus, le plus fréquent) et lecture par conversation précise.
CREATE INDEX IF NOT EXISTS sarah_conversation_messages_org_idx
  ON public.sarah_conversation_messages (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sarah_conversation_messages_conversation_idx
  ON public.sarah_conversation_messages (conversation_id, created_at);

ALTER TABLE public.sarah_conversation_messages ENABLE ROW LEVEL SECURITY;

-- Même pattern que sarah_action_proposals (150) : lecture réservée aux
-- membres actifs ayant la permission ai.sarah, restreinte à leurs
-- propres messages (ou aux messages sans utilisateur identifié).
-- Écriture réservée au service role (le serveur écrit via le client
-- admin après chaque échange) : pas de policy INSERT/UPDATE/DELETE
-- pour authenticated.
DROP POLICY IF EXISTS "sarah_conversation_messages_ai_member_select" ON public.sarah_conversation_messages;

CREATE POLICY "sarah_conversation_messages_ai_member_select" ON public.sarah_conversation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.role_permissions rp
        ON rp.role_id = m.role_id
       AND rp.permission_key = 'ai.sarah'
       AND rp.is_allowed = true
      WHERE m.user_id = auth.uid()
        AND m.is_active = true
        AND m.organization_id = sarah_conversation_messages.organization_id
    )
    AND (user_id IS NULL OR user_id = auth.uid())
  );
