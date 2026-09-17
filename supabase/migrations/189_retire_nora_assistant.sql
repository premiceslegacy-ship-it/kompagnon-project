-- ============================================================
-- 189_retire_nora_assistant.sql
-- Nora est retiree : la planification est absorbee par Sarah.
-- Remplace la valeur 'nora' par 'planning' (cible neutre, sans
-- persona) dans ai_briefs.target_assistant / source_assistant,
-- puis retire 'nora' de la contrainte CHECK.
-- ============================================================

UPDATE public.ai_briefs SET target_assistant = 'planning' WHERE target_assistant = 'nora';
UPDATE public.ai_briefs SET source_assistant = 'planning' WHERE source_assistant = 'nora';

ALTER TABLE public.ai_briefs
  DROP CONSTRAINT IF EXISTS ai_briefs_assistants_check;

ALTER TABLE public.ai_briefs
  ADD CONSTRAINT ai_briefs_assistants_check
  CHECK (
    source_assistant IN ('sarah', 'chloe', 'marco', 'lea', 'planning')
    AND target_assistant IN ('sarah', 'chloe', 'marco', 'lea', 'planning')
  );
