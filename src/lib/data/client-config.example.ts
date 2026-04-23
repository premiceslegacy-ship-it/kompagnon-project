// ============================================================
// client-config.example.ts — Template de configuration client
// ============================================================
//
// USAGE : Copier ce fichier → remplir pour chaque nouveau client
//         → utiliser avec le script de seed pour initialiser la DB
//
// Ce fichier N'EST PAS importé par l'application en production.
// Les données sont stockées en DB (table organizations) et éditables
// depuis Paramètres > Entreprise dans l'interface.
//
// WORKFLOW DÉPLOIEMENT :
//   1. Remplir ce fichier avec les informations du client
//   2. Exécuter : npx tsx scripts/seed-client.ts [ce-fichier]
//   3. Le script insère tout en DB et crée le compte owner
// ============================================================

import type { SectorId } from '@/lib/data/sector-templates'

export type ClientConfig = {
  // ── Identité légale ──────────────────────────────────────────
  name: string                  // Raison sociale complète
  display_name: string          // Nom affiché dans l'app (peut être raccourci)
  siret: string                 // 14 chiffres sans espace
  siren: string                 // 9 premiers chiffres du SIRET
  vat_number: string            // Ex: FR12123456789
  forme_juridique: string       // SAS | SARL | EI | EURL | SA | SNC | SASU
  capital_social: string        // Ex: "10 000 €" (TEXT, affiché sur les PDFs)
  rcs: string                   // Ex: "123 456 789"
  rcs_ville: string             // Ex: "Versailles"
  naf_code: string              // Ex: "4321A"
  court_competent: string       // Ex: "Tribunal de commerce de Versailles"

  // ── Contact ──────────────────────────────────────────────────
  email: string                 // Email principal de l'entreprise
  phone: string                 // Ex: "01 23 45 67 89"
  website?: string              // Ex: "www.dupont-btp.fr"

  // ── Adresse ──────────────────────────────────────────────────
  address_line1: string
  address_line2?: string
  city: string
  postal_code: string
  country: string               // ISO 2 lettres — ex: "FR"

  // ── Secteur ──────────────────────────────────────────────────
  sector: SectorId              // Doit correspondre à un secteur dans sector-templates/
  certifications: string[]      // Ex: ["RGE", "Qualibat 7131", "Qualibat 2111"]
  insurance_info: string        // Ex: "AXA Pro — Police RC décennale n° 12345678"

  // ── Branding ─────────────────────────────────────────────────
  primary_color: string         // Hex — Ex: "#2563eb"
  logo_url?: string             // URL publique ou chemin /public/logo.svg
  email_from_name: string       // Ex: "Dupont BTP"
  email_from_address: string    // Ex: "contact@dupont-btp.fr" (vérifiée sur Resend)

  // ── Paramètres comptables ────────────────────────────────────
  default_vat_rate: number      // 20 | 10 | 5.5 selon secteur
  quote_prefix: string          // Ex: "DEV" → DEV-2026-0001
  invoice_prefix: string        // Ex: "FAC" → FAC-2026-0001
  last_quote_number: number     // Dernier numéro utilisé (pour continuité)
  last_invoice_number: number   // Dernier numéro utilisé (pour continuité)
  payment_terms_days: number    // 30 | 45 | 60
  late_penalty_rate: number     // % pénalités retard — ex: 12 (= 3 × taux BCE)
  currency: string              // "EUR"

  // ── Owner (premier utilisateur) ─────────────────────────────
  owner: {
    email: string               // Email de connexion
    full_name: string           // Prénom Nom affiché dans l'app
    phone?: string
    job_title?: string          // Ex: "Gérant", "Directeur général"
  }

  // ── Objectifs CA ─────────────────────────────────────────────
  goals?: {
    annual_target: number       // CA annuel cible en €
    monthly_targets?: Record<string, number>  // {"1": 80000, "2": 90000, ...}
    visibility: 'all' | 'managers_only' | 'owner_only'
  }

  // ── Relances automatiques ────────────────────────────────────
  reminders?: {
    enabled: boolean
    invoice_reminder_days: number[]   // Ex: [2, 7] — J+2, J+7 après échéance
    quote_reminder_days: number[]     // Ex: [3, 10] — J+3, J+10 après envoi
  }

  // ── Facturation électronique (optionnel, activer en 2026) ────
  facturx?: {
    enabled: boolean
    bank_iban: string           // Ex: "FR76 1234 5678 9012 3456 7890 123"
    bank_bic: string            // Ex: "BNPAFRPP"
    bank_name: string           // Ex: "BNP Paribas"
  }
}

// ────────────────────────────────────────────────────────────────────────────
// EXEMPLE REMPLI — À remplacer par les données réelles du client
// ────────────────────────────────────────────────────────────────────────────

export const CLIENT_CONFIG: ClientConfig = {
  // Identité
  name: 'Dupont BTP SARL',
  display_name: 'Dupont BTP',
  siret: '12345678900012',
  siren: '123456789',
  vat_number: 'FR12123456789',
  forme_juridique: 'SARL',
  capital_social: '15 000 €',
  rcs: '123 456 789',
  rcs_ville: 'Versailles',
  naf_code: '4321A',
  court_competent: 'Tribunal de commerce de Versailles',

  // Contact
  email: 'contact@dupont-btp.fr',
  phone: '01 23 45 67 89',
  website: 'www.dupont-btp.fr',

  // Adresse
  address_line1: '12 rue du Chantier',
  city: 'Versailles',
  postal_code: '78000',
  country: 'FR',

  // Secteur
  sector: 'renovation',
  certifications: ['RGE', 'Qualibat 7131'],
  insurance_info: 'AXA Pro — RC Décennale n° 12345678 / RC Pro n° 87654321',

  // Branding
  primary_color: '#2563eb',
  logo_url: '/logo.svg',
  email_from_name: 'Dupont BTP',
  email_from_address: 'contact@dupont-btp.fr',

  // Comptabilité
  default_vat_rate: 10,
  quote_prefix: 'DEV',
  invoice_prefix: 'FAC',
  last_quote_number: 0,     // 0 si nouveau client, sinon dernier numéro existant
  last_invoice_number: 0,
  payment_terms_days: 30,
  late_penalty_rate: 12,
  currency: 'EUR',

  // Owner
  owner: {
    email: 'martin.dupont@dupont-btp.fr',
    full_name: 'Martin Dupont',
    phone: '06 12 34 56 78',
    job_title: 'Gérant',
  },

  // Objectifs
  goals: {
    annual_target: 480000,
    visibility: 'all',
  },

  // Relances auto
  reminders: {
    enabled: true,
    invoice_reminder_days: [2, 7],
    quote_reminder_days: [3, 10],
  },
}
