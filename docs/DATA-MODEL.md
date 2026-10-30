# DATA-MODEL.md — Métier OS
### Schéma de base de données — Supabase (Postgres + RLS) — V1.3
### Mis à jour : V1.2 + conformité facturation électronique (Factur-X / B2Brouter PA)

> **Principe d'architecture :** Tous les accès BDD passent par `/lib/data/`.
> Supabase est une implémentation, pas une dépendance du code applicatif.
> Migration future vers Neon+Drizzle = modifier uniquement `/lib/data/db.ts`.

---

## SECTION 1 — ARCHITECTURE BDD

```
Supabase Postgres (EU) — aujourd'hui
  ↓ abstrait par /lib/data/db.ts
  ↓ interrogé uniquement via /lib/data/queries/ et /lib/data/mutations/

Neon + Drizzle — migration future (quand MRR stable)
  ↓ même interface /lib/data/
  ↓ zéro modification dans /app/ ou /components/
```

---

## SECTION 2 — TABLES PRINCIPALES

### `profiles`
```sql
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  phone           TEXT,
  onboarding_done BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### `organizations`
```sql
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  siret           TEXT,
  siren           TEXT,
  vat_number      TEXT,
  naf_code        TEXT,
  rcs             TEXT,           -- ex: "RCS Paris" (sans le numéro — celui-ci est dans siret)
  rcs_ville       TEXT,           -- ex: "Paris" — mention légale obligatoire sur factures FR
  forme_juridique TEXT,           -- "SARL", "SAS", "EI", "EURL", "SA"... (code normalisé)
  capital_social  DECIMAL(15,2),  -- mention légale obligatoire pour SARL/SAS/SA
  email           TEXT NOT NULL,
  phone           TEXT,
  website         TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  postal_code     TEXT,
  country         TEXT DEFAULT 'FR',
  sector          TEXT NOT NULL,
  -- ── Facturation électronique (PA B2Brouter) ──────────────────────────────
  pa_provider           TEXT DEFAULT 'b2brouter',  -- swappable si changement PA
  pa_api_key_encrypted  TEXT,                       -- chiffré via pgcrypto, jamais en clair
  pa_webhook_secret     TEXT,                       -- valide les webhooks entrants de la PA
  pa_siren_declared     BOOLEAN DEFAULT false,      -- SIREN déclaré dans l'annuaire PPF
  pa_activated_at       TIMESTAMPTZ,                -- date d'activation chez la PA
  -- ─────────────────────────────────────────────────────────────────────────
  primary_color   TEXT DEFAULT '#f59e0b',
  logo_url        TEXT,
  brand_name      TEXT,
  default_vat_rate      DECIMAL(5,2) DEFAULT 20.00,
  default_hourly_rate   DECIMAL(10,2),
  currency              TEXT DEFAULT 'EUR',
  invoice_prefix        TEXT DEFAULT 'FAC',
  quote_prefix          TEXT DEFAULT 'DEV',
  payment_terms_days    INT DEFAULT 30,
  late_penalty_rate     DECIMAL(5,2) DEFAULT 12.00,
  court_competent       TEXT,
  insurance_info        TEXT,
  certifications        TEXT[],
  last_quote_number     INT DEFAULT 0,
  last_invoice_number   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## SECTION 3 — SYSTÈME DE RÔLES FLEXIBLES

> **Principe :** Les rôles ne sont plus des ENUM figés.
> L'owner crée les rôles qu'il veut, leur donne les permissions qu'il veut,
> et peut les modifier à tout moment sans redéploiement.
> Un commercial peut se voir accorder `invoices.send` si l'owner le décide.
> La hiérarchie est définie par le niveau de confiance accordé, pas par le code.

### `roles`
Les rôles de l'organisation. Créés au déploiement avec des valeurs par défaut,
modifiables librement ensuite par l'owner/admin.

```sql
CREATE TABLE roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,          -- "Dirigeant", "Manager", "Commercial", "Technicien"...
  slug            TEXT NOT NULL,          -- Identifiant stable : "owner", "manager", "commercial"...
  description     TEXT,
  color           TEXT DEFAULT '#9494a8', -- Couleur du badge dans l'UI
  position        INT DEFAULT 0,          -- Ordre d'affichage (hiérarchie visuelle)

  -- Rôle système — ne peut pas être supprimé ni avoir ses permissions owner retirées
  is_system       BOOLEAN DEFAULT false,  -- true uniquement pour le rôle "owner"
  is_active       BOOLEAN DEFAULT true,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (organization_id, slug)
);

CREATE INDEX idx_roles_org ON roles(organization_id);
```

**Rôles créés au seed (DEPLOY-PLAYBOOK Session 2) :**
```sql
-- Rôles par défaut — position = ordre hiérarchique affiché
INSERT INTO roles (organization_id, name, slug, description, position, is_system) VALUES
  ([org_id], 'Dirigeant',    'owner',      'Accès total — ne peut pas être retiré', 0, true),
  ([org_id], 'Administrateur','admin',     'Tous les droits sauf les réglages système', 1, false),
  ([org_id], 'Manager',      'manager',    'Gestion complète sauf administration', 2, false),
  ([org_id], 'Commercial',   'commercial', 'Devis, clients, relances', 3, false),
  ([org_id], 'Technicien',   'employee',   'Consultation et brouillons', 4, false),
  ([org_id], 'Lecteur',      'viewer',     'Consultation uniquement', 5, false);
```

---

### `permissions`
Liste exhaustive de toutes les permissions disponibles dans l'app.
Table de référence — peuplée au déploiement, jamais modifiée après.

```sql
CREATE TABLE permissions (
  key             TEXT PRIMARY KEY,   -- 'quotes.create', 'invoices.send', etc.
  label           TEXT NOT NULL,      -- "Créer des devis"
  description     TEXT,              -- Explication affichée dans l'UI de config
  category        TEXT NOT NULL,      -- 'quotes' | 'invoices' | 'clients' | 'team' | 'settings' | ...
  position        INT DEFAULT 0       -- Ordre d'affichage dans la catégorie
);

-- Toutes les permissions de l'app
INSERT INTO permissions (key, label, category, position) VALUES
  -- Devis
  ('quotes.view',              'Voir les devis',               'quotes', 1),
  ('quotes.create',            'Créer des devis',              'quotes', 2),
  ('quotes.edit',              'Modifier des devis',           'quotes', 3),
  ('quotes.send',              'Envoyer des devis',            'quotes', 4),
  ('quotes.delete',            'Supprimer des devis',          'quotes', 5),
  ('quotes.convert_invoice',   'Convertir en facture',         'quotes', 6),

  -- Factures
  ('invoices.view',            'Voir les factures',            'invoices', 1),
  ('invoices.create',          'Créer des factures',           'invoices', 2),
  ('invoices.edit',            'Modifier des factures',        'invoices', 3),
  ('invoices.send',            'Envoyer des factures',         'invoices', 4),
  ('invoices.delete',          'Supprimer des factures',       'invoices', 5),
  ('invoices.record_payment',  'Enregistrer un paiement',      'invoices', 6),
  ('invoices.create_credit',   'Créer un avoir',               'invoices', 7),

  -- Clients / CRM
  ('clients.view',             'Voir les clients',             'clients', 1),
  ('clients.create',           'Créer des clients',            'clients', 2),
  ('clients.edit',             'Modifier des clients',         'clients', 3),
  ('clients.delete',           'Supprimer des clients',        'clients', 4),
  ('clients.export',           'Exporter la liste clients',    'clients', 5),

  -- Relances
  ('reminders.view',           'Voir les relances',            'reminders', 1),
  ('reminders.send_manual',    'Envoyer des relances manuelles','reminders', 2),
  ('reminders.configure_auto', 'Configurer les relances auto', 'reminders', 3),

  -- Catalogue
  ('catalog.view',             'Voir le catalogue',            'catalog', 1),
  ('catalog.edit',             'Modifier le catalogue',        'catalog', 2),

  -- Dashboard
  ('dashboard.view_ca',        'Voir le CA',                   'dashboard', 1),
  ('dashboard.view_goals',     'Voir les objectifs',           'dashboard', 2),
  ('dashboard.set_goals',      'Définir les objectifs',        'dashboard', 3),

  -- Import
  ('import.clients',           'Importer des clients',         'import', 1),
  ('import.history',           'Importer l''historique',       'import', 2),

  -- Équipe
  ('team.view',                'Voir l''équipe',               'team', 1),
  ('team.invite',              'Inviter des membres',          'team', 2),
  ('team.edit_roles',          'Modifier les rôles',           'team', 3),
  ('team.remove_members',      'Retirer des membres',          'team', 4),

  -- Paramètres
  ('settings.view',            'Voir les paramètres',          'settings', 1),
  ('settings.edit_org',        'Modifier les infos légales',   'settings', 2),
  ('settings.edit_branding',   'Modifier le branding',         'settings', 3),
  ('settings.edit_emails',     'Modifier les templates emails','settings', 4),
  ('settings.edit_goals',      'Configurer les objectifs',     'settings', 5),
  ('settings.edit_roles',      'Configurer les rôles',         'settings', 6);
```

---

### `role_permissions`
Matrice rôle ↔ permissions. Entièrement configurable par l'owner depuis l'interface.

```sql
CREATE TABLE role_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  is_allowed      BOOLEAN NOT NULL DEFAULT false,

  -- Qui a modifié cette permission en dernier
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (role_id, permission_key)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_key);
```

**Seed des permissions par défaut — peuplé au déploiement :**
```sql
-- Procédure : pour chaque rôle, INSERT les permissions autorisées avec is_allowed = true
-- Les permissions non listées sont insérées avec is_allowed = false

-- OWNER — tout est autorisé
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [owner_role_id], key, true FROM permissions;

-- ADMIN — tout sauf settings.edit_roles (modifiable par l'owner)
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [admin_role_id], key, true FROM permissions;
UPDATE role_permissions SET is_allowed = false
WHERE role_id = [admin_role_id] AND permission_key IN ('settings.edit_roles', 'team.remove_members');

-- MANAGER — gestion complète sans admin équipe et réglages avancés
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [manager_role_id], key, CASE
  WHEN key IN (
    'quotes.view','quotes.create','quotes.edit','quotes.send','quotes.convert_invoice',
    'invoices.view','invoices.create','invoices.edit','invoices.send','invoices.record_payment',
    'clients.view','clients.create','clients.edit','clients.export',
    'reminders.view','reminders.send_manual','reminders.configure_auto',
    'catalog.view','catalog.edit',
    'dashboard.view_ca','dashboard.view_goals',
    'settings.view','settings.edit_emails'
  ) THEN true ELSE false END
FROM permissions;

-- COMMERCIAL — devis, clients, relances — pas les factures par défaut
-- (l'owner peut activer invoices.send et invoices.create si souhaité)
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [commercial_role_id], key, CASE
  WHEN key IN (
    'quotes.view','quotes.create','quotes.edit','quotes.send',
    'clients.view','clients.create','clients.edit',
    'reminders.view','reminders.send_manual',
    'catalog.view',
    'dashboard.view_ca'
  ) THEN true ELSE false END
FROM permissions;

-- TECHNICIEN — consultation + brouillons uniquement
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [employee_role_id], key, CASE
  WHEN key IN (
    'quotes.view','quotes.create',  -- brouillons seulement (contrôlé par le code)
    'clients.view',
    'catalog.view',
    'dashboard.view_ca'
  ) THEN true ELSE false END
FROM permissions;

-- LECTEUR — consultation pure
INSERT INTO role_permissions (role_id, permission_key, is_allowed)
SELECT [viewer_role_id], key, CASE
  WHEN key IN ('quotes.view','invoices.view','clients.view','catalog.view')
  THEN true ELSE false END
FROM permissions;
```

---

### `memberships`
```sql
CREATE TABLE memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Lien vers le rôle (flexible — modifiable sans recréer le membership)
  role_id         UUID NOT NULL REFERENCES roles(id),

  invited_by      UUID REFERENCES auth.users(id),
  accepted_at     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,

  -- Notes internes (ex: "Commercial terrain zone Nord")
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_memberships_org  ON memberships(organization_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_role ON memberships(role_id);
```

> **Changer le rôle d'un utilisateur :** Simple `UPDATE memberships SET role_id = [nouveau_role_id]`.
> Pas besoin de recréer quoi que ce soit.

---

### `invitations`
```sql
CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id),
  email           TEXT NOT NULL,
  role_id         UUID NOT NULL REFERENCES roles(id),
  token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_invitations_token ON invitations(token);
```

---

### Tables métier (inchangées — voir DATA-MODEL V1.1 pour le détail)

Les tables suivantes sont identiques à la V1.1 :
`clients`, `materials`, `labor_rates`, `quotes`, `quote_sections`, `quote_items`,
`payments`, `reminders`, `saved_templates`,
`company_memory`, `goals`, `email_templates`, `import_jobs`, `activity_log`

> **Rappel clé :** `quotes.brief_notes` et `invoices.brief_notes` = champ cahier des charges interne
> `quote_items.ai_generated` et `quote_items.ai_validated` = surlignage ambre post-IA

---

### Modifications `invoice_items` — TVA ventilée (Factur-X obligatoire)

> ⚠️ La V1.1 ne stockait pas la TVA par ligne. Factur-X l'exige.
> Ces colonnes s'ajoutent à la table existante.

```sql
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS
  vat_rate           DECIMAL(5,2) NOT NULL DEFAULT 20.00, -- Taux TVA applicable à cette ligne (0, 5.5, 10, 20)
  vat_amount         DECIMAL(10,2),                       -- Montant TVA calculé (= HT * vat_rate / 100)
  vat_exemption_code TEXT;                                -- Code d'exonération si vat_rate = 0
                                                          -- ex: 'AE' (auto-entrepreneur franchise TVA)
                                                          -- ex: 'E' (exonéré)
-- Trigger : calcul automatique vat_amount à l'INSERT/UPDATE
CREATE OR REPLACE FUNCTION compute_vat_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.vat_amount := ROUND((NEW.unit_price * NEW.quantity * NEW.vat_rate / 100)::NUMERIC, 2);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_compute_vat
  BEFORE INSERT OR UPDATE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION compute_vat_amount();
```

---

### Modifications `invoices` — Facturation électronique

> Ces colonnes s'ajoutent à la table existante.

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS
  -- Factur-X
  facturx_xml           TEXT,         -- XML EN 16931 généré, archivé 10 ans (obligation légale)
  facturx_level         TEXT DEFAULT 'EN_16931', -- 'MINIMUM' | 'BASIC_WL' | 'EN_16931'

  -- Statuts PA (distinct du statut interne de paiement)
  pa_message_id         TEXT,         -- ID de la facture côté B2Brouter
  pa_status             TEXT DEFAULT 'not_submitted',
                                      -- 'not_submitted' | 'pending' | 'sent'
                                      -- | 'delivered' | 'accepted' | 'rejected'
  pa_status_updated_at  TIMESTAMPTZ,
  pa_rejection_reason   TEXT,         -- Motif si pa_status = 'rejected'

  -- Routage destinataire
  recipient_siren       TEXT,         -- SIREN du client destinataire (pour l'annuaire PPF)
  recipient_siret       TEXT,         -- SIRET si facturation par établissement
  einvoicing_mandatory  BOOLEAN DEFAULT false; -- Calculé : true si destinataire = grande entreprise (sept. 2026)
```

---

### Nouvelle table : `recurring_invoices`
Modèles de factures récurrentes — un par contrat/client.

```sql
CREATE TABLE recurring_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id),

  -- Identité du modèle
  title               TEXT NOT NULL,       -- "Maintenance mensuelle site Nord"
  internal_note       TEXT,                -- Note interne (jamais sur la facture)

  -- Planification
  frequency           TEXT NOT NULL,       -- 'monthly' | 'quarterly' | 'weekly' | 'custom'
  send_day            INT,                 -- Jour du mois (1-28) pour frequency = monthly
  custom_interval_days INT,               -- Pour frequency = custom
  next_send_date      DATE NOT NULL,       -- Prochaine date d'envoi calculée

  -- Confirmation
  requires_confirmation BOOLEAN DEFAULT true,  -- Toujours true recommandé
  confirmation_delay_days INT DEFAULT 3,        -- Jours avant envoi pour confirmer

  -- Montant de base (référentiel)
  base_amount_ht      DECIMAL(10,2),
  currency            TEXT DEFAULT 'EUR',

  -- Statut
  is_active           BOOLEAN DEFAULT true,
  paused_until        DATE,               -- Pause temporaire (congés, arrêt chantier)
  cancelled_at        TIMESTAMPTZ,
  cancelled_reason    TEXT,

  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Lignes du modèle récurrent (copiées sur chaque facture générée)
CREATE TABLE recurring_invoice_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_invoice_id  UUID NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
  description           TEXT NOT NULL,
  quantity              DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit                  TEXT,
  unit_price            DECIMAL(10,2) NOT NULL,
  vat_rate              DECIMAL(5,2) DEFAULT 20.00,
  position              INT DEFAULT 0
);

CREATE INDEX idx_recurring_invoices_org    ON recurring_invoices(organization_id);
CREATE INDEX idx_recurring_invoices_client ON recurring_invoices(client_id);
CREATE INDEX idx_recurring_invoices_next   ON recurring_invoices(next_send_date) WHERE is_active = true;
```

---

### Nouvelle table : `invoice_schedules`
Historique de chaque occurrence d'une facture récurrente — audit trail complet.

```sql
CREATE TABLE invoice_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recurring_invoice_id  UUID NOT NULL REFERENCES recurring_invoices(id),

  -- Occurrence
  scheduled_date        DATE NOT NULL,          -- Date prévue d'envoi
  status                TEXT NOT NULL DEFAULT 'pending_confirmation',
                        -- 'pending_confirmation' | 'confirmed' | 'sent' | 'skipped' | 'overdue'

  -- Confirmation
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          UUID REFERENCES auth.users(id),

  -- Facture générée (une fois confirmée)
  invoice_id            UUID REFERENCES invoices(id),  -- Facture réelle créée
  amount_ht             DECIMAL(10,2),                  -- Peut différer du montant de base
  modification_note     TEXT,                           -- "3 jours fériés déduits"

  -- Notifications envoyées
  notified_at           TIMESTAMPTZ,     -- Quand la notif J-3 a été envoyée
  second_notif_at       TIMESTAMPTZ,     -- Quand la notif J-1 a été envoyée

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_schedules_org       ON invoice_schedules(organization_id);
CREATE INDEX idx_schedules_recurring ON invoice_schedules(recurring_invoice_id);
CREATE INDEX idx_schedules_status    ON invoice_schedules(status) WHERE status = 'pending_confirmation';
```

---

### Champs custom_fields sur clients et catalogue

```sql
-- Champs sectoriels non standards sur les fiches clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS
  custom_fields JSONB DEFAULT '{}';
  -- Exemples : {"code_chantier": "CH-2024-045", "region": "Nord", "ref_interne": "CLI-892"}

-- Champs sectoriels non standards sur les matériaux
ALTER TABLE materials ADD COLUMN IF NOT EXISTS
  custom_fields JSONB DEFAULT '{}';
  -- Exemples : {"epaisseur": "2mm", "nuance_acier": "S235", "ref_fournisseur": "REF-4521"}

-- Champs sectoriels non standards sur les taux horaires
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS
  custom_fields JSONB DEFAULT '{}';
  -- Exemples : {"qualification_requise": "N3P2", "equipement_inclus": true}
```


Factures reçues de fournisseurs via webhook B2Brouter.

```sql
CREATE TABLE received_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identifiants PA
  pa_message_id       TEXT NOT NULL UNIQUE, -- ID B2Brouter pour déduplication webhook
  pa_received_at      TIMESTAMPTZ NOT NULL,

  -- Émetteur (fournisseur)
  supplier_siren      TEXT NOT NULL,
  supplier_siret      TEXT,
  supplier_name       TEXT NOT NULL,
  supplier_vat        TEXT,

  -- Données facture
  invoice_number      TEXT NOT NULL,
  invoice_date        DATE NOT NULL,
  due_date            DATE,
  total_ht            DECIMAL(10,2) NOT NULL,
  total_tva           DECIMAL(10,2) NOT NULL,
  total_ttc           DECIMAL(10,2) NOT NULL,

  -- Statut interne de traitement
  status              TEXT NOT NULL DEFAULT 'received',
                      -- 'received' | 'verified' | 'accounted' | 'rejected'
  rejection_reason    TEXT,
  accounted_at        TIMESTAMPTZ,
  accounted_by        UUID REFERENCES auth.users(id),

  -- Stockage
  facturx_url         TEXT,           -- Signed URL Supabase Storage (PDF + XML)
  raw_xml             JSONB,          -- XML Factur-X parsé en JSON pour recherche

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_received_invoices_org    ON received_invoices(organization_id);
CREATE INDEX idx_received_invoices_siren  ON received_invoices(supplier_siren);
CREATE INDEX idx_received_invoices_status ON received_invoices(status);

-- RLS
ALTER TABLE received_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "received_invoices_org_member" ON received_invoices
  FOR ALL TO authenticated
  USING (organization_id = get_user_org_id());
```

---

### Nouvelle table : `pa_status_events`
Historique complet des changements de statut PA — audit trail légal, immuable.

```sql
CREATE TABLE pa_status_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Lien à la facture émise OU reçue (l'un des deux seulement)
  invoice_id          UUID REFERENCES invoices(id),
  received_invoice_id UUID REFERENCES received_invoices(id),

  -- Événement
  pa_message_id   TEXT NOT NULL,
  event_type      TEXT NOT NULL,  -- 'submitted' | 'delivered' | 'accepted' | 'rejected' | 'cancelled'
  previous_status TEXT,
  new_status      TEXT NOT NULL,
  pa_timestamp    TIMESTAMPTZ NOT NULL,  -- Horodatage côté PA (fait foi)
  payload         JSONB,                 -- Payload webhook brut conservé

  created_at      TIMESTAMPTZ DEFAULT now()

  -- Pas de updated_at — cette table est append-only, jamais de UPDATE
);

CREATE INDEX idx_pa_events_invoice  ON pa_status_events(invoice_id);
CREATE INDEX idx_pa_events_received ON pa_status_events(received_invoice_id);
CREATE INDEX idx_pa_events_org      ON pa_status_events(organization_id);

-- RLS — lecture seule pour les membres, écriture uniquement via service_role (webhook)
ALTER TABLE pa_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa_events_read_org" ON pa_status_events
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());
-- INSERT uniquement via /api/invoices/webhook avec service_role
```

---

### Nouvelles permissions (à ajouter au seed)

```sql
INSERT INTO permissions (key, label, category, position) VALUES
  -- Factures reçues
  ('received_invoices.view',     'Voir les factures reçues',         'invoices', 8),
  ('received_invoices.process',  'Traiter les factures reçues',      'invoices', 9),
  ('received_invoices.reject',   'Rejeter une facture reçue',        'invoices', 10),
  -- Facturation électronique
  ('einvoicing.configure',       'Configurer la PA (B2Brouter)',     'settings', 7),
  ('einvoicing.view_status',     'Voir les statuts de transmission', 'invoices', 11);
```

---

## SECTION 4 — ROW LEVEL SECURITY (RLS)

```sql
-- Activer RLS sur toutes les tables
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations      ENABLE ROW LEVEL SECURITY;
-- ... et toutes les tables métier

-- Fonctions helper
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
  SELECT organization_id FROM memberships
  WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION user_has_permission(perm_key TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    JOIN role_permissions rp ON rp.role_id = m.role_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND rp.permission_key = perm_key
      AND rp.is_allowed = true
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Pattern RLS — tables métier
CREATE POLICY "select_org_member" ON [table]
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

-- Exemple avec vérification de permission fine
CREATE POLICY "insert_quotes_with_permission" ON quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = get_user_org_id()
    AND user_has_permission('quotes.create')
  );

CREATE POLICY "send_invoices_with_permission" ON invoices
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id())
  WITH CHECK (
    -- L'envoi est contrôlé au niveau applicatif via checkPermission()
    -- Le RLS vérifie juste l'appartenance à l'org
    organization_id = get_user_org_id()
  );

-- Permissions — lecture pour tous les membres
CREATE POLICY "read_permissions" ON permissions
  FOR SELECT TO authenticated USING (true); -- Table de référence publique

CREATE POLICY "read_role_permissions" ON role_permissions
  FOR SELECT TO authenticated
  USING (
    role_id IN (
      SELECT id FROM roles WHERE organization_id = get_user_org_id()
    )
  );

-- Modification role_permissions — owner uniquement
CREATE POLICY "edit_role_permissions" ON role_permissions
  FOR ALL TO authenticated
  USING (
    user_has_permission('settings.edit_roles')
    AND role_id IN (SELECT id FROM roles WHERE organization_id = get_user_org_id())
  );
```

---

## SECTION 5 — GESTION DES RÔLES DEPUIS L'INTERFACE

### Page `/settings/roles`

```
Vue de la page :
┌──────────────────────────────────────────────────────────────────────┐
│ Gestion des rôles                                     [+ Nouveau rôle]│
├───────────────┬──────────────────────────────────────────────────────┤
│ RÔLES (6)     │ PERMISSIONS DE : Commercial                          │
│               │                                                       │
│ ● Dirigeant   │ DEVIS                                                │
│ ● Admin       │ ☑ Voir les devis                                     │
│ ● Manager     │ ☑ Créer des devis                                    │
│ ► Commercial  │ ☑ Modifier des devis                                 │
│ ● Technicien  │ ☑ Envoyer des devis                                  │
│ ● Lecteur     │ ☐ Supprimer des devis                                │
│               │ ☑ Convertir en facture                               │
│               │                                                       │
│               │ FACTURES                                              │
│               │ ☑ Voir les factures                                  │
│               │ ☐ Créer des factures                    ← activable  │
│               │ ☐ Modifier des factures                              │
│               │ ☐ Envoyer des factures         ← l'owner peut cocher │
│               │ ☐ Enregistrer un paiement                            │
│               │                                                       │
│               │ [Sauvegarder les modifications]                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

- Clic sur un rôle → affiche ses permissions à droite
- Toggle sur chaque permission → sauvegardé immédiatement
- Rôle "Dirigeant" (is_system = true) → toutes les permissions grises (non modifiables)
- Bouton "+ Nouveau rôle" → crée un rôle custom avec un nom libre
- Rôle custom supprimable si aucun membre ne l'utilise

### Réassignation d'un utilisateur

```
Page /settings/team :
┌──────────────────────────────────────────────────────────────────────┐
│ Jean-Pierre Moreau    jp.moreau@email.com     [Commercial ▼] [Retirer]│
│ Marie Dupont          m.dupont@email.com      [Manager ▼]   [Retirer]│
└──────────────────────────────────────────────────────────────────────┘

Clic sur [Commercial ▼] → dropdown des rôles disponibles
→ Sélection → UPDATE memberships SET role_id = ... → toast "Rôle mis à jour"
→ Les nouvelles permissions s'appliquent à la prochaine action de l'utilisateur
```

---

## SECTION 6 — FONCTIONS ET TRIGGERS

```sql
-- Trigger : profil auto à l'inscription
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Trigger : updated_at auto (sur toutes les tables principales)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Trigger : mise à jour totaux client après paiement
CREATE OR REPLACE FUNCTION update_client_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clients SET
    total_revenue = (
      SELECT COALESCE(SUM(total_ttc), 0) FROM invoices
      WHERE client_id = NEW.client_id
        AND status NOT IN ('cancelled', 'refunded')
        AND is_archived = false
    ),
    total_paid = (
      SELECT COALESCE(SUM(p.amount), 0)
      FROM payments p JOIN invoices i ON p.invoice_id = i.id
      WHERE i.client_id = NEW.client_id
    )
  WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_client_totals
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_client_totals();

-- Fonction : numéro de devis séquentiel
CREATE OR REPLACE FUNCTION generate_quote_number(org_id UUID)
RETURNS TEXT AS $$
DECLARE next_num INT; org_prefix TEXT;
BEGIN
  UPDATE organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;
  RETURN org_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Idem : generate_invoice_number(org_id UUID)
```

---

## SECTION 7 — ORDRE DE MIGRATION

```
001_extensions.sql
002_profiles.sql
003_organizations.sql
004_roles.sql
005_permissions.sql
006_role_permissions.sql
007_memberships.sql
008_invitations.sql
009_clients.sql                       ← V1.3 : +custom_fields JSONB
010_materials.sql                     ← V1.3 : +custom_fields JSONB
011_labor_rates.sql                   ← V1.3 : +custom_fields JSONB
012_quotes.sql
013_quote_sections.sql
014_quote_items.sql
015_invoices.sql                      ← V1.3 : +facturx_xml, +pa_status, etc.
016_invoice_items.sql                 ← V1.3 : +vat_rate, +vat_amount
017_payments.sql
018_reminders.sql
019_saved_templates.sql
020_company_memory.sql
021_goals.sql
022_email_templates.sql
023_import_jobs.sql
024_activity_log.sql
025_recurring_invoices.sql            ← NOUVEAU V1.3
026_recurring_invoice_items.sql       ← NOUVEAU V1.3
027_invoice_schedules.sql             ← NOUVEAU V1.3
028_received_invoices.sql             ← NOUVEAU V1.3
029_pa_status_events.sql              ← NOUVEAU V1.3
030_rls_policies.sql
031_triggers.sql                      ← V1.3 : +trigger_compute_vat
032_functions.sql
033_seed_roles.sql
034_seed_permissions.sql              ← V1.3 : +5 permissions PA + 2 permissions factures récurrentes
035_seed_role_permissions.sql
036_seed_sector.sql
037_seed_email_templates.sql          ← V1.3 : +template notif confirmation facture récurrente
```

---

## SECTION 8 — DONNÉES SENSIBLES (RGPD)

**PII :** `profiles.email`, `profiles.full_name`, `profiles.phone`, `clients.email`, `clients.phone`, `clients.first_name`, `clients.last_name`, `clients.siret`

**Anonymisation à la suppression :**
```sql
UPDATE profiles SET
  full_name = 'Utilisateur supprimé',
  email = 'deleted_' || id || '@deleted.invalid',
  phone = NULL
WHERE id = [user_id];
-- memberships désactivé mais conservé pour l'audit
UPDATE memberships SET is_active = false WHERE user_id = [user_id];
```

**Jamais dans les logs Vercel :** montants des factures, emails clients, données personnelles.
