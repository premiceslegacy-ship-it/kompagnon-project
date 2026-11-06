'use client'
// Contenu des onglets pas encore migrés (ancien habillage) : retiré au fur et à mesure des lots.

import { useState } from 'react'
import Link from 'next/link'

import { ActionMenu } from '@/components/shared'
import { Mail, Trash2, Plus, X, Copy, Check, KeyRound, Save, Loader2, Globe, Code2, ExternalLink, Package, Layers, Wrench, ToggleLeft, ToggleRight, RefreshCw, ShieldCheck, ChevronDown, RotateCcw } from 'lucide-react'

import { sendTeamInvite } from '@/lib/data/mutations/team'

import { categoryLabel, permissionLabel } from '@/lib/permissions/labels'

import { requestAccountDeletion, cancelAccountDeletion } from '@/lib/data/mutations/account-deletion'

import ExportComptableModal from '@/components/ExportComptableModal'

import SubscriptionTab from '@/components/settings/SubscriptionTab'
import OpenRouterKeyTab from '@/components/settings/OpenRouterKeyTab'
import EinvoicingTab from '@/components/settings/EinvoicingTab'

import type { OrganizationModules } from '@/lib/organization-modules'

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

function PermissionCategoryAccordion({
    category,
    perms,
    enabledCount,
    localPerms,
    selectedRoleId,
    onToggle,
}: {
    category: string
    perms: { key: string; label: string; category: string; position: number }[]
    enabledCount: number
    localPerms: Record<string, Record<string, boolean>>
    selectedRoleId: string
    onToggle: (roleId: string, key: string) => void
}) {
    const [open, setOpen] = useState(false)
    return (
        <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[var(--elevation-1)] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className="font-semibold text-primary text-sm">{categoryLabel(category)}</span>
                    <span className="text-xs text-secondary bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-full px-2 py-0.5">
                        {enabledCount} / {perms.length}
                    </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-secondary transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="px-5 pb-4 pt-1 border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]/40">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
                        {perms.map(perm => {
                            const enabled = localPerms[selectedRoleId]?.[perm.key] ?? false
                            return (
                                <button
                                    key={perm.key}
                                    onClick={() => onToggle(selectedRoleId, perm.key)}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all ${enabled ? 'bg-accent/10 border-accent/30 text-primary' : 'bg-base dark:bg-white/5 border-[var(--elevation-border)] text-secondary'}`}
                                >
                                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all ${enabled ? 'bg-accent' : 'bg-surface dark:bg-white/10 border border-[var(--elevation-border)]'}`}>
                                        {enabled && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    {permissionLabel(perm.key, perm.label)}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

export function LegacyTabContent({ q }: { q: SettingsState }) {
    const { members, roles, joinCode, organization, appUrl, catalogMaterials, catalogLaborRates, catalogPrestationTypes, catalogContext, organizationExports, emailTemplates, rolesWithPermissions, canInvite, canRemoveMembers, canEditRoles, canEditOrg, organizationModules, stripeLinkPro, stripeLinkExpert, selfService, subscriptionBillingModel, subscriptionTier, subscriptionAccessStatus, subscriptionAccessEndsAt, einvoicingConfig, canConfigureEinvoicing, oauthResult, oauthDetail, router, activeTab, isInviteModalOpen, setIsInviteModalOpen, inviteEmail, setInviteEmail, inviteRoleId, setInviteRoleId, inviteStatus, setInviteStatus, inviteError, setInviteError, codeCopied, isPending, emailSaveStatus, emailSettings, setEmailSettings, autoReminder, setAutoReminder, autoReminderSaveStatus, autoMemberReports, autoMemberReportsSaveStatus, memories, deletingMemoryId, memoriesPage, setMemoriesPage, memoriesPageCount, memoriesPageItems, handleDeleteMemory, memoryTypeLabel, publicFormSettings, setPublicFormSettings, publicFormSaveStatus, exportSaveStatus, exportFeedback, showExportComptableModal, setShowExportComptableModal, emailSignature, setEmailSignature, cgvText, setCgvText, reminderFirstDelay, setReminderFirstDelay, signatureSaveStatus, tplDraft, setTplDraft, tplSaveStatus, tplResetStatus, expandedTpl, setExpandedTpl, deletionStep, setDeletionStep, deletionConfirmText, setDeletionConfirmText, deletionStatus, setDeletionStatus, deletionError, setDeletionError, cancelDeletionStatus, setCancelDeletionStatus, isOwner, isAdmin, hasProcessingExport, selectedRoleId, setSelectedRoleId, localPerms, permSaveStatus, handleSavePermissions, togglePerm, formatExportDate, formatFileSize, exportStatusBadge, exportStatusLabel, handleCreateOrganizationExport, togglePublicCatalogItem, handleSaveSignatureAndCGV, handleSaveEmailTemplate, handleResetEmailTemplate, handleSavePublicForm, handleSaveAutoReminder, handleSaveAutoMemberReports, copyCode, handleRoleChange, handleRemove, handleSaveEmailSettings } = q
    const renderContent = () => {
        if (activeTab === 'equipe') {
            return (
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-8 relative">

                    {/* Code entreprise */}
                    {joinCode && (
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-base dark:bg-white/5 border border-[var(--elevation-border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center">
                                    <KeyRound className="w-4 h-4 text-accent" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-0.5">Code entreprise</p>
                                    <span className="text-lg font-bold font-mono tracking-widest text-accent">{joinCode}</span>
                                </div>
                            </div>
                            <button
                                onClick={copyCode}
                                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-sm font-semibold text-secondary hover:text-primary transition-all"
                            >
                                {codeCopied ? <Check className="w-4 h-4 text-accent" /> : <Copy className="w-4 h-4" />}
                                {codeCopied ? 'Copié !' : 'Copier'}
                            </button>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-primary">Membres de l&#39;équipe</h2>
                        {canInvite && (
                            <button onClick={() => setIsInviteModalOpen(true)} className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
                                <Plus className="w-4 h-4" />Inviter par email
                            </button>
                        )}
                    </div>

                    <div>
                        {/* En-têtes desktop uniquement */}
                        <div className="hidden sm:grid sm:grid-cols-[1fr_auto_auto_auto] gap-4 pb-3 border-b border-[var(--elevation-border)]">
                            <span className="text-sm font-bold text-secondary uppercase tracking-wider">Membre</span>
                            <span className="text-sm font-bold text-secondary uppercase tracking-wider">Poste</span>
                            <span className="text-sm font-bold text-secondary uppercase tracking-wider">Rôle</span>
                            <span className="w-8"></span>
                        </div>
                        <div className="divide-y divide-[var(--elevation-border)]">
                                {members.length === 0 ? (
                                    <p className="py-8 text-center text-secondary text-sm">Aucun membre pour l&apos;instant.</p>
                                ) : members.map((member) => {
                                    const initials = (member.full_name ?? member.email)
                                        .split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                                    const displayRoleName = member.role_slug === 'owner' ? 'Propriétaire' : member.role_name;
                                    return (
                                        <div key={member.membership_id} className="py-4 flex flex-col sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center gap-2 sm:gap-4">
                                            {/* Identité */}
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                                                    {initials}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-primary truncate">{member.full_name ?? member.email}</p>
                                                    {member.full_name && <p className="text-xs text-secondary truncate">{member.email}</p>}
                                                </div>
                                            </div>
                                            {/* Poste + Rôle sur mobile : même ligne */}
                                            <div className="flex items-center gap-2 pl-13 sm:pl-0 sm:contents">
                                                <span className="text-sm text-secondary sm:hidden font-medium">
                                                    {member.job_title ?? <span className="text-secondary/40">/</span>}
                                                </span>
                                                {/* Poste desktop */}
                                                <span className="hidden sm:block text-sm text-secondary whitespace-nowrap">
                                                    {member.job_title ?? <span className="text-secondary/40">/</span>}
                                                </span>
                                                {/* Rôle */}
                                                {(member.role_slug === 'owner' || !canEditRoles) ? (
                                                    <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-accent/10 text-accent border border-accent/20 whitespace-nowrap">
                                                        {displayRoleName}
                                                    </span>
                                                ) : (
                                                    <select
                                                        defaultValue={member.role_id}
                                                        disabled={isPending}
                                                        onChange={(e) => handleRoleChange(member.membership_id, e.target.value)}
                                                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-accent/10 text-accent border border-accent/20 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {roles.map((r) => (
                                                            <option key={r.id} value={r.id}>{r.name}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                {/* Action menu mobile (dans la même ligne) */}
                                                <div className="sm:hidden ml-auto">
                                                    {canRemoveMembers && member.role_slug !== 'owner' && (
                                                        <ActionMenu actions={[
                                                            {
                                                                label: "Retirer l'accès",
                                                                icon: <Trash2 className="w-4 h-4" />,
                                                                danger: true,
                                                                onClick: () => handleRemove(member.membership_id),
                                                            },
                                                        ]} />
                                                    )}
                                                </div>
                                            </div>
                                            {/* Action menu desktop */}
                                            <div className="hidden sm:block text-right">
                                                {canRemoveMembers && member.role_slug !== 'owner' && (
                                                    <ActionMenu actions={[
                                                        {
                                                            label: "Retirer l'accès",
                                                            icon: <Trash2 className="w-4 h-4" />,
                                                            danger: true,
                                                            onClick: () => handleRemove(member.membership_id),
                                                        },
                                                    ]} />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>

                    {/* Modal invitation email */}
                    {isInviteModalOpen && (
                        <div className="modal-overlay">
                            <div className="modal-panel animate-in fade-in duration-300 sm:max-w-md">
                                <button
                                    onClick={() => { setIsInviteModalOpen(false); setInviteStatus('idle'); setInviteError(null); setInviteEmail(''); }}
                                    className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                                <h2 className="text-2xl font-bold text-primary mb-6">Inviter un collaborateur</h2>

                                {inviteStatus === 'sent' ? (
                                    <div className="flex flex-col items-center text-center gap-4 py-4">
                                        <div className="w-12 h-12 rounded-full flex items-center justify-center">
                                            <Check className="w-6 h-6 text-green-500" />
                                        </div>
                                        <p className="font-semibold text-primary">Invitation envoyée !</p>
                                        <p className="text-sm text-secondary">Un email a été envoyé à <span className="text-primary font-medium">{inviteEmail}</span>. Le lien est valable 7 jours.</p>
                                        <button
                                            onClick={() => { setIsInviteModalOpen(false); setInviteStatus('idle'); setInviteEmail(''); }}
                                            className="mt-2 px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20"
                                        >
                                            Fermer
                                        </button>
                                    </div>
                                ) : (
                                    <form
                                        className="space-y-6"
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            setInviteStatus('sending');
                                            setInviteError(null);
                                            const result = await sendTeamInvite(inviteEmail, inviteRoleId);
                                            if (result.error) {
                                                setInviteError(result.error);
                                                setInviteStatus('error');
                                            } else {
                                                setInviteStatus('sent');
                                            }
                                        }}
                                    >
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold text-secondary">Email du collaborateur</label>
                                            <input
                                                type="email"
                                                placeholder="email@entreprise.fr"
                                                value={inviteEmail}
                                                onChange={(e) => setInviteEmail(e.target.value)}
                                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-semibold text-secondary">Rôle</label>
                                            <select
                                                value={inviteRoleId}
                                                onChange={(e) => setInviteRoleId(e.target.value)}
                                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all appearance-none"
                                                required
                                            >
                                                {roles.map((r) => (
                                                    <option key={r.id} value={r.id}>{r.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {inviteStatus === 'error' && inviteError && (
                                            <p className="text-sm text-red-500">{inviteError}</p>
                                        )}
                                        <div className="pt-2 flex justify-end gap-4">
                                            <button type="button" onClick={() => { setIsInviteModalOpen(false); setInviteStatus('idle'); setInviteError(null); setInviteEmail(''); }} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">
                                                Annuler
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={inviteStatus === 'sending'}
                                                className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
                                            >
                                                {inviteStatus === 'sending' ? (
                                                    <><Mail className="w-4 h-4 animate-pulse" />Envoi en cours…</>
                                                ) : (
                                                    'Envoyer l\'invitation'
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (activeTab === 'roles') {
            const selectedRole = rolesWithPermissions.roles.find(r => r.id === selectedRoleId)
            const isOwnerRole = selectedRole?.slug === 'owner'

            // Grouper les permissions par catégorie
            const grouped: Record<string, typeof rolesWithPermissions.allPermissions> = {}
            for (const p of rolesWithPermissions.allPermissions) {
                if (!grouped[p.category]) grouped[p.category] = []
                grouped[p.category].push(p)
            }

            return (
                <div className="space-y-6">
                    <div className="rounded-3xl card p-8 space-y-6">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Rôles &amp; permissions</h2>
                            <p className="text-sm text-secondary">Définissez ce que chaque rôle peut faire dans l&apos;application. Les modifications s&apos;appliquent à tous les membres ayant ce rôle.</p>
                        </div>

                        {/* Sélecteur de rôle */}
                        <div className="flex flex-wrap gap-2">
                            {rolesWithPermissions.roles.map(role => (
                                <button
                                    key={role.id}
                                    onClick={() => setSelectedRoleId(role.id)}
                                    className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${selectedRoleId === role.id ? 'text-white border-transparent' : 'bg-base dark:bg-white/5 border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
                                    style={selectedRoleId === role.id ? { backgroundColor: role.color ?? '#6366f1' } : {}}
                                >
                                    {role.name}
                                </button>
                            ))}
                        </div>

                        {selectedRole && (
                            <>
                                {isOwnerRole ? (
                                    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 px-6 py-4 text-sm text-amber-700 dark:text-amber-400">
                                        Le Dirigeant a accès à toutes les fonctionnalités. Ses permissions ne peuvent pas être modifiées.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {Object.entries(grouped).map(([category, perms]) => {
                                            const enabledCount = perms.filter(p => localPerms[selectedRoleId]?.[p.key]).length
                                            return (
                                                <PermissionCategoryAccordion
                                                    key={category}
                                                    category={category}
                                                    perms={perms}
                                                    enabledCount={enabledCount}
                                                    localPerms={localPerms}
                                                    selectedRoleId={selectedRoleId}
                                                    onToggle={togglePerm}
                                                />
                                            )
                                        })}

                                        <div className="flex items-center gap-3 pt-4">
                                            <button
                                                onClick={handleSavePermissions}
                                                disabled={permSaveStatus === 'saving'}
                                                className="btn-primary flex items-center gap-2"
                                            >
                                                {permSaveStatus === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                {permSaveStatus === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
                                            </button>
                                            {permSaveStatus === 'saved' && <span className="text-sm text-green-500 font-medium">Permissions mises à jour</span>}
                                            {permSaveStatus === 'error' && <span className="text-sm text-red-500 font-medium">Erreur lors de la sauvegarde</span>}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )
        }

        if (activeTab === 'emails') {
            return (
                <div className="space-y-6">

                {/* Relances automatiques - en premier */}
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-6">
                    <div className="flex items-start justify-between gap-6">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Relances automatiques</h2>
                            <p className="text-sm text-secondary">Envoie des relances par email sans intervention manuelle, à l&apos;heure configurée ci-dessous.</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={autoReminder.enabled}
                            onClick={() => setAutoReminder(a => ({ ...a, enabled: !a.enabled }))}
                            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${autoReminder.enabled ? 'bg-accent' : 'bg-[var(--elevation-border)]'}`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoReminder.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {autoReminder.enabled && (
                        <div className="space-y-6 pt-2 border-t border-[var(--elevation-border)]">
                            <div className="space-y-2">
                                <p className="text-sm font-semibold text-primary">Heure d&apos;envoi</p>
                                <div className="flex items-center gap-3">
                                    <select
                                        value={autoReminder.reminderHour}
                                        onChange={e => setAutoReminder(a => ({ ...a, reminderHour: parseInt(e.target.value) }))}
                                        className="px-4 py-2.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] rounded-xl text-primary font-mono text-sm outline-none focus:border-accent transition-all"
                                    >
                                        {Array.from({ length: 24 }, (_, h) => (
                                            <option key={h} value={h}>{String(h).padStart(2, '0')}h00 UTC</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-secondary">
                                        = {String((autoReminder.reminderHour + 1) % 24).padStart(2, '0')}h heure de Paris (hiver) · {String((autoReminder.reminderHour + 2) % 24).padStart(2, '0')}h (été)
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <p className="text-sm font-semibold text-primary">Relances factures impayées</p>
                                    <p className="text-xs text-secondary mt-0.5">Jours après l&apos;envoi de la facture (J+X). Première relance au plus tôt à J+3.</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {autoReminder.invoiceDays.map((day, i) => (
                                        <div key={i} className="flex items-center gap-1.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] rounded-xl px-3 py-2">
                                            <span className="text-xs text-secondary font-medium">J+</span>
                                            <input type="number" min={1} max={365} value={day}
                                                onChange={e => { const raw = parseInt(e.target.value) || 1; const v = i === 0 ? Math.max(3, raw) : raw; setAutoReminder(a => ({ ...a, invoiceDays: a.invoiceDays.map((d, j) => j === i ? v : d) })) }}
                                                className="w-12 text-center bg-transparent text-primary font-bold text-sm outline-none" />
                                            {autoReminder.invoiceDays.length > 1 && (
                                                <button onClick={() => setAutoReminder(a => ({ ...a, invoiceDays: a.invoiceDays.filter((_, j) => j !== i) }))} className="text-secondary hover:text-red-500 transition-colors ml-1"><X className="w-3 h-3" /></button>
                                            )}
                                        </div>
                                    ))}
                                    {autoReminder.invoiceDays.length < 4 && (
                                        <button onClick={() => setAutoReminder(a => ({ ...a, invoiceDays: [...a.invoiceDays, (a.invoiceDays[a.invoiceDays.length - 1] ?? 0) + 7] }))}
                                            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-dashed border-[var(--elevation-border)] text-secondary hover:border-accent hover:text-accent transition-all text-sm font-medium">
                                            <Plus className="w-3.5 h-3.5" />Ajouter
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <p className="text-sm font-semibold text-primary">Relances devis sans réponse</p>
                                    <p className="text-xs text-secondary mt-0.5">Jours après l&apos;envoi du devis (J+X).</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {autoReminder.quoteDays.map((day, i) => (
                                        <div key={i} className="flex items-center gap-1.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] rounded-xl px-3 py-2">
                                            <span className="text-xs text-secondary font-medium">J+</span>
                                            <input type="number" min={1} max={365} value={day}
                                                onChange={e => { const v = parseInt(e.target.value) || 1; setAutoReminder(a => ({ ...a, quoteDays: a.quoteDays.map((d, j) => j === i ? v : d) })) }}
                                                className="w-12 text-center bg-transparent text-primary font-bold text-sm outline-none" />
                                            {autoReminder.quoteDays.length > 1 && (
                                                <button onClick={() => setAutoReminder(a => ({ ...a, quoteDays: a.quoteDays.filter((_, j) => j !== i) }))} className="text-secondary hover:text-red-500 transition-colors ml-1"><X className="w-3 h-3" /></button>
                                            )}
                                        </div>
                                    ))}
                                    {autoReminder.quoteDays.length < 4 && (
                                        <button onClick={() => setAutoReminder(a => ({ ...a, quoteDays: [...a.quoteDays, (a.quoteDays[a.quoteDays.length - 1] ?? 0) + 7] }))}
                                            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-dashed border-[var(--elevation-border)] text-secondary hover:border-accent hover:text-accent transition-all text-sm font-medium">
                                            <Plus className="w-3.5 h-3.5" />Ajouter
                                        </button>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-secondary bg-base dark:bg-white/5 rounded-xl px-4 py-3">
                                Les emails de relance sont rédigés automatiquement. Les clients sans adresse email sont ignorés. Marquez une facture comme payée dès réception du règlement pour bloquer les relances suivantes.
                            </p>
                        </div>
                    )}

                    <div className="flex justify-end pt-2">
                        <button onClick={handleSaveAutoReminder} disabled={isPending || autoReminderSaveStatus === 'saving'}
                            className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${autoReminderSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' : autoReminderSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' : 'bg-accent text-black shadow-accent/20'}`}>
                            <Save className="w-4 h-4" />
                            {autoReminderSaveStatus === 'saving' ? 'Enregistrement...' : autoReminderSaveStatus === 'saved' ? 'Enregistré !' : autoReminderSaveStatus === 'error' ? 'Erreur' : 'Enregistrer'}
                        </button>
                    </div>
                </div>

                {/* Rapport mensuel automatique aux intervenants */}
                {canEditOrg && (
                    <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-4">
                        <div className="flex items-start justify-between gap-6">
                            <div>
                                <h2 className="text-2xl font-bold text-primary mb-1">Rapport mensuel d&apos;heures</h2>
                                <p className="text-sm text-secondary">
                                    Envoie automatiquement le 1er du mois, à chaque intervenant ayant un email,
                                    son rapport PDF des heures pointées le mois précédent.
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={autoMemberReports}
                                onClick={() => handleSaveAutoMemberReports(!autoMemberReports)}
                                className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${autoMemberReports ? 'bg-accent' : 'bg-[var(--elevation-border)]'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoMemberReports ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        {autoMemberReportsSaveStatus === 'saved' && (
                            <p className="text-xs text-green-500 font-medium">Préférence enregistrée.</p>
                        )}
                        {autoMemberReportsSaveStatus === 'error' && (
                            <p className="text-xs text-red-500 font-medium">Erreur lors de l&apos;enregistrement.</p>
                        )}
                        <p className="text-xs text-secondary bg-base dark:bg-white/5 rounded-xl px-4 py-3">
                            Les membres peuvent aussi recevoir leur rapport à la demande depuis leur espace personnel
                            (lien d&apos;accès envoyé par email à leur création).
                        </p>
                    </div>
                )}

                {/* Configuration expéditeur */}
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-6">
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-1">Configuration email</h2>
                        <p className="text-sm text-secondary">Adresse utilisée pour l&apos;envoi des invitations et des emails métier (devis, factures, relances). Si un client répond à un devis ou une facture, la réponse arrive directement à l&apos;adresse renseignée dans &laquo;&nbsp;Email de contact&nbsp;&raquo; (onglet Entreprise), jamais à ce domaine d&apos;envoi.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-secondary">Nom d&apos;affichage</label>
                            <input
                                type="text"
                                placeholder="Dupont BTP"
                                value={emailSettings.from_name}
                                onChange={e => setEmailSettings({ ...emailSettings, from_name: e.target.value })}
                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
                            />
                            <p className="text-xs text-secondary">Ce nom apparaîtra dans la boîte mail du destinataire.</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-secondary">Adresse expéditeur</label>
                            <input
                                type="email"
                                placeholder="contact@dupont-btp.fr"
                                value={emailSettings.from_address}
                                onChange={e => setEmailSettings({ ...emailSettings, from_address: e.target.value })}
                                disabled={selfService}
                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
                            />
                            <p className="text-xs text-secondary">{selfService ? 'Adresse gérée par Atelier BTP, lecture seule.' : 'Doit être vérifiée sur votre compte Resend.'}</p>
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button
                            onClick={handleSaveEmailSettings}
                            disabled={isPending || emailSaveStatus === 'saving'}
                            className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                emailSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                emailSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                'bg-accent text-black shadow-accent/20'
                            }`}
                        >
                            <Save className="w-4 h-4" />
                            {emailSaveStatus === 'saving' ? 'Enregistrement...' :
                             emailSaveStatus === 'saved' ? 'Enregistré !' :
                             emailSaveStatus === 'error' ? 'Erreur' :
                             'Sauvegarder'}
                        </button>
                    </div>
                </div>

                {/* Signature email + CGV */}
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-6">
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-1">Signature & CGV</h2>
                        <p className="text-sm text-secondary">Ajoutée en bas de chaque email envoyé et imprimée au pied des documents.</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-secondary">Signature email</label>
                        <textarea
                            rows={4}
                            placeholder={"Cordialement,\nDupont BTP\n+33 6 12 34 56 78"}
                            value={emailSignature}
                            onChange={e => setEmailSignature(e.target.value)}
                            className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all resize-none font-mono text-sm"
                        />
                        <p className="text-xs text-secondary">Texte brut ajouté après le corps de l&apos;email.</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-secondary">Conditions Générales de Vente (CGV)</label>
                        <textarea
                            rows={6}
                            placeholder="Article 1 - Objet&#10;Les présentes conditions générales de vente régissent..."
                            value={cgvText}
                            onChange={e => setCgvText(e.target.value)}
                            className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all resize-none font-mono text-sm"
                        />
                        <p className="text-xs text-secondary">Imprimées au verso des devis et factures (texte brut, max 3 000 caractères).</p>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-secondary">Délai avant première relance (jours)</label>
                        <input
                            type="number" min={3} max={90}
                            value={reminderFirstDelay}
                            onChange={e => setReminderFirstDelay(Math.max(3, parseInt(e.target.value) || 3))}
                            className="w-24 px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums"
                        />
                        <p className="text-xs text-secondary">Nombre de jours après l&apos;envoi avant d&apos;envoyer la première relance facture. Minimum 3 jours.</p>
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handleSaveSignatureAndCGV} disabled={isPending || signatureSaveStatus === 'saving'}
                            className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${signatureSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' : signatureSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' : 'bg-accent text-black shadow-accent/20'}`}>
                            <Save className="w-4 h-4" />
                            {signatureSaveStatus === 'saving' ? 'Enregistrement...' : signatureSaveStatus === 'saved' ? 'Enregistré !' : signatureSaveStatus === 'error' ? 'Erreur' : 'Enregistrer'}
                        </button>
                    </div>
                </div>

                {/* Templates emails */}
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-4">
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-1">Templates emails</h2>
                        <p className="text-sm text-secondary">Personnalisez le sujet et le corps de chaque email automatique. Les variables entre <code className="bg-base px-1 rounded text-xs">{'{{'}doubles accolades{'}}'}</code> sont remplacées à l&apos;envoi. Quel que soit le domaine d&apos;envoi, une réponse du client arrive toujours à votre adresse de contact (onglet Entreprise), jamais dans le vide.</p>
                    </div>
                    {emailTemplates.map(tpl => {
                        const isExpanded = expandedTpl === tpl.slug
                        const draft = tplDraft[tpl.slug]
                        const saveStatus = tplSaveStatus[tpl.slug]
                        const resetStatus = tplResetStatus[tpl.slug]
                        return (
                            <div key={tpl.slug} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                                <button
                                    onClick={() => setExpandedTpl(isExpanded ? null : tpl.slug)}
                                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-base dark:hover:bg-white/5 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-3">
                                        <Mail className="w-4 h-4 text-accent flex-shrink-0" />
                                        <div>
                                            <p className="font-semibold text-primary text-sm">{tpl.name}</p>
                                            {tpl.is_custom && <span className="text-xs text-accent font-medium">Personnalisé</span>}
                                        </div>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>
                                {isExpanded && (
                                    <div className="px-6 pb-6 space-y-4 border-t border-[var(--elevation-border)]">
                                        <div className="pt-4 space-y-2">
                                            <label className="text-xs font-semibold text-secondary uppercase tracking-wide">Sujet</label>
                                            <input
                                                type="text"
                                                value={draft.subject}
                                                onChange={e => setTplDraft(d => ({ ...d, [tpl.slug]: { ...d[tpl.slug], subject: e.target.value } }))}
                                                className="w-full px-4 py-2.5 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-xl text-primary outline-none text-sm transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-secondary uppercase tracking-wide">Corps</label>
                                            <textarea
                                                rows={6}
                                                value={draft.body_text}
                                                onChange={e => setTplDraft(d => ({ ...d, [tpl.slug]: { ...d[tpl.slug], body_text: e.target.value } }))}
                                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-xl text-primary outline-none text-sm resize-none font-mono transition-all"
                                            />
                                            <p className="text-xs text-secondary">Variables disponibles : {tpl.variables.join(' · ')}</p>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            {tpl.is_custom && (
                                                <button onClick={() => handleResetEmailTemplate(tpl.slug)} disabled={isPending || resetStatus === 'pending'}
                                                    className="flex items-center gap-1.5 text-xs text-secondary hover:text-red-500 transition-colors disabled:opacity-50">
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                    {resetStatus === 'done' ? 'Réinitialisé !' : 'Revenir au défaut'}
                                                </button>
                                            )}
                                            <div className="ml-auto">
                                                <button onClick={() => handleSaveEmailTemplate(tpl.slug)} disabled={isPending || saveStatus === 'saving'}
                                                    className={`px-6 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 transition-all shadow-sm disabled:opacity-60 ${saveStatus === 'saved' ? 'bg-green-500 text-white' : saveStatus === 'error' ? 'bg-red-500 text-white' : 'bg-accent text-black'}`}>
                                                    <Save className="w-3.5 h-3.5" />
                                                    {saveStatus === 'saving' ? 'Enregistrement...' : saveStatus === 'saved' ? 'Enregistré !' : saveStatus === 'error' ? 'Erreur' : 'Enregistrer'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                </div>
            );
        }

        if (activeTab === 'integration') {
            // appUrl est injecté depuis les headers HTTP côté serveur (auto-détection du domaine)
            const orgSlug = organization?.slug ?? ''
            const publicUrl = `${appUrl}/demande/${orgSlug}`
            const iframeCode = `<iframe\n  src="${publicUrl}"\n  width="100%"\n  height="720"\n  frameborder="0"\n  style="border-radius:16px;border:none;"\n  title="Demande de devis"\n></iframe>`
            const widgetCode = `<!-- Bouton flottant ATELIER -->
<script>
  (function() {
    var btn = document.createElement('a');
    btn.href = '${publicUrl}';
    btn.target = '_blank';
    btn.textContent = 'Demande de devis';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#b5f22d;color:#000;font-weight:700;padding:14px 24px;border-radius:50px;text-decoration:none;box-shadow:0 4px 20px rgba(181,242,45,0.4);z-index:9999;font-family:sans-serif;font-size:14px;';
    document.body.appendChild(btn);
  })();
</script>`

            return (
                <div className="space-y-6 max-w-3xl">
                    <div className="rounded-3xl card p-8 space-y-8">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Formulaire de demande de devis</h2>
                            <p className="text-secondary text-sm">Intégrez votre formulaire public sur votre site web pour recevoir des demandes directement dans ATELIER.</p>
                        </div>

                        {/* Lien direct */}
                        <div className="space-y-3">
                            <h3 className="text-base font-bold text-primary flex items-center gap-2"><Globe className="w-4 h-4 text-accent" />Lien direct</h3>
                            <p className="text-sm text-secondary">Partagez ce lien dans votre signature email, sur vos réseaux ou sur votre site.</p>
                            <div className="flex items-center gap-3">
                                <div className="flex-1 px-4 py-3 bg-base dark:bg-white/5 rounded-xl text-sm font-mono text-primary truncate border border-[var(--elevation-border)]">
                                    {publicUrl}
                                </div>
                                <CopyButton text={publicUrl} />
                                <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-secondary hover:text-accent transition-colors"
                                    title="Ouvrir dans un nouvel onglet"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>
                        </div>

                        <div className="h-px w-full bg-[var(--elevation-border)]" />

                        {/* Iframe embed */}
                        <div className="space-y-3">
                            <h3 className="text-base font-bold text-primary flex items-center gap-2"><Code2 className="w-4 h-4 text-accent" />Intégration iframe</h3>
                            <p className="text-sm text-secondary">Collez ce code HTML dans votre site pour afficher le formulaire directement dans la page.</p>
                            <div className="relative">
                                <pre className="p-4 rounded-2xl bg-base dark:bg-black/30 border border-[var(--elevation-border)] text-xs text-primary font-mono overflow-x-auto leading-relaxed whitespace-pre">
                                    {iframeCode}
                                </pre>
                                <div className="absolute top-3 right-3">
                                    <CopyButton text={iframeCode} />
                                </div>
                            </div>
                        </div>

                        <div className="h-px w-full bg-[var(--elevation-border)]" />

                        {/* Widget JS */}
                        <div className="space-y-3">
                            <h3 className="text-base font-bold text-primary flex items-center gap-2"><Code2 className="w-4 h-4 text-accent" />Bouton flottant (widget JS)</h3>
                            <p className="text-sm text-secondary">Ce snippet ajoute un bouton flottant sur votre site qui ouvre le formulaire dans un nouvel onglet. À coller juste avant <code className="bg-base px-1.5 py-0.5 rounded text-xs">&lt;/body&gt;</code>.</p>
                            <div className="relative">
                                <pre className="p-4 rounded-2xl bg-base dark:bg-black/30 border border-[var(--elevation-border)] text-xs text-primary font-mono overflow-x-auto leading-relaxed whitespace-pre">
                                    {widgetCode}
                                </pre>
                                <div className="absolute top-3 right-3">
                                    <CopyButton text={widgetCode} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        if (activeTab === 'formulaire') {
            const orgSlug = organization?.slug ?? ''
            const publicUrl = `${appUrl}/demande/${orgSlug}`
            return (
                <div className="space-y-6">
                    <div className="rounded-3xl card p-8 space-y-8">
                        <div>
                            <h2 className="text-2xl font-bold text-primary mb-1">Formulaire public</h2>
                            <p className="text-secondary text-sm">Configurez le formulaire que vos prospects utilisent pour demander un devis.</p>
                        </div>

                        {/* Activation */}
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)]">
                            <div>
                                <p className="font-semibold text-primary">Activer le formulaire public</p>
                                <p className="text-sm text-secondary mt-0.5">Rend le formulaire accessible à vos prospects via le lien ci-dessous.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPublicFormSettings(p => ({ ...p, enabled: !p.enabled }))}
                                className="flex-shrink-0 ml-4"
                            >
                                {publicFormSettings.enabled
                                    ? <ToggleRight className="w-10 h-10 text-accent-green" />
                                    : <ToggleLeft className="w-10 h-10 text-secondary" />
                                }
                            </button>
                        </div>

                        {publicFormSettings.enabled && (
                            <div className="flex items-center gap-3">
                                <div className="flex-1 px-4 py-3 bg-base dark:bg-white/5 rounded-xl text-sm font-mono text-primary truncate border border-[var(--elevation-border)]">
                                    {publicUrl}
                                </div>
                                <CopyButton text={publicUrl} />
                                <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-secondary hover:text-accent transition-colors"
                                    title="Ouvrir dans un nouvel onglet"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>
                        )}

                        <div className="h-px w-full bg-[var(--elevation-border)]" />

                        {/* Message d'accueil */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-secondary">Message d&apos;accueil</label>
                            <textarea
                                rows={3}
                                value={publicFormSettings.welcomeMessage}
                                onChange={e => setPublicFormSettings(p => ({ ...p, welcomeMessage: e.target.value }))}
                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all resize-none text-sm"
                                placeholder="Bienvenue ! Décrivez vos travaux et nous vous répondrons sous 24h."
                            />
                        </div>

                        {/* Mode sur-mesure */}
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)]">
                            <div>
                                <p className="font-semibold text-primary flex items-center gap-2"><Wrench className="w-4 h-4 text-secondary" />Mode sur-mesure (description libre)</p>
                                <p className="text-sm text-secondary mt-0.5">Le prospect peut décrire librement son projet.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPublicFormSettings(p => ({ ...p, customModeEnabled: !p.customModeEnabled }))}
                                className="flex-shrink-0 ml-4"
                            >
                                {publicFormSettings.customModeEnabled
                                    ? <ToggleRight className="w-10 h-10 text-accent-green" />
                                    : <ToggleLeft className="w-10 h-10 text-secondary" />
                                }
                            </button>
                        </div>

                        {/* Email de notification */}
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-secondary">Email de notification</label>
                            <input
                                type="email"
                                value={publicFormSettings.notificationEmail}
                                onChange={e => setPublicFormSettings(p => ({ ...p, notificationEmail: e.target.value }))}
                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all text-sm"
                                placeholder="contact@monentreprise.fr"
                            />
                            <p className="text-xs text-secondary">Recevez un email à chaque nouvelle demande.</p>
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={handleSavePublicForm}
                                disabled={isPending || publicFormSaveStatus === 'saving'}
                                className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                    publicFormSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                    publicFormSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                    'bg-accent text-black shadow-accent/20'
                                }`}
                            >
                                <Save className="w-4 h-4" />
                                {publicFormSaveStatus === 'saving' ? 'Enregistrement...' :
                                 publicFormSaveStatus === 'saved' ? 'Enregistré !' :
                                 publicFormSaveStatus === 'error' ? 'Erreur' :
                                 'Sauvegarder'}
                            </button>
                        </div>
                    </div>

                    {/* Sélection des éléments visibles dans le formulaire */}
                    <div className="rounded-3xl card p-8 space-y-6">
                        <div>
                            <h3 className="text-xl font-bold text-primary mb-1 flex items-center gap-2"><Package className="w-5 h-5 text-accent" />Éléments visibles dans le formulaire public</h3>
                            <p className="text-sm text-secondary">Sélectionnez les {catalogContext.labelSet.material.plural.toLowerCase()}, {catalogContext.labelSet.service.plural.toLowerCase()} et {catalogContext.labelSet.bundleTemplate.plural.toLowerCase()} à exposer à vos prospects. Les prix, marges et coûts internes ne sont jamais affichés.</p>
                        </div>

                        {/* Produits / fournitures / matières */}
                        {catalogMaterials.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-primary flex items-center gap-2"><Package className="w-4 h-4 text-secondary" />{catalogContext.labelSet.material.plural}</h4>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPublicFormSettings(prev => ({
                                                ...prev,
                                                catalogItemIds: [
                                                    ...prev.catalogItemIds.filter(x => x.item_type !== 'material'),
                                                    ...catalogMaterials.map(m => ({ id: m.id, item_type: 'material' as const })),
                                                ],
                                            }))}
                                            className="text-xs text-accent font-semibold hover:underline"
                                        >
                                            Tout cocher
                                        </button>
                                        <span className="text-xs text-secondary">·</span>
                                        <button
                                            type="button"
                                            onClick={() => setPublicFormSettings(prev => ({
                                                ...prev,
                                                catalogItemIds: prev.catalogItemIds.filter(x => x.item_type !== 'material'),
                                            }))}
                                            className="text-xs text-secondary hover:text-primary font-semibold hover:underline"
                                        >
                                            Tout décocher
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {catalogMaterials.map(m => {
                                        const selected = publicFormSettings.catalogItemIds.some(x => x.id === m.id && x.item_type === 'material')
                                        return (
                                            <label key={m.id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${selected ? 'border-accent/40 bg-accent/5' : 'border-[var(--elevation-border)] hover:bg-base'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => togglePublicCatalogItem(m.id, 'material')}
                                                    className="w-4 h-4 accent-[var(--accent)]"
                                                />
                                                <span className="flex-1 text-sm font-medium text-primary">{m.name}</span>
                                                {m.category && <span className="text-xs text-secondary bg-base px-2 py-0.5 rounded-full">{m.category}</span>}
                                                {m.unit && <span className="text-xs text-secondary">{m.unit}</span>}
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* La main d'œuvre n'est volontairement pas proposée sur le
                            formulaire public : c'est un coût interne que l'artisan
                            ajuste lui-même dans l'éditeur de devis. */}

                        {/* Templates catalogue */}
                        {catalogPrestationTypes.length > 0 && (
                            <div className="space-y-3">
                                {catalogMaterials.length > 0 && <div className="h-px bg-[var(--elevation-border)]" />}
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-primary flex items-center gap-2"><Layers className="w-4 h-4 text-secondary" />{catalogContext.labelSet.bundleTemplate.plural}</h4>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPublicFormSettings(prev => ({
                                                ...prev,
                                                catalogItemIds: [
                                                    ...prev.catalogItemIds.filter(x => x.item_type !== 'prestation'),
                                                    ...catalogPrestationTypes.map(p => ({ id: p.id, item_type: 'prestation' as const })),
                                                ],
                                            }))}
                                            className="text-xs text-accent font-semibold hover:underline"
                                        >
                                            Tout cocher
                                        </button>
                                        <span className="text-xs text-secondary">·</span>
                                        <button
                                            type="button"
                                            onClick={() => setPublicFormSettings(prev => ({
                                                ...prev,
                                                catalogItemIds: prev.catalogItemIds.filter(x => x.item_type !== 'prestation'),
                                            }))}
                                            className="text-xs text-secondary hover:text-primary font-semibold hover:underline"
                                        >
                                            Tout décocher
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {catalogPrestationTypes.map(p => {
                                        const selected = publicFormSettings.catalogItemIds.some(x => x.id === p.id && x.item_type === 'prestation')
                                        return (
                                            <label key={p.id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all ${selected ? 'border-accent/40 bg-accent/5' : 'border-[var(--elevation-border)] hover:bg-base'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => togglePublicCatalogItem(p.id, 'prestation')}
                                                    className="w-4 h-4 accent-[var(--accent)]"
                                                />
                                                <span className="flex-1 text-sm font-medium text-primary">{p.name}</span>
                                                {p.category && <span className="text-xs text-secondary bg-base px-2 py-0.5 rounded-full">{p.category}</span>}
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {catalogMaterials.length === 0 && catalogLaborRates.length === 0 && catalogPrestationTypes.length === 0 && (
                            <p className="text-sm text-secondary text-center py-6">Aucun élément dans votre catalogue. Ajoutez des matériaux, des opérations ou des prestations types dans l&apos;onglet Catalogue.</p>
                        )}

                        {(catalogMaterials.length > 0 || catalogPrestationTypes.length > 0) && (
                            <div className="flex justify-end">
                                <button
                                    onClick={handleSavePublicForm}
                                    disabled={isPending || publicFormSaveStatus === 'saving'}
                                    className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                        publicFormSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                        publicFormSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                        'bg-accent text-black shadow-accent/20'
                                    }`}
                                >
                                    <Save className="w-4 h-4" />
                                    {publicFormSaveStatus === 'saving' ? 'Enregistrement...' :
                                     publicFormSaveStatus === 'saved' ? 'Enregistré !' :
                                     publicFormSaveStatus === 'error' ? 'Erreur' :
                                     'Sauvegarder la sélection'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )
        }

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

        if (activeTab === 'abonnement') {
            return (
                <div className="rounded-3xl card p-8 space-y-8">
                    <SubscriptionTab
                        billingModel={subscriptionBillingModel}
                        modules={organizationModules ?? {} as OrganizationModules}
                        stripeLinkPro={stripeLinkPro}
                        stripeLinkExpert={stripeLinkExpert}
                        selfService={selfService}
                        currentTierOverride={subscriptionTier}
                        accessStatus={subscriptionAccessStatus}
                        accessEndsAt={subscriptionAccessEndsAt}
                    />
                    <OpenRouterKeyTab />
                </div>
            )
        }

        if (activeTab === 'facturation' && canConfigureEinvoicing) {
            return (
                <div className="rounded-3xl card p-8">
                    <EinvoicingTab
                        config={einvoicingConfig}
                        canConfigure={canConfigureEinvoicing}
                        oauthResult={oauthResult}
                        oauthDetail={oauthDetail}
                    />
                </div>
            )
        }

        return null;
    };
    return <>{renderContent()}</>
}
