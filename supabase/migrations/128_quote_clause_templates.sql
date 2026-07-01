-- Bibliothèque de clauses réutilisables (conditions de vente, validité prix matière, révision, tolérances...)
-- Insérées dans notes_client ou payment_conditions lors de la rédaction d'un devis.

create table if not exists public.quote_clause_templates (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  title           text        not null,
  body            text        not null,
  category        text        null,
  position        integer     not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.quote_clause_templates enable row level security;

create policy "org members can manage clause templates"
  on public.quote_clause_templates
  for all
  using (
    organization_id in (
      select organization_id from public.memberships
      where user_id = auth.uid() and is_active = true
    )
  );

create index if not exists quote_clause_templates_org_idx
  on public.quote_clause_templates (organization_id, position);
