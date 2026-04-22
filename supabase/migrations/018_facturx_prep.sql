-- Migration 018 — Préparation Facturation Électronique (Factur-X / EN 16931)
-- Obligatoire pour les entreprises françaises à partir de 2026 (loi finance 2024).
-- Factur-X = PDF + XML embarqué (ZUGFeRD compatible, norme EN 16931).
--
-- Cette migration prépare le terrain structurel sans rendre la feature active.
-- L'activation se fait via organization.facturx_enabled = true.

-- ── Organizations : coordonnées bancaires + activation ──────────────────────

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS facturx_enabled        BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS facturx_profile        TEXT      DEFAULT 'EN_16931',
  -- Profils Factur-X : MINIMUM | BASIC_WL | BASIC | EN_16931 | EXTENDED
  ADD COLUMN IF NOT EXISTS bank_iban              TEXT,
  ADD COLUMN IF NOT EXISTS bank_bic               TEXT,
  ADD COLUMN IF NOT EXISTS bank_name              TEXT,
  -- Mandats & conditions spécifiques
  ADD COLUMN IF NOT EXISTS payment_means_code     TEXT      DEFAULT '30',
  -- Codes UNTDID 4461 : 30 = virement, 31 = chèque, 48 = CB, 49 = prélèvement
  ADD COLUMN IF NOT EXISTS cgv_text               TEXT;
  -- Conditions générales de vente (affichées en pied de PDF et dans le XML)

COMMENT ON COLUMN organizations.facturx_enabled    IS 'Active la génération Factur-X sur les factures';
COMMENT ON COLUMN organizations.facturx_profile    IS 'Profil Factur-X : MINIMUM | BASIC_WL | BASIC | EN_16931 | EXTENDED';
COMMENT ON COLUMN organizations.bank_iban          IS 'IBAN pour les virements (obligatoire en EN_16931)';
COMMENT ON COLUMN organizations.bank_bic           IS 'BIC/SWIFT de la banque';
COMMENT ON COLUMN organizations.payment_means_code IS 'Code UNTDID 4461 du moyen de paiement';
COMMENT ON COLUMN organizations.cgv_text           IS 'Conditions générales de vente incluses dans le XML Factur-X';

-- ── Invoices : champs obligatoires EN 16931 ─────────────────────────────────

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS facturx_xml            TEXT,
  -- XML Factur-X généré et stocké après création de la facture
  ADD COLUMN IF NOT EXISTS buyer_reference        TEXT,
  -- "Service Code" ou référence interne acheteur (obligatoire en EXTENDED)
  ADD COLUMN IF NOT EXISTS purchase_order_ref     TEXT,
  -- Numéro de bon de commande client
  ADD COLUMN IF NOT EXISTS delivery_date          DATE,
  -- Date de livraison / exécution (distincte de la date de facture)
  ADD COLUMN IF NOT EXISTS period_start           DATE,
  ADD COLUMN IF NOT EXISTS period_end             DATE,
  -- Période de facturation (pour les prestations continues)
  ADD COLUMN IF NOT EXISTS payment_means_code     TEXT,
  -- Peut surcharger le code de l'organisation pour une facture spécifique
  ADD COLUMN IF NOT EXISTS preceding_invoice_ref  TEXT,
  -- Pour les avoirs : référence de la facture corrigée
  ADD COLUMN IF NOT EXISTS preceding_invoice_date DATE,
  ADD COLUMN IF NOT EXISTS invoice_type_code      TEXT      DEFAULT '380';
  -- Codes UNTDID 1001 : 380 = facture commerciale, 381 = avoir, 386 = acompte

COMMENT ON COLUMN invoices.facturx_xml           IS 'XML Factur-X complet (stocké après génération)';
COMMENT ON COLUMN invoices.buyer_reference       IS 'Référence acheteur (ex: numéro bon de commande client)';
COMMENT ON COLUMN invoices.invoice_type_code     IS 'Code UNTDID 1001 : 380=facture, 381=avoir, 386=acompte';

-- ── Invoice items : codes produit pour Factur-X ─────────────────────────────

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS product_code          TEXT,
  -- Code article interne ou EAN/UNSPSC pour le XML
  ADD COLUMN IF NOT EXISTS unspsc_code           TEXT;
  -- Classification UNSPSC (optionnel, profile EXTENDED)

-- ── Index utiles ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_facturx
  ON invoices(organization_id)
  WHERE facturx_xml IS NOT NULL;

-- ── Note d'activation ───────────────────────────────────────────────────────
-- Pour activer Factur-X pour un client :
-- UPDATE organizations SET facturx_enabled = true, bank_iban = '...', bank_bic = '...' WHERE id = '...';
-- La génération XML se fera dans src/lib/facturx/generator.ts (à implémenter).
