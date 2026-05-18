-- Ajout de la fonction du signataire côté client (ex : Gérant, Directeur technique…)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_signatory_role TEXT;
