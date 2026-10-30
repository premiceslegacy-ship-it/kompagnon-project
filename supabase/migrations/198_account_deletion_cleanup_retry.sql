-- L'anonymisation en base précède le nettoyage des objets Storage et des
-- comptes Auth. Ce marqueur distinct permet au cron de reprendre ces étapes
-- après une panne, même lorsque anonymized_at est déjà défini.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS deletion_cleanup_completed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.organizations.deletion_cleanup_completed_at IS
  'Date de fin du nettoyage externe de suppression (Storage et comptes Auth), écrite par le cron après succès complet. NULL tant que le nettoyage reste à reprendre.';

-- Étend la denylist serveur existante (193) sans utiliser auth.uid() IS NULL
-- comme raccourci serveur : cette valeur est aussi NULL pour anon.
CREATE OR REPLACE FUNCTION public.protect_org_server_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role() = 'service_role', false) THEN
    RETURN NEW;
  END IF;

  IF (NEW.deletion_requested_at, NEW.deletion_scheduled_at, NEW.anonymized_at,
      NEW.deletion_cleanup_completed_at, NEW.join_code,
      NEW.pa_api_key_encrypted, NEW.pa_webhook_secret, NEW.pa_siren_declared,
      NEW.pa_activated_at, NEW.facturx_enabled)
     IS DISTINCT FROM
     (OLD.deletion_requested_at, OLD.deletion_scheduled_at, OLD.anonymized_at,
      OLD.deletion_cleanup_completed_at, OLD.join_code,
      OLD.pa_api_key_encrypted, OLD.pa_webhook_secret, OLD.pa_siren_declared,
      OLD.pa_activated_at, OLD.facturx_enabled)
  THEN
    RAISE EXCEPTION 'Colonne d''organisation réservée au serveur';
  END IF;

  IF current_setting('app.org_numbering', true) IS DISTINCT FROM 'on'
     AND (NEW.last_invoice_number, NEW.last_quote_number)
         IS DISTINCT FROM (OLD.last_invoice_number, OLD.last_quote_number)
  THEN
    RAISE EXCEPTION 'Colonne d''organisation réservée au serveur';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_org_server_columns() FROM PUBLIC, anon, authenticated;
