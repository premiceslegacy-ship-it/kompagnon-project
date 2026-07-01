-- Statut "prix à valider fournisseur" sur une ligne de devis
-- Permet de marquer qu'un prix est provisoire / en attente de confirmation fournisseur
alter table quote_items
  add column if not exists price_pending boolean not null default false;
