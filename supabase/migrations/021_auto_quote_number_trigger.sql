-- Trigger qui génère automatiquement le numéro de devis à l'insertion
-- si la mutation applicative ne le fournit pas.
CREATE OR REPLACE FUNCTION public.auto_set_quote_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    NEW.number := public.generate_quote_number(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_auto_quote_number
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_quote_number();
