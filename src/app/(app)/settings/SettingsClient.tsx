"use client";

import React, { useState, useTransition, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ActionMenu } from '@/components/shared';
import {
    Upload, Mail, Trash2, Plus, X, User, Building2, Users, Copy, Check, KeyRound, Save, Loader2, ImageIcon, Globe, Code2, ExternalLink, Inbox, Package, Layers, Wrench, ToggleLeft, ToggleRight, MessageSquare, RefreshCw, ShieldCheck, ChevronDown
} from 'lucide-react';
import type { TeamMember } from '@/lib/data/queries/team';
import type { OrgRole } from '@/lib/data/queries/roles';
import type { Organization } from '@/lib/data/queries/organization';
import type { OrganizationExportListItem } from '@/lib/data/queries/organization-exports';
import { createClient } from '@/lib/supabase/client';
import { updateMemberRole, removeMember, sendTeamInvite } from '@/lib/data/mutations/team';
import { updateOrganization } from '@/lib/data/mutations/organization';
import { updateEmailSettings } from '@/lib/data/mutations/email-settings';
import { updateProfile, updatePassword } from '@/lib/data/mutations/profile';
import { updatePublicFormSettings } from '@/lib/data/mutations/quote-requests';
import { saveWhatsAppConfig, deleteWhatsAppConfig } from '@/lib/data/mutations/whatsapp';
import { createOrganizationExport } from '@/lib/data/mutations/organization-exports';
import { updateOrganizationModules } from '@/lib/data/mutations/organization-modules';
import type { WhatsAppConfig } from '@/lib/data/mutations/whatsapp';
import type { CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog';
import type { OrganizationModules } from '@/lib/organization-modules';
import {
    BUSINESS_ACTIVITIES_BY_PROFILE,
    resolveBusinessSelection,
    type BusinessActivityId,
    type ResolvedCatalogContext,
} from '@/lib/catalog-context';
import { LEGAL_VAT_RATES } from '@/lib/utils';
import { LEGAL_CONTACT, LANDING_LEGAL_SNIPPETS, LEGAL_PATHS, buildDeletionRequestMailto, legalContactLabel } from '@/lib/legal';

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

type Props = {
    initialFullName: string | null;
    initialEmail: string | null;
    members: TeamMember[];
    roles: OrgRole[];
    joinCode: string | null;
    organization: Organization | null;
    appUrl: string;
    supabaseUrl: string;
    sharedWabaDisplayNumber: string | null;
    catalogMaterials: CatalogMaterial[];
    catalogPrestationTypes: PrestationType[];
    whatsappConfig: WhatsAppConfig | null;
    catalogContext: ResolvedCatalogContext;
    currentRoleSlug: string | null;
    organizationExports: OrganizationExportListItem[];
    modules: OrganizationModules;
};

export default function SettingsClient({ initialFullName, initialEmail, members, roles, joinCode, organization, appUrl, supabaseUrl, sharedWabaDisplayNumber, catalogMaterials, catalogPrestationTypes, whatsappConfig, catalogContext, currentRoleSlug, organizationExports, modules }: Props) {
    const router = useRouter()
    const webhookUrl = supabaseUrl
        ? `${supabaseUrl}/functions/v1/whatsapp-webhook`
        : 'https://[ref].supabase.co/functions/v1/whatsapp-webhook'
    const [activeTab, setActiveTab] = useState('profil');
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRoleId, setInviteRoleId] = useState(roles[0]?.id ?? '');
    const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [codeCopied, setCodeCopied] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [orgSaveStatus, setOrgSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [emailSaveStatus, setEmailSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [emailSettings, setEmailSettings] = useState({
        from_name: organization?.email_from_name ?? '',
        from_address: organization?.email_from_address ?? '',
    });

    // Logo upload
    const [logoPreview, setLogoPreview] = useState<string>(organization?.logo_url ?? '')
    const [logoUploading, setLogoUploading] = useState(false)
    const logoFileRef = useRef<HTMLInputElement>(null)

    async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setLogoPreview(URL.createObjectURL(file))
        setLogoUploading(true)
        try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const ext = file.name.split('.').pop()
            const path = `${user.id}/logo.${ext}`
            const { error } = await supabase.storage.from('logos').upload(path, file, { upsert: true })
            if (!error) {
                const { data } = supabase.storage.from('logos').getPublicUrl(path)
                await updateOrganization({ logo_url: data.publicUrl })
            }
        } finally {
            setLogoUploading(false)
        }
    }

    const initialBusinessSelection = resolveBusinessSelection({
        activityId: organization?.business_activity_id,
        sector: organization?.sector,
        businessProfile: organization?.business_profile,
    });

    const [companyDetails, setCompanyDetails] = useState({
        name: organization?.name ?? '',
        siret: organization?.siret ?? '',
        tva: organization?.vat_number ?? '',
        address_line1: organization?.address_line1 ?? '',
        postal_code: organization?.postal_code ?? '',
        city: organization?.city ?? '',
        email: organization?.email ?? '',
        phone: organization?.phone ?? '',
        business_activity: initialBusinessSelection.activity.id as BusinessActivityId,
    });

    const [legalDetails, setLegalDetails] = useState({
        forme_juridique: organization?.forme_juridique ?? '',
        capital_social: organization?.capital_social ?? '',
        rcs: organization?.rcs ?? '',
        rcs_ville: organization?.rcs_ville ?? '',
        insurance_info: organization?.insurance_info ?? '',
        certifications: organization?.certifications ?? '',
    });

    const [paymentDetails, setPaymentDetails] = useState({
        iban: organization?.iban ?? '',
        bic: organization?.bic ?? '',
        bank_name: organization?.bank_name ?? '',
        payment_terms_days: organization?.payment_terms_days ?? 30,
        late_penalty_rate: organization?.late_penalty_rate ?? 3,
        court_competent: organization?.court_competent ?? '',
        recovery_indemnity_text: organization?.recovery_indemnity_text ?? 'Toute facture non réglée à son échéance entraîne l\'application de pénalités de retard et d\'une indemnité forfaitaire de recouvrement de 40 €.',
    });

    const [vatConfig, setVatConfig] = useState({
        is_vat_subject: organization?.is_vat_subject ?? true,
        default_vat_rate: organization?.default_vat_rate ?? 20,
    });

    const [autoReminder, setAutoReminder] = useState({
        enabled: organization?.auto_reminder_enabled ?? false,
        invoiceDays: organization?.invoice_reminder_days ?? [2, 7],
        quoteDays: organization?.quote_reminder_days ?? [3, 7, 10],
        reminderHour: organization?.reminder_hour_utc ?? 8,
    });
    const [autoReminderSaveStatus, setAutoReminderSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const [publicFormSettings, setPublicFormSettings] = useState({
        enabled: organization?.public_form_enabled ?? false,
        welcomeMessage: organization?.public_form_welcome_message ?? '',
        customModeEnabled: organization?.public_form_custom_mode_enabled ?? true,
        notificationEmail: organization?.public_form_notification_email ?? '',
        catalogItemIds: (organization?.public_form_catalog_item_ids ?? []) as Array<{ id: string; item_type: 'material' | 'prestation' }>,
    });
    const [publicFormSaveStatus, setPublicFormSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [exportSaveStatus, setExportSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [exportFeedback, setExportFeedback] = useState<string | null>(null);
    const [moduleSettings, setModuleSettings] = useState<OrganizationModules>(modules);
    const [modulesSaveStatus, setModulesSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // ─── WhatsApp ─────────────────────────────────────────────────────────────
    const [waPhoneNumberId, setWaPhoneNumberId] = useState(whatsappConfig?.phone_number_id ?? '')
    const [waWabaId, setWaWabaId] = useState(whatsappConfig?.waba_id ?? '')
    const [waAccessToken, setWaAccessToken] = useState(whatsappConfig?.access_token ?? '')
    const defaultVerifyToken = whatsappConfig?.verify_token ?? crypto.randomUUID().replace(/-/g, '')
    const [waVerifyToken, setWaVerifyToken] = useState(defaultVerifyToken)
    const [waAuthorizedNumbers, setWaAuthorizedNumbers] = useState<string[]>(whatsappConfig?.authorized_numbers ?? [])
    const [waAuthorizedContacts, setWaAuthorizedContacts] = useState<{ number: string; label: string }[]>(whatsappConfig?.authorized_contacts ?? [])
    const [waUseSharedWaba, setWaUseSharedWaba] = useState(whatsappConfig?.use_shared_waba ?? false)
    const [waIsActive, setWaIsActive] = useState(whatsappConfig?.is_active ?? true)
    const [waSaveStatus, setWaSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [waNumberInput, setWaNumberInput] = useState('')
    const [waLabelInput, setWaLabelInput] = useState('')
    const [waShowAdvanced, setWaShowAdvanced] = useState(false)
    const currentBusinessSelection = resolveBusinessSelection({ activityId: companyDetails.business_activity })
    const deletionRequestHref = buildDeletionRequestMailto({
        requesterEmail: initialEmail,
        orgName: organization?.name ?? null,
    })
    const privacyContactLabel = legalContactLabel(LEGAL_CONTACT.privacyEmail ?? LEGAL_CONTACT.supportEmail)
    const isOwner = currentRoleSlug === 'owner'
    const hasProcessingExport = organizationExports.some((item) => item.status === 'processing')

    function formatExportDate(value: string | null) {
        if (!value) return 'En attente'
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(value))
    }

    function formatFileSize(value: number | null) {
        if (!value) return 'Taille en attente'
        const units = ['o', 'Ko', 'Mo', 'Go']
        let size = value
        let unitIndex = 0
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024
            unitIndex += 1
        }
        return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`
    }

    function exportStatusBadge(status: OrganizationExportListItem['status']) {
        if (status === 'ready') return 'bg-green-500/10 text-green-600 border-green-500/20'
        if (status === 'failed') return 'bg-red-500/10 text-red-500 border-red-500/20'
        if (status === 'expired') return 'bg-secondary/10 text-secondary border-[var(--elevation-border)]'
        return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    }

    function exportStatusLabel(status: OrganizationExportListItem['status']) {
        if (status === 'ready') return 'Pret'
        if (status === 'failed') return 'Echoue'
        if (status === 'expired') return 'Expire'
        return 'En cours'
    }

    function handleCreateOrganizationExport() {
        setExportFeedback(null)
        setExportSaveStatus('saving')
        startTransition(async () => {
            const result = await createOrganizationExport()
            if (result.error) {
                setExportSaveStatus('error')
                setExportFeedback(result.error)
                setTimeout(() => setExportSaveStatus('idle'), 3000)
                return
            }

            setExportSaveStatus('saved')
            setExportFeedback(result.warning ?? "L'export a ete genere. Un lien securise est disponible ci-dessous et un email a ete envoye a l'owner.")
            router.refresh()
            setTimeout(() => setExportSaveStatus('idle'), 3000)
        })
    }

    function togglePublicCatalogItem(id: string, item_type: 'material' | 'prestation') {
        setPublicFormSettings(prev => {
            const exists = prev.catalogItemIds.some(x => x.id === id)
            return {
                ...prev,
                catalogItemIds: exists
                    ? prev.catalogItemIds.filter(x => x.id !== id)
                    : [...prev.catalogItemIds, { id, item_type }],
            }
        })
    }

    function handleSaveModules() {
        setModulesSaveStatus('saving');
        startTransition(async () => {
            const result = await updateOrganizationModules(moduleSettings);
            if (result.error) {
                setModulesSaveStatus('error');
                setTimeout(() => setModulesSaveStatus('idle'), 3000);
            } else {
                setModulesSaveStatus('saved');
                setTimeout(() => setModulesSaveStatus('idle'), 2000);
            }
        });
    }

    function handleSavePublicForm() {
        setPublicFormSaveStatus('saving');
        startTransition(async () => {
            const result = await updatePublicFormSettings({
                public_form_enabled: publicFormSettings.enabled,
                public_form_welcome_message: publicFormSettings.welcomeMessage || null,
                public_form_catalog_item_ids: publicFormSettings.catalogItemIds,
                public_form_custom_mode_enabled: publicFormSettings.customModeEnabled,
                public_form_notification_email: publicFormSettings.notificationEmail || null,
            });
            if (result.error) {
                setPublicFormSaveStatus('error');
                setTimeout(() => setPublicFormSaveStatus('idle'), 3000);
            } else {
                setPublicFormSaveStatus('saved');
                setTimeout(() => setPublicFormSaveStatus('idle'), 2000);
            }
        });
    }

    function handleSaveAutoReminder() {
        setAutoReminderSaveStatus('saving');
        startTransition(async () => {
            const result = await updateOrganization({
                auto_reminder_enabled: autoReminder.enabled,
                invoice_reminder_days: autoReminder.invoiceDays.filter(d => d > 0),
                quote_reminder_days: autoReminder.quoteDays.filter(d => d > 0),
                reminder_hour_utc: autoReminder.reminderHour,
            });
            if (result.error) {
                setAutoReminderSaveStatus('error');
                setTimeout(() => setAutoReminderSaveStatus('idle'), 3000);
            } else {
                setAutoReminderSaveStatus('saved');
                setTimeout(() => setAutoReminderSaveStatus('idle'), 2000);
            }
        });
    }

    function copyCode() {
        if (!joinCode) return;
        navigator.clipboard.writeText(joinCode);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
    }

    function handleRoleChange(membershipId: string, newRoleId: string) {
        startTransition(async () => {
            await updateMemberRole(membershipId, newRoleId);
        });
    }

    function handleRemove(membershipId: string) {
        if (!confirm('Retirer ce membre ? Il perdra l\'accès immédiatement.')) return;
        startTransition(async () => {
            await removeMember(membershipId);
        });
    }

    function handleSaveEmailSettings() {
        setEmailSaveStatus('saving');
        startTransition(async () => {
            const fd = new FormData();
            fd.append('email_from_name', emailSettings.from_name);
            fd.append('email_from_address', emailSettings.from_address);
            const result = await updateEmailSettings(fd);
            if (result.error) {
                setEmailSaveStatus('error');
                setTimeout(() => setEmailSaveStatus('idle'), 3000);
            } else {
                setEmailSaveStatus('saved');
                setTimeout(() => setEmailSaveStatus('idle'), 2000);
            }
        });
    }

    function handleSaveOrganization() {
        setOrgSaveStatus('saving');
        startTransition(async () => {
            const selection = resolveBusinessSelection({ activityId: companyDetails.business_activity });
            const result = await updateOrganization({
                name: companyDetails.name,
                siret: companyDetails.siret,
                vat_number: companyDetails.tva,
                email: companyDetails.email,
                phone: companyDetails.phone,
                address_line1: companyDetails.address_line1 || null,
                postal_code: companyDetails.postal_code || null,
                city: companyDetails.city || null,
                business_profile: selection.businessProfile,
                business_activity_id: selection.activity.id,
                sector: selection.sectorLabel,
                label_set: selection.profileConfig.labelSet,
                unit_set: selection.profileConfig.unitSet,
                default_categories: selection.profileConfig.defaultCategories,
                starter_presets: selection.profileConfig.starterPresets,
                forme_juridique: legalDetails.forme_juridique || null,
                capital_social: legalDetails.capital_social || null,
                rcs: legalDetails.rcs || null,
                rcs_ville: legalDetails.rcs_ville || null,
                insurance_info: legalDetails.insurance_info || null,
                certifications: legalDetails.certifications || null,
                iban: paymentDetails.iban || null,
                bic: paymentDetails.bic || null,
                bank_name: paymentDetails.bank_name || null,
                payment_terms_days: paymentDetails.payment_terms_days || null,
                late_penalty_rate: paymentDetails.late_penalty_rate || null,
                court_competent: paymentDetails.court_competent || null,
                recovery_indemnity_text: paymentDetails.recovery_indemnity_text || null,
                is_vat_subject: vatConfig.is_vat_subject,
                default_vat_rate: vatConfig.is_vat_subject ? vatConfig.default_vat_rate : 0,
            });
            if (result.error) {
                setOrgSaveStatus('error');
                setTimeout(() => setOrgSaveStatus('idle'), 3000);
            } else {
                setOrgSaveStatus('saved');
                setTimeout(() => setOrgSaveStatus('idle'), 2000);
            }
        });
    }

    function renderOrganizationSaveButton(extraClassName = '') {
        return (
            <button
                onClick={handleSaveOrganization}
                disabled={isPending || orgSaveStatus === 'saving'}
                className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                    orgSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                    orgSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                    'bg-accent text-black shadow-accent/20'
                } ${extraClassName}`}
            >
                <Save className="w-4 h-4" />
                {orgSaveStatus === 'saving' ? 'Enregistrement...' :
                 orgSaveStatus === 'saved' ? 'Enregistré !' :
                 orgSaveStatus === 'error' ? 'Erreur' :
                 'Sauvegarder'}
            </button>
        );
    }

    // Découpage prénom / nom depuis full_name
    const initialFirstName = initialFullName?.split(' ')[0] ?? '';
    const initialLastName = initialFullName?.split(' ').slice(1).join(' ') ?? '';

    const [profileFields, setProfileFields] = useState({
        first_name: initialFirstName,
        last_name: initialLastName,
        email: initialEmail ?? '',
    });
    const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    const [passwordFields, setPasswordFields] = useState({ password: '', confirm: '' });
    const [passwordSaveStatus, setPasswordSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [passwordError, setPasswordError] = useState<string | null>(null);

    function handleSaveProfile() {
        setProfileSaveStatus('saving');
        startTransition(async () => {
            const fd = new FormData();
            fd.append('first_name', profileFields.first_name);
            fd.append('last_name', profileFields.last_name);
            fd.append('email', profileFields.email);
            const result = await updateProfile(fd);
            if (result.error) {
                setProfileSaveStatus('error');
                setTimeout(() => setProfileSaveStatus('idle'), 3000);
            } else {
                setProfileSaveStatus('saved');
                setTimeout(() => setProfileSaveStatus('idle'), 2000);
            }
        });
    }

    function handleSavePassword() {
        setPasswordError(null);
        if (!passwordFields.password || passwordFields.password.length < 8) {
            setPasswordError('Le mot de passe doit contenir au moins 8 caractères.');
            return;
        }
        if (passwordFields.password !== passwordFields.confirm) {
            setPasswordError('Les mots de passe ne correspondent pas.');
            return;
        }
        setPasswordSaveStatus('saving');
        startTransition(async () => {
            const fd = new FormData();
            fd.append('password', passwordFields.password);
            fd.append('confirm', passwordFields.confirm);
            const result = await updatePassword(fd);
            if (result.error) {
                setPasswordError(result.error);
                setPasswordSaveStatus('error');
                setTimeout(() => setPasswordSaveStatus('idle'), 3000);
            } else {
                setPasswordSaveStatus('saved');
                setPasswordFields({ password: '', confirm: '' });
                setTimeout(() => setPasswordSaveStatus('idle'), 2000);
            }
        });
    }

    const renderContent = () => {
        if (activeTab === 'profil') {
            return (
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-8">
                    <div><h2 className="text-2xl font-bold text-primary mb-6">Mon Profil</h2>
                        <div className="flex flex-col md:flex-row gap-8">
                            <div className="flex-shrink-0">
                                <div className="w-32 h-32 rounded-2xl bg-accent flex items-center justify-center">
                                    <span className="text-3xl font-bold text-black">
                                        {[profileFields.first_name, profileFields.last_name].filter(Boolean).map(n => n[0].toUpperCase()).join('') || profileFields.email?.[0]?.toUpperCase() || '?'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Prénom</label><input type="text" value={profileFields.first_name} onChange={e => setProfileFields(f => ({ ...f, first_name: e.target.value }))} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                                <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Nom</label><input type="text" value={profileFields.last_name} onChange={e => setProfileFields(f => ({ ...f, last_name: e.target.value }))} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                                <div className="space-y-2 md:col-span-2"><label className="text-sm font-semibold text-secondary">Email</label><input type="email" value={profileFields.email} onChange={e => setProfileFields(f => ({ ...f, email: e.target.value }))} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            </div>
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div><h2 className="text-2xl font-bold text-primary mb-6">Sécurité</h2>
                        {passwordError && (
                            <p className="mb-4 text-sm text-red-400">{passwordError}</p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Nouveau mot de passe</label><input type="password" value={passwordFields.password} onChange={e => setPasswordFields(f => ({ ...f, password: e.target.value }))} placeholder="Minimum 8 caractères" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Confirmer le mot de passe</label><input type="password" value={passwordFields.confirm} onChange={e => setPasswordFields(f => ({ ...f, confirm: e.target.value }))} placeholder="••••••••" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                        </div>
                        <div className="pt-4 flex justify-end">
                            <button
                                onClick={handleSavePassword}
                                disabled={isPending || passwordSaveStatus === 'saving'}
                                className={`px-6 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                    passwordSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                    passwordSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                    'bg-white/10 text-primary shadow-black/10'
                                }`}
                            >
                                <KeyRound className="w-4 h-4" />
                                {passwordSaveStatus === 'saving' ? 'Enregistrement...' :
                                 passwordSaveStatus === 'saved' ? 'Mot de passe mis à jour !' :
                                 passwordSaveStatus === 'error' ? 'Erreur' :
                                 'Changer le mot de passe'}
                            </button>
                        </div>
                    </div>
                    <div className="pt-2 flex justify-end">
                        <button
                            onClick={handleSaveProfile}
                            disabled={isPending || profileSaveStatus === 'saving'}
                            className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                profileSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                profileSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                'bg-accent text-black shadow-accent/20'
                            }`}
                        >
                            <Save className="w-4 h-4" />
                            {profileSaveStatus === 'saving' ? 'Enregistrement...' :
                             profileSaveStatus === 'saved' ? 'Enregistré !' :
                             profileSaveStatus === 'error' ? 'Erreur' :
                             'Mettre à jour le profil'}
                        </button>
                    </div>
                </div>
            );
        }

        if (activeTab === 'entreprise') {
            return (
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-2xl font-bold text-primary">Identité de l&#39;entreprise</h2>
                            <p className="text-sm text-secondary mt-1">Modifiez vos informations puis sauvegardez quand vous êtes prêt.</p>
                        </div>
                        {renderOrganizationSaveButton('w-full sm:w-auto justify-center shrink-0')}
                    </div>
                    <div>
                        <div className="flex flex-col md:flex-row gap-8">
                            <div className="flex-shrink-0">
                                <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                                <button
                                    type="button"
                                    onClick={() => logoFileRef.current?.click()}
                                    disabled={logoUploading}
                                    className="w-32 h-32 border-2 border-dashed border-[var(--elevation-border)] flex flex-col items-center justify-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all group rounded-2xl overflow-hidden relative disabled:opacity-60"
                                >
                                    {logoPreview ? (
                                        <>
                                            <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <Upload className="w-6 h-6 text-white" />
                                            </div>
                                        </>
                                    ) : logoUploading ? (
                                        <Loader2 className="w-8 h-8 text-accent animate-spin" />
                                    ) : (
                                        <>
                                            <ImageIcon className="w-8 h-8 text-secondary group-hover:text-accent mb-2 transition-colors" />
                                            <span className="text-xs text-secondary font-medium">Logo</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Nom de l&#39;entreprise</label><input type="text" value={companyDetails.name} onChange={e => setCompanyDetails({ ...companyDetails, name: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                                <div className="space-y-2"><label className="text-sm font-semibold text-secondary">SIRET</label><input type="text" value={companyDetails.siret} onChange={e => setCompanyDetails({ ...companyDetails, siret: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                                <div className="space-y-2"><label className="text-sm font-semibold text-secondary">TVA Intracommunautaire</label><input type="text" value={companyDetails.tva} onChange={e => setCompanyDetails({ ...companyDetails, tva: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                            </div>
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div className="rounded-2xl bg-base dark:bg-white/5 border border-[var(--elevation-border)] p-6 space-y-5">
                        <div>
                            <h2 className="text-2xl font-bold text-primary">Profil métier</h2>
                            <p className="text-sm text-secondary mt-1">Choisissez l’activité de référence qui correspond le mieux à votre entreprise.</p>
                        </div>

                        <div className="space-y-4">
                            {Object.entries(BUSINESS_ACTIVITIES_BY_PROFILE).map(([profileKey, activities]) => (
                                <div key={profileKey} className="space-y-2">
                                    <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                                        {resolveBusinessSelection({ businessProfile: profileKey }).profileConfig.onboardingLabel}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {activities.map((activity) => (
                                            <button
                                                key={activity.id}
                                                type="button"
                                                onClick={() => setCompanyDetails({ ...companyDetails, business_activity: activity.id })}
                                                className={`p-4 rounded-2xl border text-left transition-all ${
                                                    companyDetails.business_activity === activity.id
                                                        ? 'border-accent bg-accent/10 text-primary'
                                                        : 'border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03] text-secondary hover:text-primary hover:border-accent/40'
                                                }`}
                                            >
                                                <span className="block text-sm font-semibold">{activity.label}</span>
                                                <span className="mt-1 block text-xs leading-relaxed opacity-80">{activity.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03] p-4">
                            <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-1">Activité de référence</p>
                            <p className="text-sm font-semibold text-primary">{currentBusinessSelection.activity.label}</p>
                            <p className="text-xs text-secondary mt-1">Cela sert de base pour adapter l’expérience, sans limiter le reste de votre activité.</p>
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div><h2 className="text-2xl font-bold text-primary mb-6">Coordonnées</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2 md:col-span-2"><label className="text-sm font-semibold text-secondary">Adresse (rue, n°)</label><input type="text" placeholder="Ex : 12 rue de la Paix" value={companyDetails.address_line1} onChange={e => setCompanyDetails({ ...companyDetails, address_line1: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Code postal</label><input type="text" placeholder="Ex : 69007" value={companyDetails.postal_code} onChange={e => setCompanyDetails({ ...companyDetails, postal_code: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Ville</label><input type="text" placeholder="Ex : Lyon" value={companyDetails.city} onChange={e => setCompanyDetails({ ...companyDetails, city: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Email de contact</label><input type="email" value={companyDetails.email} onChange={e => setCompanyDetails({ ...companyDetails, email: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Téléphone</label><input type="tel" value={companyDetails.phone} onChange={e => setCompanyDetails({ ...companyDetails, phone: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-2">Mentions légales</h2>
                        <p className="text-sm text-secondary mb-6">Ces informations apparaîtront en pied de page de vos devis et factures PDF.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Forme juridique</label><input type="text" placeholder="Ex : SAS, SARL, EI…" value={legalDetails.forme_juridique} onChange={e => setLegalDetails({ ...legalDetails, forme_juridique: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Capital social</label><input type="text" placeholder="Ex : 10 000 €" value={legalDetails.capital_social} onChange={e => setLegalDetails({ ...legalDetails, capital_social: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">N° RCS</label><input type="text" placeholder="Ex : 123 456 789" value={legalDetails.rcs} onChange={e => setLegalDetails({ ...legalDetails, rcs: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" /></div>
                            <div className="space-y-2"><label className="text-sm font-semibold text-secondary">Ville du tribunal de commerce</label><input type="text" placeholder="Ex : Paris" value={legalDetails.rcs_ville} onChange={e => setLegalDetails({ ...legalDetails, rcs_ville: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2 md:col-span-2"><label className="text-sm font-semibold text-secondary">Assurance professionnelle</label><input type="text" placeholder="Ex : AXA Pro n° 123456" value={legalDetails.insurance_info} onChange={e => setLegalDetails({ ...legalDetails, insurance_info: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                            <div className="space-y-2 md:col-span-2"><label className="text-sm font-semibold text-secondary">Certifications / Qualifications</label><input type="text" placeholder="Ex : RGE Qualibat 7711, Qualifélec…" value={legalDetails.certifications} onChange={e => setLegalDetails({ ...legalDetails, certifications: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" /></div>
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-2">TVA</h2>
                        <p className="text-sm text-secondary mb-6">Détermine comment la TVA est affichée sur vos devis et factures.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3 md:col-span-2">
                                <label className="text-sm font-semibold text-secondary">Régime TVA</label>
                                <div className="flex flex-col gap-3">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <input
                                            type="radio"
                                            name="vat_subject"
                                            checked={vatConfig.is_vat_subject}
                                            onChange={() => setVatConfig({ ...vatConfig, is_vat_subject: true })}
                                            className="mt-1 accent-[var(--accent)]"
                                        />
                                        <div>
                                            <p className="font-semibold text-primary">Assujetti à la TVA</p>
                                            <p className="text-xs text-secondary">La TVA est calculée et affichée sur tous les documents.</p>
                                        </div>
                                    </label>
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <input
                                            type="radio"
                                            name="vat_subject"
                                            checked={!vatConfig.is_vat_subject}
                                            onChange={() => setVatConfig({ ...vatConfig, is_vat_subject: false })}
                                            className="mt-1 accent-[var(--accent)]"
                                        />
                                        <div>
                                            <p className="font-semibold text-primary">Franchise en base de TVA <span className="text-secondary font-normal">(art. 293B CGI)</span></p>
                                            <p className="text-xs text-secondary">Aucune TVA facturée. La mention légale sera automatiquement ajoutée aux PDFs.</p>
                                        </div>
                                    </label>
                                </div>
                            </div>
                            {vatConfig.is_vat_subject && (
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold text-secondary">Taux TVA par défaut (%)</label>
                                    <select
                                        value={vatConfig.default_vat_rate}
                                        onChange={e => setVatConfig({ ...vatConfig, default_vat_rate: Number(e.target.value) })}
                                        className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
                                    >
                                        {LEGAL_VAT_RATES.map(rate => (
                                            <option key={rate} value={rate}>
                                                {rate === 20 ? '20 % : taux normal (neuf, travaux neufs)' :
                                                 rate === 10 ? '10 % : taux intermédiaire (rénovation logement)' :
                                                 rate === 5.5 ? '5,5 % : taux réduit (amélioration énergétique)' :
                                                 '0 % : exonéré'}
                                            </option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-secondary">Appliqué par défaut sur les nouvelles lignes de devis et factures. Modifiable ligne par ligne.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="h-px w-full bg-[var(--elevation-border)]"></div>
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-2">Paiement &amp; RIB</h2>
                        <p className="text-sm text-secondary mb-6">Ces informations apparaissent sur vos factures PDF. L&apos;IBAN est obligatoire pour permettre le virement bancaire.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-semibold text-secondary">IBAN</label>
                                <input type="text" placeholder="FR76 3000 6000 0112 3456 7890 189" value={paymentDetails.iban} onChange={e => setPaymentDetails({ ...paymentDetails, iban: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all font-mono tracking-wider" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-secondary">BIC / SWIFT</label>
                                <input type="text" placeholder="Ex : BNPAFRPPXXX" value={paymentDetails.bic} onChange={e => setPaymentDetails({ ...paymentDetails, bic: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all font-mono tracking-wider uppercase" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-secondary">Nom de la banque</label>
                                <input type="text" placeholder="Ex : BNP Paribas" value={paymentDetails.bank_name} onChange={e => setPaymentDetails({ ...paymentDetails, bank_name: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-secondary">Délai de paiement (jours)</label>
                                <input type="number" min={0} max={90} value={paymentDetails.payment_terms_days} onChange={e => setPaymentDetails({ ...paymentDetails, payment_terms_days: Number(e.target.value) })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-secondary">Taux pénalités de retard (%)</label>
                                <input type="number" min={0} step={0.01} value={paymentDetails.late_penalty_rate} onChange={e => setPaymentDetails({ ...paymentDetails, late_penalty_rate: Number(e.target.value) })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" />
                                <p className="text-xs text-secondary">Taux légal minimum = 3× le taux d&apos;intérêt légal. Souvent fixé à 10%.</p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-secondary">Tribunal compétent</label>
                                <input type="text" placeholder="Ex : Tribunal de commerce de Paris" value={paymentDetails.court_competent} onChange={e => setPaymentDetails({ ...paymentDetails, court_competent: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-semibold text-secondary">Mention indemnité de recouvrement <span className="text-accent font-normal">(obligatoire)</span></label>
                                <textarea rows={2} value={paymentDetails.recovery_indemnity_text} onChange={e => setPaymentDetails({ ...paymentDetails, recovery_indemnity_text: e.target.value })} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all text-sm resize-none" />
                                <p className="text-xs text-secondary">Art. L441-10 du Code de commerce : indemnité forfaitaire de 40 € obligatoire entre professionnels.</p>
                            </div>
                        </div>
                    </div>
                    <div className="pt-6 flex justify-end">
                        {renderOrganizationSaveButton()}
                    </div>
                </div>
            );
        }

        if (activeTab === 'equipe') {
            return (
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-8 relative">

                    {/* Code entreprise */}
                    {joinCode && (
                        <div className="flex items-center justify-between p-4 rounded-2xl bg-base dark:bg-white/5 border border-[var(--elevation-border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
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
                        <button onClick={() => setIsInviteModalOpen(true)} className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
                            <Plus className="w-4 h-4" />Inviter par email
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-[var(--elevation-border)]">
                                    <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Membre</th>
                                    <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Poste</th>
                                    <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Rôle</th>
                                    <th className="pb-4 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--elevation-border)]">
                                {members.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-secondary text-sm">
                                            Aucun membre pour l&#39;instant.
                                        </td>
                                    </tr>
                                ) : members.map((member) => {
                                    const initials = (member.full_name ?? member.email)
                                        .split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                                    return (
                                        <tr key={member.membership_id} className="group">
                                            <td className="py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                                                        {initials}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-primary">{member.full_name ?? '/'}</p>
                                                        <p className="text-xs text-secondary">{member.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-4 text-sm text-secondary">
                                                {member.job_title ?? <span className="text-secondary/40">/</span>}
                                            </td>
                                            <td className="py-4">
                                                <select
                                                    defaultValue={member.role_id}
                                                    disabled={isPending || member.role_slug === 'owner'}
                                                    onChange={(e) => handleRoleChange(member.membership_id, e.target.value)}
                                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-accent/10 text-accent border border-accent/20 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {/* Owner non-modifiable */}
                                                    {member.role_slug === 'owner' && (
                                                        <option value={member.role_id}>{member.role_name}</option>
                                                    )}
                                                    {/* Autres rôles */}
                                                    {member.role_slug !== 'owner' && roles.map((r) => (
                                                        <option key={r.id} value={r.id}>{r.name}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="py-4 text-right">
                                                {member.role_slug !== 'owner' && (
                                                    <ActionMenu actions={[
                                                        {
                                                            label: "Retirer l'accès",
                                                            icon: <Trash2 className="w-4 h-4" />,
                                                            danger: true,
                                                            onClick: () => handleRemove(member.membership_id),
                                                        },
                                                    ]} />
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Modal invitation email */}
                    {isInviteModalOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                            <div className="rounded-3xl card transition-all duration-300 ease-out w-full max-w-md p-8 relative animate-in fade-in zoom-in duration-300">
                                <button
                                    onClick={() => { setIsInviteModalOpen(false); setInviteStatus('idle'); setInviteError(null); setInviteEmail(''); }}
                                    className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                                <h2 className="text-2xl font-bold text-primary mb-6">Inviter un collaborateur</h2>

                                {inviteStatus === 'sent' ? (
                                    <div className="flex flex-col items-center text-center gap-4 py-4">
                                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
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

        if (activeTab === 'emails') {
            return (
                <div className="space-y-6">

                {/* Relances automatiques — en premier */}
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
                                    <p className="text-xs text-secondary mt-0.5">Jours après l&apos;échéance de la facture (J+X).</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {autoReminder.invoiceDays.map((day, i) => (
                                        <div key={i} className="flex items-center gap-1.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] rounded-xl px-3 py-2">
                                            <span className="text-xs text-secondary font-medium">J+</span>
                                            <input type="number" min={1} max={365} value={day}
                                                onChange={e => { const v = parseInt(e.target.value) || 1; setAutoReminder(a => ({ ...a, invoiceDays: a.invoiceDays.map((d, j) => j === i ? v : d) })) }}
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
                                Les emails de relance sont rédigés automatiquement. Les clients sans adresse email sont ignorés.
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

                {/* Configuration expéditeur */}
                <div className="rounded-3xl card transition-all duration-300 ease-out p-8 space-y-6">
                    <div>
                        <h2 className="text-2xl font-bold text-primary mb-1">Configuration email</h2>
                        <p className="text-sm text-secondary">Adresse utilisée pour l&apos;envoi des invitations et des emails métier (devis, factures, relances).</p>
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
                                className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all"
                            />
                            <p className="text-xs text-secondary">Doit être vérifiée sur votre compte <strong>Resend</strong>.</p>
                        </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-accent/5 border border-accent/20 text-sm text-secondary leading-relaxed">
                        <strong className="text-primary">Comment configurer Resend ?</strong><br/>
                        Créez un compte gratuit sur <span className="text-accent font-medium">resend.com</span>, vérifiez votre domaine (3 entrées DNS), copiez votre clé API dans <code className="bg-base px-1.5 py-0.5 rounded text-xs">.env.local</code> sous <code className="bg-base px-1.5 py-0.5 rounded text-xs">RESEND_API_KEY</code>, puis renseignez votre adresse ci-dessus.
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
                            <p className="text-sm text-secondary">Sélectionnez les {catalogContext.labelSet.material.plural.toLowerCase()} et {catalogContext.labelSet.bundleTemplate.plural.toLowerCase()} à exposer à vos prospects. Les prix, marges et coûts internes ne sont jamais affichés.</p>
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
                                        const selected = publicFormSettings.catalogItemIds.some(x => x.id === m.id)
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
                                        const selected = publicFormSettings.catalogItemIds.some(x => x.id === p.id)
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

                        {catalogMaterials.length === 0 && catalogPrestationTypes.length === 0 && (
                            <p className="text-sm text-secondary text-center py-6">Aucun élément dans votre catalogue. Ajoutez des matériaux ou des prestations types dans l&apos;onglet Catalogue.</p>
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

                    <div className="rounded-3xl card p-8 space-y-6">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Fermeture de compte et suppression</h2>
                                <p className="text-sm text-slate-700 dark:text-zinc-300 max-w-2xl">
                                    La clôture définitive demande quelques vérifications. Vous pouvez dans un premier temps sauvegarder toutes vos informations, puis faire une demande auprès de notre support.
                                </p>
                            </div>
                            <div className="rounded-2xl border border-[var(--elevation-border)] bg-slate-50 dark:bg-white/5 px-4 py-3">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400">Contact support</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{privacyContactLabel}</p>
                            </div>
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
                                            <div key={item.id} className="rounded-2xl border border-[var(--elevation-border)] bg-surface/60 p-4">
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
                                Pour des obligations comptables et fiscales, vos devis et factures créés doivent être conservés par nos soins (même après la fermeture du compte) conformément à la loi. Nous supprimerons toutes vos autres données personnelles et éléments non soumis à la législation.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            {deletionRequestHref ? (
                                <a
                                    href={deletionRequestHref}
                                    className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Demander la fermeture du compte
                                </a>
                            ) : (
                                <Link
                                    href={`${LEGAL_PATHS.legal}#contact`}
                                    target="_blank"
                                    className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
                                >
                                    <Mail className="w-4 h-4" />
                                    Voir le contact a configurer
                                </Link>
                            )}
                            <Link
                                href={`${LEGAL_PATHS.privacy}#suppression`}
                                target="_blank"
                                className="px-6 py-3 rounded-full border border-[var(--elevation-border)] text-primary font-bold flex items-center justify-center gap-2 hover:border-accent hover:text-accent transition-all"
                            >
                                <ShieldCheck className="w-4 h-4" />
                                Lire la politique détaillée
                            </Link>
                        </div>

                        <p className="text-xs text-secondary">
                            L&apos;export complet est automatise pour l&apos;owner. La suppression de donnees reste quant a elle traitee separement, avec confirmation et verification des obligations legales.
                        </p>
                    </div>
                </div>
            )
        }

        if (activeTab === 'whatsapp') {
            async function handleSaveWhatsApp() {
                setWaSaveStatus('saving')
                startTransition(async () => {
                    const result = await saveWhatsAppConfig({
                        phoneNumberId: waPhoneNumberId,
                        wabaId: waWabaId,
                        accessToken: waAccessToken,
                        verifyToken: waVerifyToken,
                        authorizedNumbers: waAuthorizedNumbers,
                        authorizedContacts: waAuthorizedContacts,
                        useSharedWaba: waUseSharedWaba,
                        isActive: waIsActive,
                    })
                    setWaSaveStatus(result.error ? 'error' : 'saved')
                    setTimeout(() => setWaSaveStatus('idle'), 3000)
                })
            }

            async function handleDeleteWhatsApp() {
                if (!confirm('Supprimer la configuration WhatsApp ?')) return
                startTransition(async () => {
                    await deleteWhatsAppConfig()
                    setWaPhoneNumberId('')
                    setWaAccessToken('')
                    setWaAuthorizedNumbers([])
                    setWaAuthorizedContacts([])
                })
            }

            function addContact() {
                const n = waNumberInput.trim()
                if (!n) return
                const alreadyExists = waAuthorizedContacts.some(c => c.number === n) || waAuthorizedNumbers.includes(n)
                if (alreadyExists) return
                setWaAuthorizedContacts(prev => [...prev, { number: n, label: waLabelInput.trim() }])
                setWaNumberInput('')
                setWaLabelInput('')
            }

            function removeContact(number: string) {
                setWaAuthorizedContacts(prev => prev.filter(c => c.number !== number))
                setWaAuthorizedNumbers(prev => prev.filter(n => n !== number))
            }

            const allContacts = [
                ...waAuthorizedContacts,
                ...waAuthorizedNumbers
                    .filter(n => !waAuthorizedContacts.some(c => c.number === n))
                    .map(n => ({ number: n, label: '' })),
            ]

            const canSave = waVerifyToken && (waUseSharedWaba || (waPhoneNumberId && waAccessToken))

            return (
                <div className="space-y-6">
                    <div className="bg-surface dark:bg-white/5 rounded-2xl p-6 border border-[var(--elevation-border)] space-y-6">
                        {/* En-tête */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                                <MessageSquare className="w-5 h-5 text-green-500" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-primary">Agent WhatsApp IA</h2>
                                <p className="text-secondary text-sm">Gérez vos chantiers et consultez vos données par message vocal ou texte.</p>
                            </div>
                            <div className="ml-auto">
                                <button
                                    onClick={() => setWaIsActive(v => !v)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all ${waIsActive ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-base text-secondary border border-[var(--elevation-border)]'}`}
                                >
                                    {waIsActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                                    {waIsActive ? 'Activé' : 'Désactivé'}
                                </button>
                            </div>
                        </div>

                        {/* Mode mutualisé vs propre WABA */}
                        <div className="bg-base rounded-xl border border-[var(--elevation-border)] overflow-hidden">
                            <button
                                onClick={() => setWaUseSharedWaba(v => !v)}
                                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent/5 transition-all text-left"
                            >
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${waUseSharedWaba ? 'bg-accent border-accent' : 'border-secondary/40'}`}>
                                    {waUseSharedWaba && <Check className="w-3 h-3 text-black" />}
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-primary">Utiliser le numéro bot Atelier (recommandé)</p>
                                    <p className="text-xs text-secondary">L&apos;agent répond depuis le numéro WhatsApp mutualisé Atelier — aucune configuration Meta requise de votre côté.</p>
                                </div>
                            </button>
                        </div>

                        {/* Mode propre WABA — affiché seulement si pas mutualisé */}
                        {!waUseSharedWaba && (
                            <div className="space-y-4">
                                {/* URL webhook */}
                                <div className="bg-base rounded-xl p-4 border border-[var(--elevation-border)]">
                                    <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
                                        <Code2 className="w-3.5 h-3.5" /> URL Webhook Meta
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-xs text-secondary font-mono break-all flex-1">{webhookUrl}</p>
                                        <CopyButton text={webhookUrl} />
                                    </div>
                                </div>

                                {/* Guide pas-à-pas */}
                                <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
                                    <div className="bg-green-500/8 border-b border-green-500/15 px-4 py-3 flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-green-500 flex-shrink-0" />
                                        <p className="font-bold text-primary text-sm">Configuration de votre propre numéro Meta</p>
                                    </div>
                                    <div className="divide-y divide-[var(--elevation-border)]">

                                        {/* Étape 1 */}
                                        <div className="px-4 py-4 flex gap-3">
                                            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-xs font-bold text-black">1</span>
                                            </div>
                                            <div className="space-y-1.5 flex-1">
                                                <p className="font-semibold text-primary text-sm">Créer votre application Meta</p>
                                                <p className="text-xs text-secondary leading-relaxed">
                                                    Rendez-vous sur <strong className="text-primary">developers.facebook.com</strong> → <strong className="text-primary">Mes apps</strong> → <strong className="text-primary">Créer une app</strong>.<br/>
                                                    Choisissez le type <strong className="text-primary">« Entreprise »</strong>, puis <strong className="text-primary">Ajouter un produit → WhatsApp → Configurer</strong>.
                                                </p>
                                            </div>
                                        </div>

                                        {/* Étape 2 — Phone Number ID */}
                                        <div className="px-4 py-4 flex gap-3">
                                            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-xs font-bold text-black">2</span>
                                            </div>
                                            <div className="space-y-2 flex-1">
                                                <p className="font-semibold text-primary text-sm">Phone Number ID</p>
                                                <p className="text-xs text-secondary">Dans votre app Meta → <strong className="text-primary">WhatsApp → Configuration de l&apos;API</strong>, menu déroulant <em>De</em> → icône ℹ️ → copiez le <strong className="text-primary">Phone Number ID</strong>.</p>
                                                <input
                                                    type="text"
                                                    value={waPhoneNumberId}
                                                    onChange={e => setWaPhoneNumberId(e.target.value)}
                                                    placeholder="123456789012345"
                                                    className="w-full px-3 py-2 rounded-lg bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:border-accent font-mono"
                                                />
                                            </div>
                                        </div>

                                        {/* Étape 3 — Token permanent */}
                                        <div className="px-4 py-4 flex gap-3">
                                            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-xs font-bold text-black">3</span>
                                            </div>
                                            <div className="space-y-2 flex-1">
                                                <p className="font-semibold text-primary text-sm">Token d&apos;accès <span className="text-red-500 font-normal text-xs">→ choisissez PERMANENT, pas temporaire</span></p>
                                                <p className="text-xs text-secondary">Dans votre app Meta → <strong className="text-primary">WhatsApp → Configuration de l&apos;API</strong> → <strong className="text-primary">Générer un token d&apos;accès</strong>. Choisissez impérativement <strong className="text-primary">Token permanent</strong> (valide à vie). Le token temporaire expire en 24h et l&apos;agent s&apos;arrêtera.</p>
                                                <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-secondary">
                                                    ⚠ Si le token commence par <code className="text-primary">EAAG</code> et fait moins de 200 caractères, c&apos;est un token temporaire — ne l&apos;utilisez pas.
                                                </div>
                                                <input
                                                    type="password"
                                                    value={waAccessToken}
                                                    onChange={e => setWaAccessToken(e.target.value)}
                                                    placeholder="EAAxxxxxxx... (token permanent, ~200 caractères)"
                                                    className="w-full px-3 py-2 rounded-lg bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:border-accent font-mono"
                                                />
                                            </div>
                                        </div>

                                        {/* Étape 4 — Webhook */}
                                        <div className="px-4 py-4 flex gap-3">
                                            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                                                <span className="text-xs font-bold text-black">4</span>
                                            </div>
                                            <div className="space-y-2 flex-1">
                                                <p className="font-semibold text-primary text-sm">Configurer le webhook</p>
                                                <p className="text-xs text-secondary">Dans votre app Meta → <strong className="text-primary">WhatsApp → Configuration → Webhooks → Configurer</strong>. Collez l&apos;URL et le Verify Token ci-dessous, puis cochez l&apos;abonnement <strong className="text-primary">messages</strong>.</p>
                                                <div className="space-y-2">
                                                    <div className="bg-base rounded-lg px-3 py-2 border border-[var(--elevation-border)]">
                                                        <p className="text-xs text-secondary/60 mb-1">URL de rappel</p>
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-xs font-mono text-primary break-all flex-1">{webhookUrl}</p>
                                                            <CopyButton text={webhookUrl} />
                                                        </div>
                                                    </div>
                                                    <div className="bg-base rounded-lg px-3 py-2 border border-[var(--elevation-border)]">
                                                        <p className="text-xs text-secondary/60 mb-1.5">Verify Token (généré automatiquement — copiez-le dans Meta)</p>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={waVerifyToken}
                                                                onChange={e => setWaVerifyToken(e.target.value)}
                                                                className="flex-1 px-2 py-1.5 rounded-lg bg-surface border border-[var(--elevation-border)] text-primary text-xs focus:outline-none focus:border-accent font-mono"
                                                            />
                                                            <CopyButton text={waVerifyToken} />
                                                            <button
                                                                onClick={() => setWaVerifyToken(crypto.randomUUID().replace(/-/g, ''))}
                                                                className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--elevation-border)] bg-base text-secondary hover:text-accent hover:border-accent transition-all"
                                                                title="Régénérer"
                                                            >
                                                                <RefreshCw className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Avancé — WABA ID */}
                                        <div className="px-4 py-3">
                                            <button
                                                onClick={() => setWaShowAdvanced(v => !v)}
                                                className="text-xs text-secondary hover:text-accent transition-colors flex items-center gap-1"
                                            >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${waShowAdvanced ? 'rotate-180' : ''}`} />
                                                Paramètres avancés (WABA ID — optionnel)
                                            </button>
                                            {waShowAdvanced && (
                                                <div className="mt-3">
                                                    <input
                                                        type="text"
                                                        value={waWabaId}
                                                        onChange={e => setWaWabaId(e.target.value)}
                                                        placeholder="WhatsApp Business Account ID"
                                                        className="w-full px-3 py-2 rounded-lg bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:border-accent font-mono"
                                                    />
                                                    <p className="text-xs text-secondary/60 mt-1">Optionnel — visible dans Meta Business Suite sous votre compte WABA.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Numéro bot Atelier — affiché uniquement en mode mutualisé */}
                        {waUseSharedWaba && sharedWabaDisplayNumber && (
                            <div className="bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-4 space-y-2">
                                <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Numéro de votre assistant WhatsApp</p>
                                <div className="flex items-center gap-3">
                                    <p className="text-xl font-bold text-primary font-mono tracking-wide">{sharedWabaDisplayNumber}</p>
                                    <CopyButton text={sharedWabaDisplayNumber} />
                                </div>
                                <p className="text-xs text-secondary">Enregistrez ce numéro dans vos contacts WhatsApp (ex&nbsp;: &laquo;&nbsp;Mon assistant Atelier&nbsp;&raquo;) et envoyez-lui un message pour commencer.</p>
                            </div>
                        )}

                        {/* Contacts autorisés (tous modes) */}
                        <div>
                            <label className="block text-sm font-semibold text-primary mb-1">
                                {waUseSharedWaba ? 'Vos numéros et ceux de votre équipe' : 'Numéros autorisés'}
                            </label>
                            <p className="text-xs text-secondary/70 mb-3">
                                {waUseSharedWaba
                                    ? "L'agent répond uniquement à ces numéros depuis le bot Atelier. Ajoutez votre numéro et ceux de votre équipe."
                                    : "Seuls ces numéros peuvent interroger l'agent. Laissez vide pour autoriser tous les numéros (déconseillé)."}
                            </p>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {allContacts.map(c => (
                                    <span key={c.number} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-sm">
                                        <span className="font-mono text-xs">{c.number}</span>
                                        {c.label && <span className="text-accent/70 text-xs">· {c.label}</span>}
                                        <button onClick={() => removeContact(c.number)}>
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                                {allContacts.length === 0 && (
                                    <span className="text-xs text-amber-500 flex items-center gap-1">⚠ Aucun filtre : tous les numéros sont autorisés</span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="tel"
                                    value={waNumberInput}
                                    onChange={e => setWaNumberInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContact() } }}
                                    placeholder="+33612345678"
                                    className="w-36 px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:border-accent font-mono"
                                />
                                <input
                                    type="text"
                                    value={waLabelInput}
                                    onChange={e => setWaLabelInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addContact() } }}
                                    placeholder="Prénom (optionnel)"
                                    className="flex-1 px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:border-accent"
                                />
                                <button
                                    onClick={addContact}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl border border-[var(--elevation-border)] bg-base text-secondary hover:text-accent hover:border-accent transition-all flex-shrink-0"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Étape test (mode mutualisé) */}
                        {waUseSharedWaba && (
                            <div className="bg-green-500/8 border border-green-500/15 rounded-xl px-4 py-3 flex gap-3">
                                <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-semibold text-primary">Prêt à utiliser</p>
                                    <p className="text-xs text-secondary mt-0.5">Sauvegardez, puis envoyez <strong className="text-primary">« bonjour »</strong> au numéro bot Atelier depuis un numéro ajouté ci-dessus. L&apos;agent répond en moins de 5 secondes.</p>
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-2">
                            {whatsappConfig && (
                                <button
                                    onClick={handleDeleteWhatsApp}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-500 border border-red-500/20 hover:bg-red-500/10 transition-all text-sm font-semibold"
                                >
                                    <Trash2 className="w-4 h-4" /> Supprimer la config
                                </button>
                            )}
                            <div className="ml-auto">
                                <button
                                    onClick={handleSaveWhatsApp}
                                    disabled={isPending || !canSave}
                                    className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                                        waSaveStatus === 'saved' ? 'bg-green-500 text-white shadow-green-500/20' :
                                        waSaveStatus === 'error' ? 'bg-red-500 text-white shadow-red-500/20' :
                                        'bg-accent text-black shadow-accent/20'
                                    }`}
                                >
                                    {waSaveStatus === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    {waSaveStatus === 'saving' ? 'Enregistrement...' :
                                     waSaveStatus === 'saved' ? 'Enregistré !' :
                                     waSaveStatus === 'error' ? 'Erreur' :
                                     'Sauvegarder'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )
        }

        return null;
    };

    return (
        <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-2">
                    <h1 className="text-4xl font-bold text-primary">Paramètres</h1>
                    <p className="text-secondary text-lg">Gérez les préférences de votre compte et de votre entreprise.</p>
                </div>
            </div>
            <div className="flex flex-col lg:flex-row gap-8">
                <div className="w-full lg:w-64 flex-shrink-0 space-y-2">
                    <button onClick={() => setActiveTab('profil')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'profil' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><User className="w-5 h-5" />Mon Profil</button>
                    <button onClick={() => setActiveTab('entreprise')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'entreprise' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><Building2 className="w-5 h-5" />Entreprise</button>
                    <button onClick={() => setActiveTab('equipe')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'equipe' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><Users className="w-5 h-5" />Équipe</button>
                    <button onClick={() => setActiveTab('emails')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'emails' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><Mail className="w-5 h-5" />Relances &amp; emails</button>
                    <button onClick={() => setActiveTab('confidentialite')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'confidentialite' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><ShieldCheck className="w-5 h-5" />Données &amp; confidentialité</button>
                    <button onClick={() => setActiveTab('integration')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'integration' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><Globe className="w-5 h-5" />Intégration</button>
                    <button onClick={() => setActiveTab('formulaire')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'formulaire' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><Inbox className="w-5 h-5" />Formulaire public</button>
                    <button onClick={() => setActiveTab('whatsapp')} className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'whatsapp' ? 'bg-surface dark:bg-white/5 shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}><MessageSquare className="w-5 h-5 text-green-500" />Agent WhatsApp</button>
                </div>
                <div className="flex-1">{renderContent()}</div>
            </div>
        </main>
    );
}
