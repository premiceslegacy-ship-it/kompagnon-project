-- ============================================================
-- SEED DÉMO — Weber Tôlerie
-- org_id : b10bb73a-0ee8-4a84-9eca-1e9f1c732f40
-- À exécuter dans SQL Editor du projet Supabase
-- ============================================================

DO $$
DECLARE
  org_id UUID := 'b10bb73a-0ee8-4a84-9eca-1e9f1c732f40';

  -- Clients
  c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID;

  -- Devis
  q1 UUID; q2 UUID; q3 UUID; q4 UUID; q5 UUID; q6 UUID;

  -- Sections
  s UUID;

  -- Factures
  inv1 UUID; inv2 UUID; inv3 UUID; inv4 UUID;

BEGIN

-- ── 1. Mise à jour organisation ──────────────────────────────────────────────
UPDATE public.organizations SET
  siret             = '48312567800024',
  vat_number        = 'FR12483125678',
  email             = 'contact@weber-tolerie.fr',
  phone             = '04 72 18 36 90',
  address_line1     = '12 Rue de l''Industrie',
  city              = 'Lyon',
  postal_code       = '69007',
  country           = 'France',
  forme_juridique   = 'SARL',
  capital_social    = '15 000 €',
  rcs               = '483 125 678',
  rcs_ville         = 'Lyon',
  insurance_info    = 'Allianz Pro BTP n° ALZ-PRO-2021-774',
  default_vat_rate  = 20,
  currency          = 'EUR',
  payment_terms_days = 30,
  late_penalty_rate  = 10,
  court_competent    = 'Tribunal de commerce de Lyon',
  iban              = 'FR76 1027 8060 0001 2345 6789 142',
  bic               = 'CMCIFR2A',
  bank_name         = 'Crédit Mutuel'
WHERE id = org_id;

-- ── 2. Clients ────────────────────────────────────────────────────────────────
INSERT INTO public.clients (id, organization_id, company_name, contact_name, email, phone, address_line1, city, postal_code, siren, notes)
VALUES
  (gen_random_uuid(), org_id, 'Groupe Deschamps Industrie', 'Marc Deschamps', 'samuelmbe41@gmail.com',       '04 78 22 14 55', '8 Avenue des Frères Lumière',  'Lyon',        '69008', '512 346 789', 'Client fidèle depuis 2019 — chantiers réguliers bardage industriel'),
  (gen_random_uuid(), org_id, 'SNCM Logistique',            'Isabelle Renard', 'i.renard@sncm-logistique.fr', '04 72 56 88 10', '45 Rue du Port Édouard Herriot', 'Lyon',        '69002', '329 871 456', 'Entrepôts frigorifiques — exige joints d''étanchéité renforcés'),
  (gen_random_uuid(), org_id, 'Promoteur Rhône Habitat',    'Julien Marchand', 'j.marchand@rhone-habitat.fr', '04 78 93 02 67', '3 Place Bellecour',              'Lyon',        '69002', '741 258 963', 'Promoteur — appels d''offres bardage façade logements neufs'),
  (gen_random_uuid(), org_id, 'Atelier Bonnefoy Métaux',    'Pierre Bonnefoy', 'pbonnefoy@bonnefoy-metaux.fr','04 77 31 44 89', '22 Rue Bergson',                 'Saint-Étienne','42100', '185 632 741', 'Sous-traitant — travaux couverture zinc et acier galvanisé'),
  (gen_random_uuid(), org_id, 'Mairie de Décines-Charpieu', 'Service Technique','technique@mairie-decines.fr', '04 78 49 11 00', 'Place du 8 Mai 1945',           'Décines',     '69150', '200 023 601', 'Marché public — réfection toiture gymnase municipal')
RETURNING id INTO c1;

-- Récupérer les IDs dans l'ordre
SELECT id INTO c1 FROM public.clients WHERE organization_id = org_id AND company_name = 'Groupe Deschamps Industrie';
SELECT id INTO c2 FROM public.clients WHERE organization_id = org_id AND company_name = 'SNCM Logistique';
SELECT id INTO c3 FROM public.clients WHERE organization_id = org_id AND company_name = 'Promoteur Rhône Habitat';
SELECT id INTO c4 FROM public.clients WHERE organization_id = org_id AND company_name = 'Atelier Bonnefoy Métaux';
SELECT id INTO c5 FROM public.clients WHERE organization_id = org_id AND company_name = 'Mairie de Décines-Charpieu';

-- ── 3. Devis ──────────────────────────────────────────────────────────────────

-- Devis 1 — Accepté (Deschamps, bardage acier)
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date, sent_at, accepted_at, notes_client)
VALUES (gen_random_uuid(), org_id, c1, 'DEV-2026-001', 'Bardage acier galvanisé — Entrepôt B', 'accepted',
  48600, 58320, '2026-04-30', '2026-02-10', '2026-02-18',
  'Pose bardage acier galvanisé sur ossature aluminium. Teinte RAL 7016 anthracite.')
RETURNING id INTO q1;

-- Sections devis 1
INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q1, 'Ossature et fixations', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q1, s, 'Montants aluminium 40×60 mm', 180, 'ml', 12.50, 20),
  (q1, s, 'Chevrons de calage galvanisés', 96,  'u',  8.90,  20),
  (q1, s, 'Visserie inox A4',             12,  'kg', 18.00, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q1, 'Bardage acier galvanisé', 2) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q1, s, 'Bac acier galvanisé e=0,75mm RAL 7016', 520, 'm2', 42.00, 20),
  (q1, s, 'Bande de rive et faîtage',               85,  'ml', 22.00, 20),
  (q1, s, 'Joint mousse préformé',                  85,  'ml',  4.50, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q1, 'Main d''œuvre pose', 3) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q1, s, 'Pose bardage (équipe 3 personnes)', 160, 'h', 48.00, 20),
  (q1, s, 'Déplacement et installation chantier', 1, 'forfait', 850.00, 20);

-- Devis 2 — Envoyé (SNCM, couverture zinc)
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date, sent_at)
VALUES (gen_random_uuid(), org_id, c2, 'DEV-2026-002', 'Réfection couverture zinc — Entrepôt frigorifique', 'sent',
  31400, 37680, '2026-04-15', '2026-03-05')
RETURNING id INTO q2;

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q2, 'Dépose et évacuation', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q2, s, 'Dépose ancienne couverture fibrociment', 340, 'm2', 18.00, 20),
  (q2, s, 'Évacuation déchets en benne agréée',      1,  'forfait', 1200.00, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q2, 'Couverture zinc naturel', 2) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q2, s, 'Zinc naturel e=0,65mm (double agrafure)',  340, 'm2', 52.00, 20),
  (q2, s, 'Solins et noues zinc',                      48, 'ml', 38.00, 20),
  (q2, s, 'Chéneaux zinc développé 400mm',             62, 'ml', 85.00, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q2, 'Main d''œuvre', 3) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q2, s, 'Pose couverture zinc (couvreur qualifié)', 120, 'h', 55.00, 20);

-- Devis 3 — Brouillon (Rhône Habitat, façade logements)
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date)
VALUES (gen_random_uuid(), org_id, c3, 'DEV-2026-003', 'Bardage façade — Résidence Les Acacias (48 logements)', 'draft',
  87500, 105000, '2026-05-31')
RETURNING id INTO q3;

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q3, 'Isolation thermique par l''extérieur', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q3, s, 'Laine de roche 120mm (λ=0,035)',  820, 'm2', 32.00, 20),
  (q3, s, 'Rail oméga inox 50mm',            960, 'ml',  6.80, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q3, 'Bardage aluminium laqué', 2) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q3, s, 'Lames aluminium 200mm laquées RAL 9006', 820, 'm2', 68.00, 20),
  (q3, s, 'Profilés de départ et finition',          85, 'ml', 24.00, 20);

-- Devis 4 — Refusé
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date, sent_at)
VALUES (gen_random_uuid(), org_id, c4, 'DEV-2025-018', 'Couverture bac acier — hangar agricole', 'refused',
  14200, 17040, '2026-01-15', '2025-12-20')
RETURNING id INTO q4;

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q4, 'Couverture bac acier', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q4, s, 'Bac acier nervuré 63/400 galvanisé', 280, 'm2', 28.00, 20),
  (q4, s, 'Pose et fournitures',                  1,  'forfait', 6240.00, 20);

-- Devis 5 — Accepté (Mairie, toiture gymnase)
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date, sent_at, accepted_at)
VALUES (gen_random_uuid(), org_id, c5, 'DEV-2026-005', 'Réfection toiture gymnase municipal — lot couverture', 'accepted',
  62800, 75360, '2026-04-30', '2026-02-28', '2026-03-15')
RETURNING id INTO q5;

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q5, 'Dépose couverture existante', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q5, s, 'Dépose plaques fibrociment amiante (entreprise agréée)', 480, 'm2', 45.00, 20),
  (q5, s, 'Bilan déchets et certificat élimination', 1, 'forfait', 2400.00, 20);

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q5, 'Nouvelle couverture bac acier', 2) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q5, s, 'Bac acier 75/333 prélaqué RAL 7040', 480, 'm2',  38.00, 20),
  (q5, s, 'Complexe isolant 80mm (R=3,45)',      480, 'm2',  22.00, 20),
  (q5, s, 'Chéneaux et descentes EP zinc',        64, 'ml',  95.00, 20),
  (q5, s, 'Main d''œuvre pose et coordination',   1,  'forfait', 8800.00, 20);

-- Devis 6 — Envoyé récent (Deschamps, extension)
INSERT INTO public.quotes (id, organization_id, client_id, number, title, status, total_ht, total_ttc, validity_date, sent_at)
VALUES (gen_random_uuid(), org_id, c1, 'DEV-2026-006', 'Extension bardage — Atelier C nord', 'sent',
  22400, 26880, '2026-04-20', '2026-03-18')
RETURNING id INTO q6;

INSERT INTO public.quote_sections (id, quote_id, title, position) VALUES (gen_random_uuid(), q6, 'Bardage bac acier laqué', 1) RETURNING id INTO s;
INSERT INTO public.quote_items (quote_id, section_id, description, quantity, unit, unit_price, vat_rate) VALUES
  (q6, s, 'Bac acier nervuré laqué RAL 5015 (bleu ciel)', 240, 'm2', 46.00, 20),
  (q6, s, 'Ossature acier galvanisé',                     180, 'ml', 14.00, 20),
  (q6, s, 'Pose et finitions',                              1,  'forfait', 4640.00, 20);

-- ── 4. Factures ───────────────────────────────────────────────────────────────

-- Facture 1 — Payée (Deschamps, acompte 30%)
INSERT INTO public.invoices (id, organization_id, client_id, number, title, status, total_ht, total_ttc, currency, due_date, sent_at, paid_at, payment_conditions)
VALUES (gen_random_uuid(), org_id, c1, 'FAC-2026-001', 'Acompte 30% — Bardage entrepôt B', 'paid',
  14580, 17496, 'EUR', '2026-03-10', '2026-02-20', '2026-03-08',
  'Acompte de 30% à la commande. Solde à réception des travaux.')
RETURNING id INTO inv1;
INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, vat_rate)
VALUES (inv1, 'Acompte 30% — DEV-2026-001 Bardage acier galvanisé entrepôt B', 1, 14580, 20);

-- Facture 2 — Payée (Mairie)
INSERT INTO public.invoices (id, organization_id, client_id, number, title, status, total_ht, total_ttc, currency, due_date, sent_at, paid_at)
VALUES (gen_random_uuid(), org_id, c5, 'FAC-2026-002', 'Acompte 40% — Toiture gymnase', 'paid',
  25120, 30144, 'EUR', '2026-04-01', '2026-03-18', '2026-03-28')
RETURNING id INTO inv2;
INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, vat_rate)
VALUES (inv2, 'Acompte 40% — DEV-2026-005 Réfection toiture gymnase municipal', 1, 25120, 20);

-- Facture 3 — Envoyée, en attente (SNCM — ancienne facture)
INSERT INTO public.invoices (id, organization_id, client_id, number, title, status, total_ht, total_ttc, currency, due_date, sent_at)
VALUES (gen_random_uuid(), org_id, c2, 'FAC-2025-047', 'Travaux étanchéité toiture — Quai 3', 'sent',
  18600, 22320, 'EUR', '2026-01-31', '2026-01-10')
RETURNING id INTO inv3;
INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, vat_rate)
VALUES
  (inv3, 'Membrane EPDM 1,5mm — 310 m²',            310, 38.00, 20),
  (inv3, 'Relevés d''étanchéité acier inox',          42, 95.00, 20),
  (inv3, 'Main d''œuvre pose équipe 2 (64h)',           1, 3712.00, 20);

-- Facture 4 — Brouillon (solde Deschamps à venir)
INSERT INTO public.invoices (id, organization_id, client_id, number, title, status, total_ht, total_ttc, currency, due_date)
VALUES (gen_random_uuid(), org_id, c1, 'FAC-2026-004', 'Solde 70% — Bardage entrepôt B', 'draft',
  34020, 40824, 'EUR', '2026-05-15')
RETURNING id INTO inv4;
INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, vat_rate)
VALUES (inv4, 'Solde 70% — DEV-2026-001 Bardage acier galvanisé entrepôt B', 1, 34020, 20);

-- ── 5. Catalogue matériaux tôlerie ────────────────────────────────────────────
INSERT INTO public.materials (organization_id, name, description, unit, unit_price, vat_rate, category, reference)
VALUES
  (org_id, 'Bac acier galvanisé 0,75mm',        'Bac nervuré 63/400 galvanisé thermolaqué',         'm2',      32.00, 20, 'Couverture',  'BAC-GAL-075'),
  (org_id, 'Bac acier prélaqué RAL au choix',   'Bac nervuré 75/333 prélaqué, épaisseur 0,63mm',    'm2',      38.00, 20, 'Couverture',  'BAC-RAL-063'),
  (org_id, 'Zinc naturel 0,65mm',               'Feuille zinc naturel double agrafure',              'm2',      52.00, 20, 'Couverture',  'ZINC-065'),
  (org_id, 'Lame aluminium bardage 200mm',       'Lame aluminium laquée, largeur utile 200mm',       'm2',      68.00, 20, 'Bardage',     'ALU-LAME-200'),
  (org_id, 'Montant aluminium 40×60',            'Ossature aluminium extrudé 40×60mm',               'ml',      12.50, 20, 'Ossature',    'ALU-4060'),
  (org_id, 'Rail oméga inox 50mm',              'Rail oméga acier inox 50mm pour ITE',              'ml',       6.80, 20, 'Ossature',    'OMEGA-50'),
  (org_id, 'Membrane EPDM 1,5mm',               'Membrane EPDM pour étanchéité toiture terrasse',   'm2',      38.00, 20, 'Étanchéité',  'EPDM-15'),
  (org_id, 'Laine de roche 120mm',              'Panneau laine de roche λ=0,035 pour ITE',          'm2',      32.00, 20, 'Isolation',   'LR-120'),
  (org_id, 'Chéneau zinc dév. 400mm',            'Chéneau pendante zinc naturel développé 400mm',    'ml',      85.00, 20, 'Évacuation',  'CHEN-ZINC-400'),
  (org_id, 'Solin zinc',                         'Solin zinc naturel pour raccord maçonnerie',       'ml',      38.00, 20, 'Étanchéité',  'SOL-ZINC');

INSERT INTO public.labor_rates (organization_id, name, description, hourly_rate, vat_rate, category)
VALUES
  (org_id, 'Tôlier-couvreur N3',      'Main d''œuvre tôlier couvreur niveau 3',    52.00, 20, 'Main d''œuvre'),
  (org_id, 'Tôlier-couvreur N4',      'Main d''œuvre tôlier couvreur niveau 4',    58.00, 20, 'Main d''œuvre'),
  (org_id, 'Chef d''équipe',          'Chef d''équipe couverture-bardage',          68.00, 20, 'Main d''œuvre'),
  (org_id, 'Conducteur de travaux',   'Conducteur de travaux (demi-journée)',      420.00, 20, 'Encadrement');

RAISE NOTICE 'Seed Weber Tôlerie terminé — org_id: %', org_id;

END $$;
