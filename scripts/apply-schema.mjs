#!/usr/bin/env node
// scripts/apply-schema.mjs — Couche A du provisioning (voir docs/souverainete-donnees/)
//
// Applique les migrations de supabase/migrations/ contre N'IMPORTE QUELLE
// base Postgres accessible par chaîne de connexion directe : Supabase
// cloud, Supabase self-hosted, ou un Postgres managé quelconque. Aucune
// dépendance à l'API Management Supabase, volontairement : c'est la brique
// portable qui garantit qu'une sortie de Supabase reste praticable, pas
// seulement un outil de provisioning cloud (voir couche B, provision-client.mjs).
//
// Usage :
//   node scripts/apply-schema.mjs --db-url "postgresql://user:pass@host:5432/postgres" [--dry-run] [--include-roles]
//
// Le mot de passe doit être percent-encodé dans l'URL (contrainte de la
// CLI Supabase elle-même, cf. `supabase db push --help`).
//
// ── Testé réellement le 2026-09-09 contre un Postgres vierge (pgvector/
// pgvector:pg17 en Docker, sans rien d'autre) : 170 des 185 migrations
// passent une fois les prérequis PLATEFORME suivants posés (aucun n'est
// applicatif, tous relèvent de ce que Supabase/GoTrue/Storage fournissent
// nativement sur un projet cloud) :
//   - schémas `extensions` et `auth` ;
//   - une table minimale `auth.users(id uuid primary key)` (les FK
//     `references auth.users(id)` en ont besoin) ;
//   - les fonctions `auth.uid()` et `auth.role()` (stubs suffisent pour les
//     policies RLS, qui ne sont pas exercées par un simple push de schéma) ;
//   - les rôles Postgres `anon`, `authenticated`, `service_role` (utilisés
//     par les `GRANT`/`TO authenticated` des policies) ;
//   - au-delà de la migration 170, un vrai service Storage (fonctions comme
//     storage.foldername()) devient nécessaire — hors du périmètre de ce
//     script, qui n'installe QUE le schéma applicatif. Un self-hosted réel
//     tourne la stack Supabase complète (docker-compose officiel), qui
//     fournit tout cela nativement ; ce script n'a alors qu'à s'y brancher.
// Deux vrais bugs de migration ont été trouvés et corrigés à cette
// occasion (004_business_tables.sql : ADD CONSTRAINT IF NOT EXISTS n'est
// pas une syntaxe Postgres valide ; 008_rls.sql : référence de colonne
// ambiguë jamais rejouée depuis son écriture initiale). Voir le detail
// dans le commit correspondant et docs/souverainete-donnees/.
//
// Ce script est un enrobage autour de `supabase db push --db-url
// --include-all` — pas une réimplémentation :
//   - le bookkeeping des migrations déjà appliquées vit dans la table
//     supabase_migrations.schema_migrations de la base CIBLE elle-même
//     (donc déjà la source de vérité côté serveur, pas un état local
//     fragile qui pourrait désynchroniser -- voir la méthode "repair"
//     documentée en mémoire projet pour le cas où ça arrive quand même) ;
//   - --include-all est nécessaire car une base neuve n'a par définition
//     aucune ligne dans ce registre ;
//   - la commande tourne depuis un dossier TEMPORAIRE avec un
//     config.toml minimal généré par `supabase init`, jamais depuis la
//     racine du repo : le supabase/config.toml de ce projet contient une
//     clé ([local_smtp]) que les versions récentes de la CLI rejettent
//     purement et simplement (elles attendent [inbucket]) — un souci de
//     config locale de dev qui n'a aucun rapport avec le provisioning
//     distant, mais qui le bloque quand même si on ne l'isole pas ;
//   - --debug est passé à `supabase db push` : sans ce flag, la CLI a
//     échoué de façon répétée et déterministe avec "tls error (server
//     refused TLS connection)" contre un Postgres qui n'a pas de
//     certificat configuré (typiquement un self-hosted fraîchement monté,
//     ou tout Postgres nu de test) ; avec --debug, la connexion aboutit
//     systématiquement. Root cause non identifiée côté CLI (deux chemins
//     de code différents selon le flag, semble-t-il) — --debug produit
//     des logs volumineux en conséquence (protocole PG trame par trame),
//     redirigés vers un fichier plutôt qu'affichés en direct.
//
// Prérequis : CLI Supabase installée (`brew install supabase/tap/supabase`
// ou `npx supabase`), ce script appelle le binaire `supabase` du PATH.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const args = process.argv.slice(2)

function getFlag(name) {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1) return null
  return args[idx + 1] ?? null
}

function hasFlag(name) {
  return args.includes(`--${name}`)
}

const dbUrl = getFlag('db-url')
const dryRun = hasFlag('dry-run')
const includeRoles = hasFlag('include-roles')
const debugLogPath = getFlag('debug-log') ?? path.join(root, '.apply-schema-debug.log')

if (!dbUrl) {
  console.error('Usage: node scripts/apply-schema.mjs --db-url "postgresql://..." [--dry-run] [--include-roles] [--debug-log <path>]')
  console.error('')
  console.error('Le mot de passe doit être percent-encodé (ex: @ devient %40).')
  process.exit(1)
}

const migrationsDir = path.join(root, 'supabase', 'migrations')
if (!existsSync(migrationsDir)) {
  console.error(`Dossier de migrations introuvable : ${migrationsDir}`)
  console.error('Ce script doit être lancé depuis la racine du projet.')
  process.exit(1)
}

console.log('=== Couche A — application du schéma ===')
console.log(`Cible     : ${dbUrl.replace(/:[^:@]*@/, ':***@')}`) // masque le mot de passe dans les logs
console.log(`Migrations: ${migrationsDir}`)
console.log(`Mode      : ${dryRun ? 'dry-run (aucune écriture)' : 'application réelle'}`)
console.log('')

// Dossier de travail temporaire, isolé du config.toml du repo (voir
// commentaire en tête de fichier). Nettoyé en fin de script quoi qu'il
// arrive.
const workDir = mkdtempSync(path.join(tmpdir(), 'atelier-apply-schema-'))

function cleanup() {
  try { rmSync(workDir, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

const initResult = spawnSync('supabase', ['init', '--force'], { cwd: workDir, stdio: 'pipe' })
if (initResult.status !== 0) {
  console.error('[apply-schema] Échec de `supabase init` dans le dossier temporaire :')
  console.error(initResult.stderr?.toString() ?? initResult.stdout?.toString() ?? '(pas de sortie)')
  process.exit(1)
}

const workMigrationsDir = path.join(workDir, 'supabase', 'migrations')
rmSync(workMigrationsDir, { recursive: true, force: true })
mkdirSync(path.dirname(workMigrationsDir), { recursive: true })
cpSync(migrationsDir, workMigrationsDir, { recursive: true })

// 1. État actuel de la cible, avant toute écriture — utile pour un
//    provisioning qui reprend après échec (idempotence) : si la table
//    supabase_migrations existe déjà avec des lignes, ce n'est pas une
//    base vierge.
const listResult = spawnSync('supabase', ['migration', 'list', '--db-url', dbUrl, '--debug'], {
  cwd: workDir,
  stdio: ['inherit', 'pipe', 'pipe'],
})
writeFileSync(debugLogPath, (listResult.stdout ?? '') + (listResult.stderr ?? ''))
console.log(listResult.stdout?.toString().split('\n').filter(l => !l.startsWith('20')).join('\n') ?? '')

if (listResult.status !== 0 && listResult.status !== null) {
  console.warn('[apply-schema] Impossible de lister les migrations existantes (base neuve probable, ou vraie erreur de connexion — voir ' + debugLogPath + '). On continue vers db push.')
}

console.log('')

// 2. Application effective.
const pushArgs = ['db', 'push', '--db-url', dbUrl, '--include-all', '--yes', '--debug']
if (dryRun) pushArgs.push('--dry-run')
if (includeRoles) pushArgs.push('--include-roles')

const pushResult = spawnSync('supabase', pushArgs, {
  cwd: workDir,
  stdio: ['inherit', 'pipe', 'pipe'],
})
const pushLog = (pushResult.stdout ?? '') + (pushResult.stderr ?? '')
writeFileSync(debugLogPath, pushLog, { flag: 'a' })
// Ne remonte à l'écran que les lignes utiles (Applying migration / ERROR),
// le détail protocole PG complet reste dans le fichier de log.
console.log(
  pushLog
    .toString()
    .split('\n')
    .filter(l => /^Applying migration|^ERROR|^At statement|^Connecting/.test(l.trim()))
    .join('\n'),
)

if (pushResult.status !== 0) {
  console.error(`\n[apply-schema] Échec de db push (détail complet : ${debugLogPath}).`)
  console.error('La base cible peut être dans un état partiel — ne pas relancer aveuglément :')
  console.error('inspecter la dernière migration listée avant l\'erreur avant de reprendre.')
  console.error('Si l\'erreur porte sur un schéma/rôle/fonction absent (extensions, auth, storage,')
  console.error('anon/authenticated/service_role...), c\'est un prérequis plateforme Supabase à')
  console.error('poser en amont, pas un bug de migration — voir le commentaire en tête de ce fichier.')
  process.exit(pushResult.status ?? 1)
}

console.log('\n=== Terminé ===')
if (dryRun) {
  console.log('Dry-run : aucune modification appliquée. Relancer sans --dry-run pour appliquer.')
} else {
  console.log('Migrations appliquées. Vérifier avec : supabase migration list --db-url "..." --debug')
}
