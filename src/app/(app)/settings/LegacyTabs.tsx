'use client'
// Contenu des onglets pas encore migrés (ancien habillage) : retiré au fur et à mesure des lots.

import { useState } from 'react'
import Link from 'next/link'

import { Trash2, Copy, Check, ExternalLink, Package, RefreshCw, ShieldCheck } from 'lucide-react'

import { requestAccountDeletion, cancelAccountDeletion } from '@/lib/data/mutations/account-deletion'

import ExportComptableModal from '@/components/ExportComptableModal'

import { LANDING_LEGAL_SNIPPETS, LEGAL_PATHS } from '@/lib/legal'

import type { SettingsState } from './useSettings'

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    function handleCopy() {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }
    return (
        <button
            onClick={handleCopy}
            className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-all ${copied ? 'bg-green-500/10 border-green-500/30 text-green-500' : 'bg-base dark:bg-white/5 border-[var(--elevation-border)] text-secondary hover:text-accent hover:border-accent'}`}
            title="Copier"
        >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
    )
}

export function LegacyTabContent({ q }: { q: SettingsState }) {
    const { organization, organizationExports, router, activeTab, isPending, memories, deletingMemoryId, memoriesPage, setMemoriesPage, memoriesPageCount, memoriesPageItems, handleDeleteMemory, memoryTypeLabel, exportSaveStatus, exportFeedback, showExportComptableModal, setShowExportComptableModal, deletionStep, setDeletionStep, deletionConfirmText, setDeletionConfirmText, deletionStatus, setDeletionStatus, deletionError, setDeletionError, cancelDeletionStatus, setCancelDeletionStatus, isOwner, isAdmin, hasProcessingExport, formatExportDate, formatFileSize, exportStatusBadge, exportStatusLabel, handleCreateOrganizationExport } = q
    const renderContent = () => {
        if (activeTab === 'confidentialite') {
            return (
                <div className="space-y-6">
                    <div className="rounded-3xl card p-8 space-y-8">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                            <div>
                                <h2 className="text-2xl font-bold text-primary mb-1">Données & confidentialité</h2>
                                <p className="text-sm text-secondary max-w-2xl">
                                    Consultez nos engagements concernant la gestion et la protection de vos données métier et personnelles.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-[var(--elevation-border)] bg-base/60 dark:bg-white/5 p-4 min-w-[240px]">
                                <p className="text-xs font-bold uppercase tracking-wider text-secondary">Pages publiques</p>
                                <div className="mt-3 flex flex-col gap-2 text-sm">
                                    <Link href={LEGAL_PATHS.privacy} target="_blank" className="text-primary hover:text-accent transition-colors">
                                        Politique de confidentialité
                                    </Link>
                                    <Link href={LEGAL_PATHS.terms} target="_blank" className="text-primary hover:text-accent transition-colors">
                                        Conditions d&apos;utilisation
                                    </Link>
                                    <Link href={LEGAL_PATHS.legal} target="_blank" className="text-primary hover:text-accent transition-colors">
                                        Mentions légales
                                    </Link>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-3">
                            {LANDING_LEGAL_SNIPPETS.map((snippet) => (
                                <div key={snippet.title} className="rounded-2xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{snippet.title}</p>
                                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300">{snippet.body}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Export comptable ──────────────────────────────────── */}
                    <div className="rounded-3xl card p-8 space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Export comptable</h2>
                            <p className="text-sm text-secondary max-w-2xl">
                                Exportez vos factures au format FEC (Fichier des Ecritures Comptables) pour votre comptable ou en cas de contrôle fiscal, ou en CSV simplifié pour Excel.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5 space-y-4">
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-primary">FEC et CSV comptable</p>
                                    <p className="mt-2 text-sm leading-6 text-secondary max-w-3xl">
                                        Générez un fichier FEC conforme (art. A. 47 A-1 LPF) ou un CSV Excel par période. Réservé aux rôles Administrateur et Propriétaire.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-[var(--elevation-border)] bg-white dark:bg-black/40 px-4 py-3 min-w-[220px]">
                                    <p className="text-xs font-bold uppercase tracking-wider text-secondary">Accès</p>
                                    <p className="mt-1 text-sm font-semibold text-primary">{isAdmin ? 'Autorisé' : 'Réservé à l\'administrateur'}</p>
                                </div>
                            </div>
                            {isAdmin ? (
                                <button
                                    onClick={() => setShowExportComptableModal(true)}
                                    className="px-6 py-3 rounded-full font-bold flex items-center gap-2 bg-accent text-black shadow-lg shadow-accent/20 hover:scale-105 transition-all"
                                >
                                    Exporter mes factures
                                </button>
                            ) : (
                                <div className="rounded-2xl border border-[var(--elevation-border)] bg-white dark:bg-black/40 px-4 py-3 text-sm text-secondary">
                                    Seul un administrateur peut générer un export comptable.
                                </div>
                            )}
                        </div>
                    </div>

                    {showExportComptableModal && (
                        <ExportComptableModal
                            isVatSubject={organization?.is_vat_subject ?? false}
                            isMicro={!(organization?.is_vat_subject ?? true) && !organization?.business_profile}
                            tvaLabel={
                                !organization?.is_vat_subject
                                    ? 'Franchise TVA art. 293 B CGI'
                                    : (organization?.tva_sur_debits
                                        ? 'TVA sur débits'
                                        : 'TVA sur encaissements')
                            }
                            nafCode={null}
                            siren={organization?.siren ?? null}
                            onClose={() => setShowExportComptableModal(false)}
                        />
                    )}

                    {/* ── Mémoire des assistants IA (chantier 7 point 4) ────── */}
                    <div className="rounded-3xl card p-8 space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Mémoire des assistants IA</h2>
                            <p className="text-sm text-secondary max-w-2xl">
                                Les informations que vos assistants IA ont retenues au fil des conversations et des devis (préférences client, prix corrigés, habitudes). Vous pouvez en supprimer un élément à tout moment. Les entrées non revues depuis 6 mois sont automatiquement recyclées.
                            </p>
                        </div>

                        {memories.length === 0 ? (
                            <div className="rounded-2xl border border-[var(--elevation-border)] bg-base/60 dark:bg-white/5 p-5 text-sm text-secondary">
                                Aucun élément mémorisé pour le moment.
                            </div>
                        ) : (
                            <>
                                <div className="rounded-2xl border border-[var(--elevation-border)] divide-y divide-[var(--elevation-border)] overflow-hidden">
                                    {memoriesPageItems.map(memory => (
                                        <div key={memory.id} className="flex items-start justify-between gap-4 p-4">
                                            <div className="min-w-0">
                                                <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
                                                    {memoryTypeLabel(memory.type, memory.metadata)}
                                                </span>
                                                <p className="text-sm text-primary mt-1 break-words">{memory.content}</p>
                                                <p className="text-xs text-secondary mt-1">{new Date(memory.created_at).toLocaleDateString('fr-FR')}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteMemory(memory.id)}
                                                disabled={deletingMemoryId === memory.id}
                                                className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50 flex-shrink-0 mt-0.5"
                                            >
                                                Supprimer
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {memoriesPageCount > 1 && (
                                    <div className="flex items-center justify-between text-sm">
                                        <button
                                            type="button"
                                            onClick={() => setMemoriesPage(p => Math.max(0, p - 1))}
                                            disabled={memoriesPage === 0}
                                            className="font-semibold text-secondary hover:text-primary disabled:opacity-40 disabled:hover:text-secondary"
                                        >
                                            Précédent
                                        </button>
                                        <span className="text-secondary">Page {memoriesPage + 1} sur {memoriesPageCount}</span>
                                        <button
                                            type="button"
                                            onClick={() => setMemoriesPage(p => Math.min(memoriesPageCount - 1, p + 1))}
                                            disabled={memoriesPage >= memoriesPageCount - 1}
                                            className="font-semibold text-secondary hover:text-primary disabled:opacity-40 disabled:hover:text-secondary"
                                        >
                                            Suivant
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="rounded-3xl card p-8 space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Fermeture de compte et suppression</h2>
                            <p className="text-sm text-slate-700 dark:text-zinc-300 max-w-2xl">
                                La clôture est irréversible et se fait en self-service en 3 étapes. Vos documents comptables sont conservés 10 ans, toutes les autres données sont supprimées 30 jours après votre demande.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5 space-y-5">
                            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Sauvegarde complète (Administrateur)</p>
                                    <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-zinc-300 max-w-3xl">
                                        Générez une archive ZIP de tout votre espace (fichiers clients, devis, factures, photos). Le lien sera actif pendant 7 jours.
                                    </p>
                                </div>
                                <div className="rounded-2xl border border-[var(--elevation-border)] bg-white dark:bg-black/40 px-4 py-3 min-w-[220px]">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">Accès</p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{isOwner ? 'Autorisé' : 'Réservé à l\'administrateur'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                                {isOwner ? (
                                    <button
                                        onClick={handleCreateOrganizationExport}
                                        disabled={isPending || hasProcessingExport || exportSaveStatus === 'saving'}
                                        className={`px-6 py-3 rounded-full font-bold flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                            exportSaveStatus === 'saved'
                                                ? 'bg-green-500 text-white shadow-green-500/20'
                                                : exportSaveStatus === 'error'
                                                    ? 'bg-red-500 text-white shadow-red-500/20'
                                                    : 'bg-accent text-black shadow-accent/20 hover:scale-105'
                                        }`}
                                    >
                                        {exportSaveStatus === 'saving' || hasProcessingExport ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                                        {hasProcessingExport
                                            ? 'Sauvegarde en cours...'
                                            : exportSaveStatus === 'saving'
                                                ? 'Génération en cours...'
                                                : 'Générer une sauvegarde'}
                                    </button>
                                ) : (
                                    <div className="rounded-2xl border border-[var(--elevation-border)] bg-white dark:bg-black/40 px-4 py-3 text-sm text-slate-700 dark:text-zinc-300">
                                        Seul l&apos;administrateur principal peut générer et récupérer ces sauvegardes.
                                    </div>
                                )}
                                <p className="text-xs text-secondary max-w-xl">
                                    Vous pouvez regénérer l&apos;archive à tout moment via ce bouton.
                                </p>
                            </div>

                            {exportFeedback && (
                                <p className={`text-sm ${exportSaveStatus === 'error' ? 'text-red-500' : exportSaveStatus === 'saved' ? 'text-green-600' : 'text-secondary'}`}>
                                    {exportFeedback}
                                </p>
                            )}

                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <p className="text-sm font-semibold text-primary">Dernières sauvegardes</p>
                                    <p className="text-xs text-secondary">Historique des fichiers générés.</p>
                                </div>

                                {organizationExports.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-[var(--elevation-border)] p-4 text-sm text-secondary">
                                        Aucune sauvegarde n&apos;a encore été générée.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {organizationExports.map((item) => (
                                            <div key={item.id} className="rounded-2xl border border-[var(--elevation-border)] bg-surface/60 dark:bg-white/[0.03] dark:backdrop-blur-sm p-4">
                                                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                                    <div className="space-y-2">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${exportStatusBadge(item.status)}`}>
                                                                {exportStatusLabel(item.status)}
                                                            </span>
                                                            <span className="text-sm font-semibold text-primary">{formatExportDate(item.createdAt)}</span>
                                                        </div>
                                                        <p className="text-sm text-secondary">
                                                            Demande par {item.requestedByEmail} · {formatFileSize(item.bundleSizeBytes)}
                                                            {item.expiresAt ? ` · disponible jusqu'au ${formatExportDate(item.expiresAt)}` : ''}
                                                        </p>
                                                        {item.errorMessage && (
                                                            <p className="text-sm text-red-500">{item.errorMessage}</p>
                                                        )}
                                                        {item.warnings.length > 0 && (
                                                            <p className="text-sm text-secondary">
                                                                {item.warnings.join(' ')}
                                                            </p>
                                                        )}
                                                    </div>

                                                    <div className="flex gap-3">
                                                        {item.downloadUrl ? (
                                                            <a
                                                                href={item.downloadUrl}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="px-4 py-2 rounded-full border border-[var(--elevation-border)] text-primary font-semibold flex items-center gap-2 hover:border-accent hover:text-accent transition-all"
                                                            >
                                                                <ExternalLink className="w-4 h-4" />
                                                                Télécharger
                                                            </a>
                                                        ) : (
                                                            <span className="px-4 py-2 rounded-full border border-[var(--elevation-border)] text-secondary font-semibold flex items-center gap-2">
                                                                <RefreshCw className={`w-4 h-4 ${item.status === 'processing' ? 'animate-spin' : ''}`} />
                                                                {item.status === 'processing' ? 'Génération...' : 'Lien indisponible'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[var(--elevation-border)] bg-base/50 dark:bg-white/5 p-5">
                            <p className="text-sm font-semibold text-primary">Conservation légale des documents</p>
                            <p className="mt-2 text-sm leading-6 text-secondary">
                                Vos devis et factures sont conservés 10 ans (obligations comptables et fiscales), même après la fermeture du compte. Toutes vos autres données personnelles sont purgées 30 jours après la demande.
                            </p>
                        </div>

                        {organization?.deletion_requested_at ? (
                            <div className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-5 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Trash2 className="w-5 h-5 text-red-500" />
                                    <p className="text-sm font-bold text-red-700 dark:text-red-400">Suppression programmée</p>
                                </div>
                                <p className="text-sm text-red-700 dark:text-red-300">
                                    Votre compte sera définitivement supprimé le{' '}
                                    <strong>{organization.deletion_scheduled_at ? new Date(organization.deletion_scheduled_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</strong>.
                                    Vous pouvez annuler cette demande avant cette date.
                                </p>
                                <button
                                    onClick={async () => {
                                        setCancelDeletionStatus('pending')
                                        const result = await cancelAccountDeletion()
                                        setCancelDeletionStatus(result.error ? 'idle' : 'done')
                                        if (!result.error) router.refresh()
                                    }}
                                    disabled={cancelDeletionStatus === 'pending'}
                                    className="px-5 py-2 rounded-full border border-red-400 text-red-700 dark:text-red-300 font-semibold text-sm hover:bg-red-100 dark:hover:bg-red-900/30 transition-all disabled:opacity-60"
                                >
                                    {cancelDeletionStatus === 'pending' ? 'Annulation...' : 'Annuler la suppression'}
                                </button>
                            </div>
                        ) : isOwner ? (
                            <div className="rounded-2xl border border-[var(--elevation-border)] p-5 space-y-4">
                                <p className="text-sm font-semibold text-primary">Fermeture en self-service - 3 étapes</p>

                                <div className={`rounded-xl border p-4 space-y-2 transition-all ${deletionStep >= 1 ? 'border-green-400 bg-green-50 dark:bg-green-950/20' : 'border-[var(--elevation-border)]'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${deletionStep >= 1 ? 'bg-green-500 text-white' : 'bg-surface dark:bg-white/[0.03] border border-[var(--elevation-border)] text-secondary'}`}>1</div>
                                        <p className="text-sm font-semibold text-primary">Sauvegarder vos données</p>
                                    </div>
                                    <p className="text-sm text-secondary pl-8">Téléchargez votre archive ZIP complète avant de continuer.</p>
                                    {deletionStep === 0 && (
                                        <div className="pl-8">
                                            <button
                                                onClick={() => { handleCreateOrganizationExport(); setDeletionStep(1) }}
                                                className="px-4 py-2 rounded-full bg-accent text-black font-semibold text-sm flex items-center gap-2 hover:scale-105 transition-all shadow-md shadow-accent/20"
                                            >
                                                <Package className="w-4 h-4" />
                                                Générer et télécharger l&apos;archive
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className={`rounded-xl border p-4 space-y-2 transition-all ${deletionStep >= 2 ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' : deletionStep === 1 ? 'border-[var(--elevation-border)]' : 'border-[var(--elevation-border)] opacity-40'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${deletionStep >= 2 ? 'bg-orange-500 text-white' : 'bg-surface dark:bg-white/[0.03] border border-[var(--elevation-border)] text-secondary'}`}>2</div>
                                        <p className="text-sm font-semibold text-primary">Confirmer par le nom de l&apos;organisation</p>
                                    </div>
                                    <p className="text-sm text-secondary pl-8">Saisissez exactement <strong>{organization?.name}</strong> pour confirmer.</p>
                                    {deletionStep === 1 && (
                                        <div className="pl-8 space-y-3">
                                            <input
                                                type="text"
                                                value={deletionConfirmText}
                                                onChange={e => setDeletionConfirmText(e.target.value)}
                                                placeholder={organization?.name ?? ''}
                                                className="w-full max-w-xs px-4 py-2 rounded-xl border border-[var(--elevation-border)] bg-base text-primary text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                                            />
                                            <button
                                                onClick={() => { if (deletionConfirmText === organization?.name) setDeletionStep(2) }}
                                                disabled={deletionConfirmText !== organization?.name}
                                                className="px-4 py-2 rounded-full bg-orange-500 text-white font-semibold text-sm hover:scale-105 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                                            >
                                                Confirmer
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className={`rounded-xl border p-4 space-y-2 transition-all ${deletionStep === 3 ? 'border-green-400' : deletionStep === 2 ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-[var(--elevation-border)] opacity-40'}`}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${deletionStep === 3 ? 'bg-green-500 text-white' : deletionStep === 2 ? 'bg-red-500 text-white' : 'bg-surface dark:bg-white/[0.03] border border-[var(--elevation-border)] text-secondary'}`}>3</div>
                                        <p className="text-sm font-semibold text-primary">Lancer la suppression</p>
                                    </div>
                                    <p className="text-sm text-secondary pl-8">La suppression sera effective dans 30 jours. Annulable pendant ce délai.</p>
                                    {deletionStep === 2 && (
                                        <div className="pl-8 space-y-2">
                                            <button
                                                onClick={async () => {
                                                    setDeletionStatus('pending')
                                                    setDeletionError(null)
                                                    const result = await requestAccountDeletion()
                                                    if (result.error) { setDeletionStatus('error'); setDeletionError(result.error) }
                                                    else { setDeletionStatus('done'); setDeletionStep(3); router.refresh() }
                                                }}
                                                disabled={deletionStatus === 'pending'}
                                                className="px-5 py-2 rounded-full bg-red-600 text-white font-bold text-sm flex items-center gap-2 hover:scale-105 transition-all shadow-md disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                {deletionStatus === 'pending' ? 'Traitement...' : 'Confirmer la suppression définitive'}
                                            </button>
                                            {deletionError && <p className="text-sm text-red-500">{deletionError}</p>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 p-5 text-sm text-secondary">
                                La fermeture de compte est réservée au propriétaire (owner) de l&apos;organisation.
                            </div>
                        )}

                        <Link
                            href={`${LEGAL_PATHS.privacy}#suppression`}
                            target="_blank"
                            className="inline-flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors"
                        >
                            <ShieldCheck className="w-4 h-4" />
                            Lire la politique de suppression détaillée
                        </Link>
                    </div>
                </div>
            )
        }

        return null;
    };
    return <>{renderContent()}</>
}
