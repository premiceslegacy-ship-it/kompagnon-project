-- Sous-totaux par lot / section sur les devis
-- Flag par devis (opt-in) + défaut organisation

alter table organizations
  add column if not exists default_show_section_subtotals boolean not null default false;

alter table quotes
  add column if not exists show_section_subtotals boolean not null default false;
