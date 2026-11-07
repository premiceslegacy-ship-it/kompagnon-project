'use client'
// @atelier-migrated
// Réglages : tous les états et handlers (repris tels quels de l'ancien SettingsClient).

import React, { useState, useTransition, useRef, useEffect } from 'react'

import { useRouter } from 'next/navigation'

import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole, AllPermissionsData } from '@/lib/data/queries/roles'
import type { Organization } from '@/lib/data/queries/organization'
import type { OrganizationExportListItem } from '@/lib/data/queries/organization-exports'
import { createClient } from '@/lib/supabase/client'
import { updateMemberRole, removeMember } from '@/lib/data/mutations/team'
import { saveRolePermissions } from '@/lib/data/mutations/roles'
import { permissionLabel } from '@/lib/permissions/labels'
import { updateOrganization } from '@/lib/data/mutations/organization'
import { deactivateCompanyMemory } from '@/lib/data/mutations/company-memory'
import { updateEmailSettings } from '@/lib/data/mutations/email-settings'
import { updateProfile, updatePassword } from '@/lib/data/mutations/profile'
import { updatePublicFormSettings } from '@/lib/data/mutations/quote-requests'
import { createOrganizationExport } from '@/lib/data/mutations/organization-exports'

import { upsertEmailTemplate, resetEmailTemplate } from '@/lib/data/mutations/email-templates'
import type { EmailTemplate, EmailTemplateSlug } from '@/lib/data/queries/emailTemplates'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'

import type { EinvoicingConfig } from '@/lib/einvoicing-config'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import type { AccessStatus, BillingModel } from '@/lib/subscription-access'
import type { SubscriptionTier } from '@/lib/quota-catalog'
import { normalizeSecondaryActivityIds, resolveBusinessSelection, type BusinessActivityId, type BusinessProfile, type ResolvedCatalogContext } from '@/lib/catalog-context'
import { AI_NAME } from '@/lib/brand';
import { LEGAL_VAT_RATES } from '@/lib/utils'
import { LEGAL_CONTACT, buildDeletionRequestMailto, legalContactLabel } from '@/lib/legal'
import { normalizeBic, normalizeCommercialCourt, normalizeEmail, normalizeFrenchIban, normalizeFrenchVatNumber, normalizePostalCode, normalizeSiret, type OrganizationFieldErrors } from '@/lib/validations/organization'

export type SettingsProps = {
    initialFullName: string | null;
    initialEmail: string | null;
    members: TeamMember[];
    roles: OrgRole[];
    joinCode: string | null;
    organization: Organization | null;
    appUrl: string;
    supabaseUrl: string;
    catalogMaterials: CatalogMaterial[];
    catalogLaborRates: CatalogLaborRate[];
    catalogPrestationTypes: PrestationType[];
    suppliers: Supplier[];
    catalogContext: ResolvedCatalogContext;
    currentRoleSlug: string | null;
    organizationExports: OrganizationExportListItem[];
    emailTemplates: EmailTemplate[];
    rolesWithPermissions: AllPermissionsData;
    canInvite: boolean;
    canRemoveMembers: boolean;
    canEditRoles: boolean;
    canEditOrg: boolean;
    initialTab: string | null;
    initialMetalPriceGrids: MetalPriceGrid[];
    hasMetalPricing: boolean;
    initialClauseTemplates: QuoteClauseTemplate[];
    organizationModules: OrganizationModules | null;
    stripeLinkPro: string | null;
    stripeLinkExpert: string | null;
    selfService: boolean;
    subscriptionBillingModel: BillingModel;
    subscriptionTier: SubscriptionTier | null;
    subscriptionAccessStatus: AccessStatus | null;
    subscriptionAccessEndsAt: string | null;
    einvoicingConfig: EinvoicingConfig;
    canConfigureEinvoicing: boolean;
    companyMemories: import('@/lib/data/queries/company-memory').CompanyMemoryRow[];
    oauthResult: 'success' | 'error' | null;
    oauthDetail: string | null;
};

export function useSettings({ initialFullName, initialEmail, members, roles, joinCode, organization, appUrl, supabaseUrl, catalogMaterials, catalogLaborRates, catalogPrestationTypes, suppliers, catalogContext, currentRoleSlug, organizationExports, emailTemplates, rolesWithPermissions, canInvite, canRemoveMembers, canEditRoles, canEditOrg, initialTab, initialMetalPriceGrids, hasMetalPricing, initialClauseTemplates, organizationModules, stripeLinkPro, stripeLinkExpert, selfService, subscriptionBillingModel, subscriptionTier, subscriptionAccessStatus, subscriptionAccessEndsAt, einvoicingConfig, canConfigureEinvoicing, companyMemories, oauthResult, oauthDetail }: SettingsProps) {
    const router = useRouter()
    const [activeTab, setActiveTab] = useState(initialTab);
    useEffect(() => {
        const hash = window.location.hash.slice(1)
        if (!hash) return
        const el = document.getElementById(hash)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, [activeTab])
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRoleId, setInviteRoleId] = useState(roles[0]?.id ?? '');
    const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [codeCopied, setCodeCopied] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [orgSaveStatus, setOrgSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [orgIsDirty, setOrgIsDirty] = useState(false);
    const [orgFieldErrors, setOrgFieldErrors] = useState<OrganizationFieldErrors>({});
    const [orgErrorMessage, setOrgErrorMessage] = useState<string | null>(null);
    const [emailSaveStatus, setEmailSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [emailSettings, setEmailSettings] = useState({
        from_name: organization?.email_from_name ?? '',
        from_address: organization?.email_from_address ?? (selfService && organization?.slug ? `${organization.slug}@atelier-btp.fr` : ''),
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
    const [openActivityProfile, setOpenActivityProfile] = useState<BusinessProfile>(initialBusinessSelection.businessProfile);
    const [businessProfileEditorOpen, setBusinessProfileEditorOpen] = useState(false);
    const [showSecondaryActivities, setShowSecondaryActivities] = useState<Partial<Record<BusinessProfile, boolean>>>({});
    const [selectedSecondaryActivities, setSelectedSecondaryActivities] = useState<BusinessActivityId[]>(
        normalizeSecondaryActivityIds(organization?.secondary_activity_ids, initialBusinessSelection.activity.id)
    );

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

    const [signatureDetails, setSignatureDetails] = useState({
        signatory_name: organization?.signatory_name ?? '',
        signatory_role: organization?.signatory_role ?? '',
        signature_image: organization?.signature_image ?? null as string | null,
    });

    const [decennale, setDecennale] = useState({
        enabled: organization?.decennale_enabled ?? false,
        assureur: organization?.decennale_assureur ?? '',
        police: organization?.decennale_police ?? '',
        couverture: organization?.decennale_couverture ?? '',
        date_debut: organization?.decennale_date_debut ?? '',
        date_fin: organization?.decennale_date_fin ?? '',
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

    const [defaultLaborCost, setDefaultLaborCost] = useState<number | ''>(
        organization?.default_labor_cost_per_hour ?? ''
    );

    function markOrgDirty() {
        setOrgIsDirty(true);
        setOrgSaveStatus('idle');
    }

    function makeOrgDirtySetter<T>(setter: React.Dispatch<React.SetStateAction<T>>): React.Dispatch<React.SetStateAction<T>> {
        return (value) => {
            markOrgDirty();
            setter(value);
        }
    }

    const setCompanyDetailsDirty = makeOrgDirtySetter(setCompanyDetails)
    const setLegalDetailsDirty = makeOrgDirtySetter(setLegalDetails)
    const setSignatureDetailsDirty = makeOrgDirtySetter(setSignatureDetails)
    const setDecennaleDirty = makeOrgDirtySetter(setDecennale)
    const setPaymentDetailsDirty = makeOrgDirtySetter(setPaymentDetails)
    const setVatConfigDirty = makeOrgDirtySetter(setVatConfig)
    const setDefaultLaborCostDirty = makeOrgDirtySetter(setDefaultLaborCost)

    const [autoReminder, setAutoReminder] = useState({
        enabled: organization?.auto_reminder_enabled ?? false,
        invoiceDays: organization?.invoice_reminder_days ?? [3, 7],
        quoteDays: organization?.quote_reminder_days ?? [2, 7, 10],
        reminderHour: organization?.reminder_hour_utc ?? 8,
        defaultQuoteValidityDays: organization?.default_quote_validity_days ?? 30,
    });
    const [autoReminderSaveStatus, setAutoReminderSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // ─── Sous-totaux par lot par défaut (migration 126) ──────────────────────
    const [defaultShowSectionSubtotals, setDefaultShowSectionSubtotals] = useState<boolean>(
        organization?.default_show_section_subtotals ?? false,
    );
    const [subtotalsSaveStatus, setSubtotalsSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // ─── Rapport mensuel auto aux membres individuels (migration 073) ──────────
    const [autoMemberReports, setAutoMemberReports] = useState<boolean>(
        organization?.auto_send_member_reports ?? false,
    );
    const [autoMemberReportsSaveStatus, setAutoMemberReportsSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // ─── Mémoire des assistants IA (consultation/purge, chantier 7 point 4) ──
    const [memories, setMemories] = useState(companyMemories);
    const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
    const [memoryError, setMemoryError] = useState<string | null>(null);
    const [memoriesPage, setMemoriesPage] = useState(0);
    const MEMORIES_PER_PAGE = 10;
    const memoriesPageCount = Math.max(1, Math.ceil(memories.length / MEMORIES_PER_PAGE));
    const memoriesPageItems = memories.slice(memoriesPage * MEMORIES_PER_PAGE, memoriesPage * MEMORIES_PER_PAGE + MEMORIES_PER_PAGE);

    function handleDeleteMemory(memoryId: string) {
        const previous = memories;
        setMemoryError(null);
        setDeletingMemoryId(memoryId);
        setMemories(prev => {
            const next = prev.filter(m => m.id !== memoryId);
            const lastPage = Math.max(0, Math.ceil(next.length / MEMORIES_PER_PAGE) - 1);
            setMemoriesPage(p => Math.min(p, lastPage));
            return next;
        });
        startTransition(async () => {
            const result = await deactivateCompanyMemory(memoryId);
            if (result.error) {
                setMemories(previous);
                setMemoryError(result.error);
            }
            setDeletingMemoryId(null);
        });
    }

    // Libellé lisible par type de mémoire. Le fallback générique couvre déjà
    // tout futur type sans modification de ce composant.
    function memoryTypeLabel(type: string, metadata?: { chantier_id?: string | null } | null): string {
        if (type === 'chloe_price_correction') return `Prix corrigé par ${AI_NAME}`;
        if (type === 'sarah_memory') return `Retenu par ${AI_NAME}`;
        if (type === 'marco_memory') return metadata?.chantier_id ? `Retenu par ${AI_NAME} · ce chantier` : `Retenu par ${AI_NAME} · tous les chantiers`;
        if (type === 'quote' || type === 'invoice') return 'Résumé document';
        return type;
    }

    const [publicFormSettings, setPublicFormSettings] = useState({
        enabled: organization?.public_form_enabled ?? false,
        welcomeMessage: organization?.public_form_welcome_message ?? '',
        customModeEnabled: organization?.public_form_custom_mode_enabled ?? true,
        notificationEmail: organization?.public_form_notification_email ?? '',
        catalogItemIds: (organization?.public_form_catalog_item_ids ?? []) as Array<{ id: string; item_type: 'material' | 'labor' | 'prestation' }>,
    });
    const [publicFormSaveStatus, setPublicFormSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [exportSaveStatus, setExportSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [exportFeedback, setExportFeedback] = useState<string | null>(null);
    const [showExportComptableModal, setShowExportComptableModal] = useState(false);

    // ─── Signature email + CGV + délai relance ───────────────────────────────
    const [emailSignature, setEmailSignature] = useState(organization?.email_signature ?? '')
    const [cgvText, setCgvText] = useState(organization?.cgv_text ?? '')
    const [reminderFirstDelay, setReminderFirstDelay] = useState(Math.max(3, organization?.reminder_first_delay_days ?? 3))
    const [signatureSaveStatus, setSignatureSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

    // ─── Templates emails ─────────────────────────────────────────────────────
    const [tplDraft, setTplDraft] = useState<Record<EmailTemplateSlug, { subject: string; body_text: string }>>(
        Object.fromEntries(emailTemplates.map(t => [t.slug, { subject: t.subject, body_text: t.body_text }])) as Record<EmailTemplateSlug, { subject: string; body_text: string }>
    )
    const [tplSaveStatus, setTplSaveStatus] = useState<Record<EmailTemplateSlug, 'idle' | 'saving' | 'saved' | 'error'>>(
        Object.fromEntries(emailTemplates.map(t => [t.slug, 'idle'])) as Record<EmailTemplateSlug, 'idle' | 'saving' | 'saved' | 'error'>
    )
    const [tplResetStatus, setTplResetStatus] = useState<Record<EmailTemplateSlug, 'idle' | 'pending' | 'done'>>(
        Object.fromEntries(emailTemplates.map(t => [t.slug, 'idle'])) as Record<EmailTemplateSlug, 'idle' | 'pending' | 'done'>
    )
    const [expandedTpl, setExpandedTpl] = useState<EmailTemplateSlug | null>(null)

    // ─── Sessions actives ─────────────────────────────────────────────────────
    const [sessions, setSessions] = useState<Array<{ id: string; created_at: string | null; user_agent: string | null; ip: string | null }>>([])
    const [sessionsLoaded, setSessionsLoaded] = useState(false)
    const [revokeStatus, setRevokeStatus] = useState<Record<string, 'idle' | 'revoking' | 'done' | 'error'>>({})

    // ─── Workflow suppression de compte RGPD ──────────────────────────────────
    const [deletionStep, setDeletionStep] = useState<0 | 1 | 2 | 3>(0)
    const [deletionConfirmText, setDeletionConfirmText] = useState('')
    const [deletionStatus, setDeletionStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
    const [deletionError, setDeletionError] = useState<string | null>(null)
    const [cancelDeletionStatus, setCancelDeletionStatus] = useState<'idle' | 'pending' | 'done'>('idle')

    const currentBusinessSelection = resolveBusinessSelection({ activityId: companyDetails.business_activity })
    const deletionRequestHref = buildDeletionRequestMailto({
        requesterEmail: initialEmail,
        orgName: organization?.name ?? null,
    })
    const privacyContactLabel = legalContactLabel(LEGAL_CONTACT.privacyEmail ?? LEGAL_CONTACT.supportEmail)
    const isOwner = currentRoleSlug === 'owner'
    const isAdmin = currentRoleSlug === 'admin' || isOwner
    const hasProcessingExport = organizationExports.some((item) => item.status === 'processing')

    function setOrgFieldError(field: keyof OrganizationFieldErrors, error?: string) {
        setOrgFieldErrors(prev => {
            const next = { ...prev }
            if (error) next[field] = error
            else delete next[field]
            return next
        })
    }

    function focusFirstOrgError(errors: OrganizationFieldErrors) {
        const firstField = Object.keys(errors)[0]
        if (!firstField) return
        requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>(`[data-org-field="${firstField}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el?.focus()
        })
    }

    function validateOrganizationDraft(): OrganizationFieldErrors {
        const errors: OrganizationFieldErrors = {}
        if (!companyDetails.name.trim()) errors.name = "Le nom de l'entreprise est obligatoire."
        const siret = normalizeSiret(companyDetails.siret)
        const vat = normalizeFrenchVatNumber(companyDetails.tva)
        const email = normalizeEmail(companyDetails.email)
        const postal = normalizePostalCode(companyDetails.postal_code)
        const iban = normalizeFrenchIban(paymentDetails.iban)
        const bic = normalizeBic(paymentDetails.bic)

        if (siret.error) errors.siret = siret.error
        if (vatConfig.is_vat_subject && vat.error) errors.vat_number = vat.error
        if (!companyDetails.email.trim()) errors.email = "L'email de contact est obligatoire."
        else if (email.error) errors.email = email.error
        if (postal.error) errors.postal_code = postal.error
        if (iban.error) errors.iban = iban.error
        if (bic.error) errors.bic = bic.error
        if (!Number.isFinite(paymentDetails.payment_terms_days) || paymentDetails.payment_terms_days < 0 || paymentDetails.payment_terms_days > 90) {
            errors.payment_terms_days = 'Le délai de paiement doit être compris entre 0 et 90 jours.'
        }
        if (!Number.isFinite(paymentDetails.late_penalty_rate) || paymentDetails.late_penalty_rate < 0 || paymentDetails.late_penalty_rate > 100) {
            errors.late_penalty_rate = 'Le taux de pénalités doit être compris entre 0 et 100 %.'
        }
        if (vatConfig.is_vat_subject && !LEGAL_VAT_RATES.includes(vatConfig.default_vat_rate as typeof LEGAL_VAT_RATES[number])) {
            errors.default_vat_rate = 'Choisissez un taux de TVA légal : 0, 5,5, 10 ou 20 %.'
        }
        return errors
    }

    // ─── Rôles & Permissions ──────────────────────────────────────────────────
    const [selectedRoleId, setSelectedRoleId] = useState<string>(
        rolesWithPermissions.roles.find(r => r.slug !== 'owner')?.id ?? ''
    )
    const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>(() => {
        const m: Record<string, Record<string, boolean>> = {}
        for (const r of rolesWithPermissions.roles) m[r.id] = { ...r.permissions }
        return m
    })
    const [permSaveStatus, setPermSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

    async function handleSavePermissions() {
        if (!selectedRoleId) return
        setPermSaveStatus('saving')
        const { error } = await saveRolePermissions(selectedRoleId, localPerms[selectedRoleId] ?? {})
        setPermSaveStatus(error ? 'error' : 'saved')
        setTimeout(() => setPermSaveStatus('idle'), 2500)
    }

    function togglePerm(roleId: string, key: string) {
        setLocalPerms(prev => ({
            ...prev,
            [roleId]: { ...prev[roleId], [key]: !prev[roleId]?.[key] },
        }))
    }

    // CATEGORY_LABELS et permissionLabel : dictionnaire FR centralisé dans
    // src/lib/permissions/labels.ts pour partage et fallback robuste.

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

    function exportStatusLabel(status: OrganizationExportListItem['status']) {
        if (status === 'ready') return 'Prêt'
        if (status === 'failed') return 'Échoué'
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
            setExportFeedback(result.warning ?? "L'export a été généré. Un lien sécurisé est disponible ci-dessous et un email a été envoyé à l'owner.")
            router.refresh()
            setTimeout(() => setExportSaveStatus('idle'), 3000)
        })
    }

    function togglePublicCatalogItem(id: string, item_type: 'material' | 'labor' | 'prestation') {
        setPublicFormSettings(prev => {
            const exists = prev.catalogItemIds.some(x => x.id === id && x.item_type === item_type)
            return {
                ...prev,
                catalogItemIds: exists
                    ? prev.catalogItemIds.filter(x => !(x.id === id && x.item_type === item_type))
                    : [...prev.catalogItemIds, { id, item_type }],
            }
        })
    }

    function handleSaveSignatureAndCGV() {
        setSignatureSaveStatus('saving')
        startTransition(async () => {
            const result = await updateOrganization({
                email_signature: emailSignature.trim() || null,
                cgv_text: cgvText.trim() || null,
                reminder_first_delay_days: reminderFirstDelay,
            })
            if (result.error) {
                setSignatureSaveStatus('error')
                setTimeout(() => setSignatureSaveStatus('idle'), 3000)
            } else {
                setSignatureSaveStatus('saved')
                setTimeout(() => setSignatureSaveStatus('idle'), 2000)
            }
        })
    }

    function handleSaveEmailTemplate(slug: EmailTemplateSlug) {
        setTplSaveStatus(s => ({ ...s, [slug]: 'saving' }))
        startTransition(async () => {
            const draft = tplDraft[slug]
            const result = await upsertEmailTemplate({ slug, subject: draft.subject, body_text: draft.body_text })
            if (result.error) {
                setTplSaveStatus(s => ({ ...s, [slug]: 'error' }))
                setTimeout(() => setTplSaveStatus(s => ({ ...s, [slug]: 'idle' })), 3000)
            } else {
                setTplSaveStatus(s => ({ ...s, [slug]: 'saved' }))
                setTimeout(() => setTplSaveStatus(s => ({ ...s, [slug]: 'idle' })), 2000)
            }
        })
    }

    function handleResetEmailTemplate(slug: EmailTemplateSlug) {
        setTplResetStatus(s => ({ ...s, [slug]: 'pending' }))
        startTransition(async () => {
            const result = await resetEmailTemplate(slug)
            if (!result.error) {
                const defaultTpl = emailTemplates.find(t => t.slug === slug)
                if (defaultTpl) setTplDraft(d => ({ ...d, [slug]: { subject: defaultTpl.subject, body_text: defaultTpl.body_text } }))
                setTplResetStatus(s => ({ ...s, [slug]: 'done' }))
                setTimeout(() => setTplResetStatus(s => ({ ...s, [slug]: 'idle' })), 2000)
            } else {
                setTplResetStatus(s => ({ ...s, [slug]: 'idle' }))
            }
        })
    }

    function loadSecurityData() {
        setSessionsLoaded(true)
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
                invoice_reminder_days: autoReminder.invoiceDays.filter(d => d > 0).map((d, i) => i === 0 ? Math.max(3, d) : d),
                quote_reminder_days: autoReminder.quoteDays.filter(d => d > 0),
                reminder_hour_utc: autoReminder.reminderHour,
                default_quote_validity_days: autoReminder.defaultQuoteValidityDays,
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

    function handleSaveDefaultShowSectionSubtotals(nextValue: boolean) {
        setDefaultShowSectionSubtotals(nextValue);
        setSubtotalsSaveStatus('saving');
        startTransition(async () => {
            const result = await updateOrganization({ default_show_section_subtotals: nextValue });
            if (result.error) {
                setSubtotalsSaveStatus('error');
                setDefaultShowSectionSubtotals(prev => !prev);
                setTimeout(() => setSubtotalsSaveStatus('idle'), 3000);
            } else {
                setSubtotalsSaveStatus('saved');
                setTimeout(() => setSubtotalsSaveStatus('idle'), 2000);
            }
        });
    }

    function handleSaveAutoMemberReports(nextValue: boolean) {
        setAutoMemberReports(nextValue);
        setAutoMemberReportsSaveStatus('saving');
        startTransition(async () => {
            const result = await updateOrganization({ auto_send_member_reports: nextValue });
            if (result.error) {
                setAutoMemberReportsSaveStatus('error');
                setAutoMemberReports(prev => !prev);
                setTimeout(() => setAutoMemberReportsSaveStatus('idle'), 3000);
            } else {
                setAutoMemberReportsSaveStatus('saved');
                setTimeout(() => setAutoMemberReportsSaveStatus('idle'), 2000);
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
        setOrgErrorMessage(null);
        const clientErrors = validateOrganizationDraft();
        if (Object.keys(clientErrors).length > 0) {
            setOrgFieldErrors(clientErrors);
            setOrgSaveStatus('error');
            setOrgErrorMessage('Corrigez les champs indiqués avant de sauvegarder.');
            focusFirstOrgError(clientErrors);
            setTimeout(() => setOrgSaveStatus('idle'), 3000);
            return;
        }
        setOrgFieldErrors({});
        setOrgSaveStatus('saving');
        startTransition(async () => {
            const selection = resolveBusinessSelection({ activityId: companyDetails.business_activity });
            const normalizedSiret = normalizeSiret(companyDetails.siret);
            const normalizedVat = normalizeFrenchVatNumber(companyDetails.tva);
            const normalizedEmail = normalizeEmail(companyDetails.email);
            const normalizedPostalCode = normalizePostalCode(companyDetails.postal_code);
            const normalizedIban = normalizeFrenchIban(paymentDetails.iban);
            const normalizedBic = normalizeBic(paymentDetails.bic);
            const normalizedCourt = normalizeCommercialCourt(paymentDetails.court_competent);
            const result = await updateOrganization({
                name: companyDetails.name.trim(),
                siret: normalizedSiret.value,
                siren: normalizedSiret.siren,
                vat_number: vatConfig.is_vat_subject ? normalizedVat.value : null,
                email: normalizedEmail.value ?? companyDetails.email,
                phone: companyDetails.phone.trim() || null,
                address_line1: companyDetails.address_line1 || null,
                postal_code: normalizedPostalCode.value,
                city: companyDetails.city.trim() || null,
                business_profile: selection.businessProfile,
                business_activity_id: selection.activity.id,
                secondary_activity_ids: selectedSecondaryActivities,
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
                decennale_enabled: decennale.enabled,
                decennale_assureur: decennale.assureur || null,
                decennale_police: decennale.police || null,
                decennale_couverture: decennale.couverture || null,
                decennale_date_debut: decennale.date_debut || null,
                decennale_date_fin: decennale.date_fin || null,
                iban: normalizedIban.value,
                bic: normalizedBic.value,
                bank_name: paymentDetails.bank_name.trim() || null,
                payment_terms_days: paymentDetails.payment_terms_days ?? null,
                late_penalty_rate: paymentDetails.late_penalty_rate ?? null,
                court_competent: normalizedCourt,
                recovery_indemnity_text: paymentDetails.recovery_indemnity_text || null,
                is_vat_subject: vatConfig.is_vat_subject,
                default_vat_rate: vatConfig.is_vat_subject ? vatConfig.default_vat_rate : 0,
                default_labor_cost_per_hour: defaultLaborCost !== '' ? defaultLaborCost : null,
                signatory_name: signatureDetails.signatory_name.trim() || null,
                signatory_role: signatureDetails.signatory_role.trim() || null,
                signature_image: signatureDetails.signature_image,
            });
            if (result.error) {
                const fieldErrors = result.fieldErrors ?? {};
                setOrgFieldErrors(fieldErrors);
                setOrgErrorMessage(result.error);
                focusFirstOrgError(fieldErrors);
                setOrgSaveStatus('error');
                setTimeout(() => setOrgSaveStatus('idle'), 3000);
            } else {
                setCompanyDetails(details => ({
                    ...details,
                    name: details.name.trim(),
                    siret: normalizedSiret.value ?? '',
                    tva: vatConfig.is_vat_subject ? normalizedVat.value ?? '' : '',
                    email: normalizedEmail.value ?? details.email,
                    postal_code: normalizedPostalCode.value ?? '',
                }));
                setPaymentDetails(details => ({
                    ...details,
                    iban: normalizedIban.value ?? '',
                    bic: normalizedBic.value ?? '',
                    court_competent: normalizedCourt ?? '',
                }));
                setOrgSaveStatus('saved');
                setOrgIsDirty(false);
                setTimeout(() => setOrgSaveStatus('idle'), 2000);
            }
        });
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

    const [passwordFields, setPasswordFields] = useState({ current: '', password: '', confirm: '' });
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
        if (!passwordFields.current) {
            setPasswordError('Saisissez votre mot de passe actuel.');
            return;
        }
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
            fd.append('current_password', passwordFields.current);
            fd.append('password', passwordFields.password);
            fd.append('confirm', passwordFields.confirm);
            const result = await updatePassword(fd);
            if (result.error) {
                setPasswordError(result.error);
                setPasswordSaveStatus('error');
                setTimeout(() => setPasswordSaveStatus('idle'), 3000);
            } else {
                setPasswordSaveStatus('saved');
                setPasswordFields({ current: '', password: '', confirm: '' });
                setTimeout(() => setPasswordSaveStatus('idle'), 2000);
            }
        });
    }


  return {
    initialFullName,
    initialEmail,
    members,
    roles,
    joinCode,
    organization,
    appUrl,
    supabaseUrl,
    catalogMaterials,
    catalogLaborRates,
    catalogPrestationTypes,
    suppliers,
    catalogContext,
    currentRoleSlug,
    organizationExports,
    emailTemplates,
    rolesWithPermissions,
    canInvite,
    canRemoveMembers,
    canEditRoles,
    canEditOrg,
    initialTab,
    initialMetalPriceGrids,
    hasMetalPricing,
    initialClauseTemplates,
    organizationModules,
    stripeLinkPro,
    stripeLinkExpert,
    selfService,
    subscriptionBillingModel,
    subscriptionTier,
    subscriptionAccessStatus,
    subscriptionAccessEndsAt,
    einvoicingConfig,
    canConfigureEinvoicing,
    companyMemories,
    oauthResult,
    oauthDetail,
    router,
    activeTab,
    setActiveTab,
    inviteEmail,
    setInviteEmail,
    inviteRoleId,
    setInviteRoleId,
    inviteStatus,
    setInviteStatus,
    inviteError,
    setInviteError,
    isPending,
    startTransition,
    orgSaveStatus,
    orgIsDirty,
    orgFieldErrors,
    orgErrorMessage,
    emailSaveStatus,
    emailSettings,
    setEmailSettings,
    logoPreview,
    logoUploading,
    handleLogoUpload,
    showSecondaryActivities,
    setShowSecondaryActivities,
    selectedSecondaryActivities,
    setSelectedSecondaryActivities,
    companyDetails,
    legalDetails,
    signatureDetails,
    decennale,
    paymentDetails,
    vatConfig,
    defaultLaborCost,
    setCompanyDetailsDirty,
    setLegalDetailsDirty,
    setSignatureDetailsDirty,
    setDecennaleDirty,
    setPaymentDetailsDirty,
    setVatConfigDirty,
    setDefaultLaborCostDirty,
    autoReminder,
    setAutoReminder,
    autoReminderSaveStatus,
    defaultShowSectionSubtotals,
    subtotalsSaveStatus,
    autoMemberReports,
    autoMemberReportsSaveStatus,
    memories,
    memoryError,
    memoriesPage,
    setMemoriesPage,
    memoriesPageCount,
    memoriesPageItems,
    handleDeleteMemory,
    memoryTypeLabel,
    publicFormSettings,
    setPublicFormSettings,
    publicFormSaveStatus,
    exportSaveStatus,
    exportFeedback,
    emailSignature,
    setEmailSignature,
    cgvText,
    setCgvText,
    reminderFirstDelay,
    setReminderFirstDelay,
    signatureSaveStatus,
    tplDraft,
    setTplDraft,
    tplSaveStatus,
    tplResetStatus,
    sessions,
    sessionsLoaded,
    deletionStep,
    setDeletionStep,
    deletionConfirmText,
    setDeletionConfirmText,
    deletionStatus,
    setDeletionStatus,
    deletionError,
    setDeletionError,
    cancelDeletionStatus,
    setCancelDeletionStatus,
    currentBusinessSelection,
    isOwner,
    isAdmin,
    hasProcessingExport,
    setOrgFieldError,
    selectedRoleId,
    setSelectedRoleId,
    localPerms,
    permSaveStatus,
    handleSavePermissions,
    togglePerm,
    formatExportDate,
    formatFileSize,
    handleCreateOrganizationExport,
    togglePublicCatalogItem,
    handleSaveSignatureAndCGV,
    handleSaveEmailTemplate,
    handleResetEmailTemplate,
    loadSecurityData,
    handleSavePublicForm,
    handleSaveAutoReminder,
    handleSaveDefaultShowSectionSubtotals,
    handleSaveAutoMemberReports,
    handleRoleChange,
    handleRemove,
    handleSaveEmailSettings,
    handleSaveOrganization,
    profileFields,
    setProfileFields,
    profileSaveStatus,
    passwordFields,
    setPasswordFields,
    passwordSaveStatus,
    passwordError,
    handleSaveProfile,
    handleSavePassword,
  }
}


export type SettingsState = ReturnType<typeof useSettings>
