-- ============================================================
-- 079_fix_invoice_payment_schedule_columns.sql
-- Ajoute les colonnes amount_type et percentage manquantes sur
-- invoice_payment_schedule (table créée sans elles via IF NOT EXISTS)
-- ============================================================

ALTER TABLE public.invoice_payment_schedule
  ADD COLUMN IF NOT EXISTS amount_type TEXT NOT NULL DEFAULT 'amount',
  ADD COLUMN IF NOT EXISTS percentage  DECIMAL(7,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_payment_schedule_amount_type_check'
      AND conrelid = 'public.invoice_payment_schedule'::regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_amount_type_check
        CHECK (amount_type IN ('amount', 'percentage'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_payment_schedule_percentage_check'
      AND conrelid = 'public.invoice_payment_schedule'::regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_percentage_check CHECK (
        (amount_type = 'amount' AND percentage IS NULL)
        OR (amount_type = 'percentage' AND percentage > 0 AND percentage <= 100)
      );
  END IF;
END $$;
