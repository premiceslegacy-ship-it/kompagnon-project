"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
    LayoutDashboard,
    UserCircle,
    FileText,
    Package,
    MailWarning,
    Bot,
    HardHat,
    Calendar,
    Sun,
    Moon,
    Settings,
    Bell,
    BellOff,
    User,
    LogOut,
    Inbox,
    Menu,
    X,
    ClipboardSignature,
    ChevronDown,
    BarChart2,
    Repeat,
    CheckSquare,
    CalendarCheck,
    AlertCircle,
    Wrench,
} from 'lucide-react';
import type { UserProfile } from '@/lib/data/queries/user';
import type { OrganizationModules } from '@/lib/organization-modules';
import type { NotificationsSummary } from '@/lib/data/queries/notifications';

const routeKey = (href: string) => href.split(/[?#]/)[0] || '/';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

const NavChipLink = ({
    href,
    icon,
    label,
    active,
    pending,
    onNavigate,
    onPrefetch,
    className = '',
    title,
}: {
    href: string;
    icon: React.ReactNode;
    label: string;
    active: boolean;
    pending: boolean;
    onNavigate: (href: string) => void;
    onPrefetch: (href: string) => void;
    className?: string;
    title?: string;
}) => (
    <Link
        href={href}
        title={title}
        prefetch
        onClick={() => onNavigate(href)}
        onPointerEnter={() => onPrefetch(href)}
        className={`nav-chip px-3.5 py-2 text-sm font-semibold flex items-center gap-2 whitespace-nowrap ${active ? 'nav-chip-active' : ''} ${pending ? 'nav-chip-pending' : ''} ${className}`}
    >
        {icon}
        {label}
    </Link>
);

const ThemeToggle = () => {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    if (!mounted) {
        return (
            <button className="w-10 h-10 flex items-center justify-center">
                <div className="w-5 h-5" />
            </button>
        );
    }

    return (
        <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn-icon"
        >
            {theme === 'dark' ? <Moon className="w-5 h-5 text-accent" /> : <Sun className="w-5 h-5 text-accent" />}
        </button>
    );
};

const UserMenu = ({ profile }: { profile: UserProfile | null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const router = useRouter();

    useEffect(() => { setMounted(true); }, []);

    const toggleMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + window.scrollY,
                left: rect.right + window.scrollX - 192,
            });
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        const handleClickOutside = () => setIsOpen(false);
        if (isOpen) {
            document.addEventListener('click', handleClickOutside);
            window.addEventListener('scroll', handleClickOutside, true);
        }
        return () => {
            document.removeEventListener('click', handleClickOutside);
            window.removeEventListener('scroll', handleClickOutside, true);
        };
    }, [isOpen]);

    const displayName = profile?.full_name || 'Utilisateur';
    const initials = displayName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    return (
        <>
            <button
                ref={buttonRef}
                onClick={toggleMenu}
                className="btn-avatar w-10 h-10 p-0.5"
            >
                {profile?.avatar_url ? (
                    <img className="w-full h-full object-cover rounded-full" alt={displayName} src={profile.avatar_url} />
                ) : (
                    <div className="w-full h-full rounded-full bg-accent/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-accent">{initials}</span>
                    </div>
                )}
            </button>
            {mounted && isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="absolute w-52 menu-panel py-2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
                    style={{ top: coords.top + 8, left: coords.left }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-4 py-3 border-b border-[var(--elevation-border)]">
                        <p className="text-sm font-bold text-primary truncate">{displayName}</p>
                        {profile?.email && (
                            <p className="text-xs text-secondary truncate mt-0.5">{profile.email}</p>
                        )}
                    </div>
                    <div className="pt-1">
                        <button
                            onClick={() => { setIsOpen(false); router.push('/settings'); }}
                            className="w-full text-left px-4 py-2 text-sm font-semibold text-primary hover:bg-base transition-colors flex items-center gap-2"
                        >
                            <User className="w-4 h-4" />
                            Mon profil
                        </button>
                        <div className="h-px w-full bg-[var(--elevation-border)] my-1"></div>
                        <button
                            onClick={() => { setIsOpen(false); router.push('/login'); }}
                            className="w-full text-left px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                        >
                            <LogOut className="w-4 h-4" />
                            Se déconnecter
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

type NotificationsData = Partial<NotificationsSummary> & { overdueInvoices: number; expiringQuotes: number }

type PushPermission = 'default' | 'granted' | 'denied'

const NotificationBell = ({ notifications }: { notifications: NotificationsData }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [seenSignature, setSeenSignature] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);
    const [pushPermission, setPushPermission] = useState<PushPermission>('granted');
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
        if ('Notification' in window) setPushPermission(Notification.permission as PushPermission);
    }, []);

    async function handleEnablePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) return

        const permission = await Notification.requestPermission()
        setPushPermission(permission as PushPermission)
        if (permission !== 'granted') return

        const reg = await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        const sub = existing ?? await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
        })
        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub.toJSON()),
        })
    }

    const total = notifications.total ?? (
        notifications.overdueInvoices +
        (notifications.invoiceFollowups ?? 0) +
        (notifications.pendingQuotes ?? 0) +
        (notifications.pendingRecurring ?? 0) +
        (notifications.recurringReady ?? 0) +
        (notifications.chantierPeriodDrafts ?? 0) +
        (notifications.recentAutoReminders ?? 0) +
        (notifications.dueTasks ?? 0) +
        (notifications.planningToday ?? 0) +
        (notifications.missingPointages ?? 0) +
        (notifications.completedTasks ?? 0) +
        (notifications.newRequests ?? 0) +
        (notifications.chantiersAtRisk ?? 0) +
        (notifications.maintenanceDue ?? 0) +
        (notifications.maintenanceBillingPending ?? 0)
    );
    const notificationSignature = [
        total,
        notifications.overdueInvoices,
        notifications.invoiceFollowups ?? 0,
        notifications.pendingQuotes ?? 0,
        notifications.pendingRecurring ?? 0,
        notifications.recurringReady ?? 0,
        notifications.chantierPeriodDrafts ?? 0,
        notifications.recentAutoReminders ?? 0,
        notifications.dueTasks ?? 0,
        notifications.planningToday ?? 0,
        notifications.missingPointages ?? 0,
        notifications.completedTasks ?? 0,
        notifications.newRequests ?? 0,
        notifications.chantiersAtRisk ?? 0,
        notifications.maintenanceDue ?? 0,
        notifications.maintenanceBillingPending ?? 0,
    ].join(':');
    const badgeTotal = seenSignature === notificationSignature ? 0 : total;

    const toggleMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + window.scrollY, left: rect.right + window.scrollX - 320 });
            setSeenSignature(notificationSignature);
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        const handleClose = () => setIsOpen(false);
        if (isOpen) {
            document.addEventListener('click', handleClose);
            window.addEventListener('scroll', handleClose, true);
        }
        return () => {
            document.removeEventListener('click', handleClose);
            window.removeEventListener('scroll', handleClose, true);
        };
    }, [isOpen]);

    return (
        <>
            <button
                ref={buttonRef}
                onClick={toggleMenu}
                className="btn-icon relative"
                title="Notifications"
            >
                <Bell className="w-5 h-5 text-primary" />
                {badgeTotal > 0 && (
                    <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-accent text-black text-[9px] font-extrabold flex items-center justify-center leading-none">
                        {badgeTotal > 9 ? '9+' : badgeTotal}
                    </span>
                )}
            </button>
            {mounted && isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="absolute w-80 menu-panel py-2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain"
                    style={{ top: coords.top + 8, left: coords.left }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--elevation-border)]">
                        <p className="text-xs font-bold text-secondary uppercase tracking-wider">Notifications</p>
                        {pushPermission === 'default' && (
                            <button
                                onClick={handleEnablePush}
                                className="text-xs font-semibold text-accent hover:underline"
                            >
                                Activer les pushs
                            </button>
                        )}
                        {pushPermission === 'denied' && (
                            <span className="flex items-center gap-1 text-xs text-secondary">
                                <BellOff className="w-3 h-3" /> Pushs bloqués
                            </span>
                        )}
                    </div>
                    {total === 0 ? (
                        <p className="px-4 py-4 text-sm text-secondary text-center">Aucune action requise</p>
                    ) : (
                        <div className="py-1">
                            {notifications.overdueInvoices > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/finances'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.overdueInvoices} facture{notifications.overdueInvoices > 1 ? 's' : ''} en retard</p>
                                        <p className="text-xs text-secondary mt-0.5">Echéance dépassée, paiement en attente</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.invoiceFollowups ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/reminders'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.invoiceFollowups} facture{(notifications.invoiceFollowups ?? 0) > 1 ? 's' : ''} à vérifier</p>
                                        <p className="text-xs text-secondary mt-0.5">Demander si le paiement est reçu ou relancer</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.pendingRecurring ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/finances/recurring'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <Repeat className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.pendingRecurring} facture{(notifications.pendingRecurring ?? 0) > 1 ? 's' : ''} récurrente{(notifications.pendingRecurring ?? 0) > 1 ? 's' : ''}</p>
                                        <p className="text-xs text-secondary mt-0.5">Brouillon disponible, à envoyer ou modifier</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.recurringReady ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/finances/recurring'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <Repeat className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.recurringReady} facture{(notifications.recurringReady ?? 0) > 1 ? 's' : ''} à préparer</p>
                                        <p className="text-xs text-secondary mt-0.5">Modèle récurrent dans sa fenêtre d'envoi</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.chantierPeriodDrafts ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/finances'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <FileText className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.chantierPeriodDrafts} facture{(notifications.chantierPeriodDrafts ?? 0) > 1 ? 's' : ''} de chantier à valider</p>
                                        <p className="text-xs text-secondary mt-0.5">Brouillon périodique généré, à contrôler puis envoyer</p>
                                    </div>
                                </button>
                            )}
                            {notifications.expiringQuotes > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/finances'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.expiringQuotes} devis expirant bientôt</p>
                                        <p className="text-xs text-secondary mt-0.5">Validité inférieure à 3 jours</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.pendingQuotes ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/reminders'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <MailWarning className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.pendingQuotes} devis à relancer</p>
                                        <p className="text-xs text-secondary mt-0.5">Sans réponse depuis plusieurs jours</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.recentAutoReminders ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/dashboard'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <CheckSquare className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.recentAutoReminders} relance{(notifications.recentAutoReminders ?? 0) > 1 ? 's' : ''} auto envoyée{(notifications.recentAutoReminders ?? 0) > 1 ? 's' : ''}</p>
                                        <p className="text-xs text-secondary mt-0.5">Factures ou devis relancés automatiquement</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.dueTasks ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/dashboard'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <CheckSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.dueTasks} tâche{(notifications.dueTasks ?? 0) > 1 ? 's' : ''} à échéance</p>
                                        <p className="text-xs text-secondary mt-0.5">À faire aujourd'hui ou en retard</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.planningToday ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/chantiers/planning'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <CalendarCheck className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.planningToday} créneau{(notifications.planningToday ?? 0) > 1 ? 'x' : ''} aujourd'hui</p>
                                        <p className="text-xs text-secondary mt-0.5">Planning chantier du jour</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.missingPointages ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/chantiers/heures'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.missingPointages} pointage{(notifications.missingPointages ?? 0) > 1 ? 's' : ''} à vérifier</p>
                                        <p className="text-xs text-secondary mt-0.5">Créneau passé sans heure pointée</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.maintenanceDue ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/chantiers/entretien'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <Wrench className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.maintenanceDue} entretien{(notifications.maintenanceDue ?? 0) > 1 ? 's' : ''} à réaliser</p>
                                        <p className="text-xs text-secondary mt-0.5">Intervention planifiée aujourd'hui ou en retard</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.maintenanceBillingPending ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/chantiers/entretien'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <FileText className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.maintenanceBillingPending} entretien{(notifications.maintenanceBillingPending ?? 0) > 1 ? 's' : ''} à facturer</p>
                                        <p className="text-xs text-secondary mt-0.5">Intervention réalisée avec montant facturable</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.completedTasks ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/dashboard'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <CheckSquare className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.completedTasks} tâche{(notifications.completedTasks ?? 0) > 1 ? 's' : ''} terminée{(notifications.completedTasks ?? 0) > 1 ? 's' : ''}</p>
                                        <p className="text-xs text-secondary mt-0.5">Un membre a clôturé une tâche chantier</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.chantiersAtRisk ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/chantiers'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.chantiersAtRisk} chantier{(notifications.chantiersAtRisk ?? 0) > 1 ? 's' : ''} en alerte budget</p>
                                        <p className="text-xs text-secondary mt-0.5">Coûts dépassent 90% du budget prévu</p>
                                    </div>
                                </button>
                            )}
                            {(notifications.newRequests ?? 0) > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); router.push('/requests'); }}
                                    className="w-full text-left px-4 py-3 hover:bg-base transition-colors flex items-start gap-3"
                                >
                                    <Inbox className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm font-semibold text-primary">{notifications.newRequests} nouvelle{(notifications.newRequests ?? 0) > 1 ? 's' : ''} demande{(notifications.newRequests ?? 0) > 1 ? 's' : ''}</p>
                                        <p className="text-xs text-secondary mt-0.5">Formulaire public à traiter</p>
                                    </div>
                                </button>
                            )}
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
};

// Dropdown nav générique
const NavDropdown = ({ label, icon, active, badge, children }: {
    label: string
    icon?: React.ReactNode
    active: boolean
    badge?: number
    children: React.ReactNode
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    useEffect(() => { setMounted(true); }, []);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
        }
        setIsOpen(v => !v);
    };

    useEffect(() => {
        const close = () => setIsOpen(false);
        if (isOpen) {
            document.addEventListener('click', close);
            window.addEventListener('scroll', close, true);
        }
        return () => {
            document.removeEventListener('click', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [isOpen]);

    return (
        <>
            <button
                ref={buttonRef}
                onClick={toggle}
                className={`nav-chip relative px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap ${active ? 'nav-chip-active' : ''}`}
            >
                {icon}
                {label}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                {(badge ?? 0) > 0 && (
                    <span className="absolute -top-2 -right-3 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 leading-none">
                        {(badge ?? 0) > 9 ? '9+' : badge}
                    </span>
                )}
            </button>
            {mounted && isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="absolute w-52 menu-panel py-1.5 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
                    style={{ top: coords.top + 8, left: coords.left }}
                    onClick={e => e.stopPropagation()}
                >
                    {children}
                </div>,
                document.body
            )}
        </>
    );
};

const NavDropdownItem = ({ href, icon, label, badge, active, onClick }: {
    href: string
    icon: React.ReactNode
    label: string
    badge?: number
    active: boolean
    onClick: () => void
}) => (
    <Link
        href={href}
        onClick={onClick}
        prefetch
        className={`flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors ${active ? 'text-accent bg-accent/8' : 'text-primary hover:bg-base'}`}
    >
        <span className={active ? 'text-accent' : 'text-secondary'}>{icon}</span>
        <span className="flex-1">{label}</span>
        {(badge ?? 0) > 0 && (
            <span className="min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5 leading-none">
                {(badge ?? 0) > 9 ? '9+' : badge}
            </span>
        )}
    </Link>
);

type NavItem = {
    href: string;
    label: string;
    icon: React.ReactNode;
    active: boolean;
    badge?: number;
    subLinks?: { href: string; label: string; icon: React.ReactNode; active: boolean }[];
}

const MobileDrawer = ({
    isOpen,
    onClose,
    onNavigate,
    onPrefetch,
    navItems,
    profile,
    notifications,
}: {
    isOpen: boolean;
    onClose: () => void;
    onNavigate: (href: string) => void;
    onPrefetch: (href: string) => void;
    navItems: NavItem[];
    profile: UserProfile | null;
    notifications: NotificationsData;
}) => {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        if (isOpen) document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!mounted || typeof document === 'undefined') return null;

    const displayName = profile?.full_name || 'Utilisateur';
    const initials = displayName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
    const total = notifications.total ?? (
        notifications.overdueInvoices +
        (notifications.invoiceFollowups ?? 0) +
        (notifications.pendingQuotes ?? 0) +
        (notifications.pendingRecurring ?? 0) +
        (notifications.recurringReady ?? 0) +
        (notifications.chantierPeriodDrafts ?? 0) +
        (notifications.recentAutoReminders ?? 0) +
        (notifications.dueTasks ?? 0) +
        (notifications.planningToday ?? 0) +
        (notifications.missingPointages ?? 0) +
        (notifications.completedTasks ?? 0) +
        (notifications.newRequests ?? 0) +
        (notifications.chantiersAtRisk ?? 0) +
        (notifications.maintenanceDue ?? 0) +
        (notifications.maintenanceBillingPending ?? 0)
    );

    return createPortal(
        <>
            <div
                className={`fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />
            <div
                className={`fixed top-0 left-0 h-full w-[280px] z-[9991] flex flex-col transition-transform duration-300 ease-out bg-surface dark:bg-[#141414] ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                            {profile?.avatar_url ? (
                                <img className="w-full h-full object-cover rounded-full" alt={displayName} src={profile.avatar_url} />
                            ) : (
                                <span className="text-xs font-bold text-accent">{initials}</span>
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-primary truncate">{displayName}</p>
                            {profile?.email && (
                                <p className="text-xs text-secondary truncate">{profile.email}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-base transition-colors flex-shrink-0"
                    >
                        <X className="w-5 h-5 text-secondary" />
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto py-3">
                    {navItems.map((item) => (
                        <div key={item.href}>
                            <Link
                                href={item.href}
                                prefetch
                                onPointerEnter={() => onPrefetch(item.href)}
                                onClick={() => { onNavigate(item.href); onClose(); }}
                                className={`flex items-center gap-3 px-5 py-3.5 text-sm font-semibold transition-colors relative ${item.active ? 'text-primary bg-accent/8' : 'text-secondary hover:text-primary hover:bg-base'}`}
                            >
                                {item.active && (
                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent" />
                                )}
                                <span className={item.active ? 'text-accent' : ''}>{item.icon}</span>
                                {item.label}
                                {(item.badge ?? 0) > 0 && (
                                    <span className="ml-auto min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center px-1.5">
                                        {(item.badge ?? 0) > 9 ? '9+' : item.badge}
                                    </span>
                                )}
                            </Link>
                            {item.subLinks?.map((sub) => (
                                <Link
                                    key={sub.href}
                                    href={sub.href}
                                    prefetch
                                    onPointerEnter={() => onPrefetch(sub.href)}
                                    onClick={() => { onNavigate(sub.href); onClose(); }}
                                    className={`flex items-center gap-3 pl-12 pr-5 py-3 text-sm font-semibold transition-colors ${sub.active ? 'text-accent' : 'text-secondary hover:text-primary hover:bg-base'}`}
                                >
                                    {sub.icon}
                                    {sub.label}
                                </Link>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className="border-t border-[var(--elevation-border)] px-5 py-4 flex flex-col gap-1">
                    {total > 0 && (
                        <div className="mb-2 px-3 py-2.5 rounded-xl bg-accent/8 flex items-center gap-2">
                            <Bell className="w-4 h-4 text-accent flex-shrink-0" />
                            <span className="text-xs font-semibold text-primary">{total} notification{total > 1 ? 's' : ''} en attente</span>
                        </div>
                    )}
                    <button
                        onClick={() => { onClose(); router.push('/settings'); }}
                        className="flex items-center gap-3 py-3 px-3 rounded-xl text-sm font-semibold text-secondary hover:text-primary hover:bg-base transition-colors"
                    >
                        <Settings className="w-4 h-4" />
                        Paramètres
                    </button>
                    <button
                        onClick={() => { onClose(); router.push('/login'); }}
                        className="flex items-center gap-3 py-3 px-3 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Se déconnecter
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
};

export const Topbar = ({ profile, orgName: _orgName, logoUrl: _logoUrl, notifications = { overdueInvoices: 0, expiringQuotes: 0 }, modules, permissionKeys = [], currentRoleSlug = null }: { profile: UserProfile | null; orgName?: string | null; logoUrl?: string | null; notifications?: NotificationsData; modules?: OrganizationModules; permissionKeys?: string[]; currentRoleSlug?: string | null }) => {
    const pathname = usePathname() || '/dashboard';
    const router = useRouter();
    const showAtelierAi = (currentRoleSlug === 'owner' || currentRoleSlug === 'admin') && !!(modules?.quote_ai || modules?.document_import_ai || modules?.voice_input);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [pendingHref, setPendingHref] = useState<string | null>(null);
    const permissionSet = new Set(permissionKeys);
    const canView = (key: string) => permissionSet.has('*') || permissionSet.has(key);

    const facturationActive = pathname.startsWith('/finances') || pathname.startsWith('/contracts') || pathname.startsWith('/reminders');
    const autreActive = pathname.startsWith('/requests');
    const newRequests = notifications.newRequests ?? 0;
    const pathnameKey = routeKey(pathname);

    useEffect(() => {
        setPendingHref(null);
    }, [pathname]);

    const handleNavigate = (href: string) => {
        const target = routeKey(href);
        if (target !== pathnameKey) setPendingHref(target);
    };

    const prefetchRoute = (href: string) => {
        router.prefetch(href);
    };

    const navItems: NavItem[] = [
        ...(canView('dashboard.view') ? [{
            href: '/dashboard',
            label: 'Tableau de bord',
            icon: <LayoutDashboard className="w-4 h-4" />,
            active: pathname === '/dashboard',
        }] : []),
        ...(canView('dashboard.view_ca') || canView('*') ? [{
            href: '/rapports',
            label: 'Rapports',
            icon: <BarChart2 className="w-4 h-4" />,
            active: pathname.startsWith('/rapports'),
        }] : []),
        ...(canView('clients.view') ? [{
            href: '/clients',
            label: 'Clients',
            icon: <UserCircle className="w-4 h-4" />,
            active: pathname.startsWith('/clients'),
        }] : []),
        ...(canView('chantiers.view') ? [{
            href: '/chantiers',
            label: 'Chantiers',
            icon: <HardHat className="w-4 h-4" />,
            active: pathname.startsWith('/chantiers') && !pathname.startsWith('/chantiers/planning'),
            subLinks: [
                {
                    href: '/chantiers/planning',
                    label: 'Planning global',
                    icon: <Calendar className="w-3.5 h-3.5" />,
                    active: pathname.startsWith('/chantiers/planning'),
                },
                {
                    href: '/chantiers/entretien',
                    label: 'Entretien',
                    icon: <Wrench className="w-3.5 h-3.5" />,
                    active: pathname.startsWith('/chantiers/entretien'),
                },
            ],
        }] : []),
        ...(canView('quotes.view') || canView('invoices.view') ? [{
            href: '/finances',
            label: 'Facturation',
            icon: <FileText className="w-4 h-4" />,
            active: pathname.startsWith('/finances'),
        }] : []),
        ...(canView('contracts.view') ? [{
            href: '/contracts',
            label: 'Contrats',
            icon: <ClipboardSignature className="w-4 h-4" />,
            active: pathname.startsWith('/contracts'),
        }] : []),
        ...(canView('reminders.view') ? [{
            href: '/reminders',
            label: 'Relances',
            icon: <MailWarning className="w-4 h-4" />,
            active: pathname.startsWith('/reminders'),
        }] : []),
        ...(canView('catalog.view') ? [{
            href: '/catalog',
            label: 'Catalogue',
            icon: <Package className="w-4 h-4" />,
            active: pathname.startsWith('/catalog'),
        }] : []),
        ...(showAtelierAi ? [{
            href: '/atelier-ia',
            label: 'ATELIER IA',
            icon: <Bot className="w-4 h-4" />,
            active: pathname.startsWith('/atelier-ia'),
        }] : []),
        ...(canView('leads.view') ? [{
            href: '/requests',
            label: 'Demandes',
            icon: <Inbox className="w-4 h-4" />,
            active: pathname.startsWith('/requests'),
            badge: newRequests,
        }] : []),
    ];

    return (
        <>
            <header className="relative flex items-center px-4 sm:px-6 py-3 header-glass sticky top-0 z-50">
                {/* Hamburger — mobile + tablette (< lg) */}
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="btn-icon lg:hidden mr-1"
                    aria-label="Ouvrir le menu"
                >
                    <Menu className="w-5 h-5 text-primary" />
                </button>

                {/* Nav centré — desktop uniquement (lg+) */}
                <nav className="hidden lg:flex items-center justify-center gap-2 xl:gap-3 flex-1">
                    {canView('dashboard.view') && <NavChipLink
                        href="/dashboard"
                        icon={<LayoutDashboard className="w-4 h-4" />}
                        label="Tableau de bord"
                        active={pathname === '/dashboard'}
                        pending={pendingHref === '/dashboard'}
                        onNavigate={handleNavigate}
                        onPrefetch={prefetchRoute}
                    />}

                    {(canView('dashboard.view_ca') || canView('*')) && <NavChipLink
                        href="/rapports"
                        icon={<BarChart2 className="w-4 h-4" />}
                        label="Rapports"
                        active={pathname.startsWith('/rapports')}
                        pending={pendingHref === '/rapports'}
                        onNavigate={handleNavigate}
                        onPrefetch={prefetchRoute}
                    />}

                    {canView('clients.view') && <NavChipLink
                        href="/clients"
                        icon={<UserCircle className="w-4 h-4" />}
                        label="Clients"
                        active={pathname.startsWith('/clients')}
                        pending={pendingHref === '/clients'}
                        onNavigate={handleNavigate}
                        onPrefetch={prefetchRoute}
                    />}

                    {canView('chantiers.view') && <div className="flex items-center gap-1">
                        <NavChipLink
                            href="/chantiers"
                            icon={<HardHat className="w-4 h-4" />}
                            label="Chantiers"
                            active={pathname.startsWith('/chantiers') && !pathname.startsWith('/chantiers/planning')}
                            pending={pendingHref === '/chantiers'}
                            onNavigate={handleNavigate}
                            onPrefetch={prefetchRoute}
                        />
                        <NavChipLink
                            href="/chantiers/planning"
                            title="Planning global"
                            icon={<Calendar className="w-3.5 h-3.5" />}
                            label=""
                            active={pathname.startsWith('/chantiers/planning')}
                            pending={pendingHref === '/chantiers/planning'}
                            onNavigate={handleNavigate}
                            onPrefetch={prefetchRoute}
                            className="px-2.5"
                        />
                        <NavChipLink
                            href="/chantiers/entretien"
                            title="Entretien"
                            icon={<Wrench className="w-3.5 h-3.5" />}
                            label=""
                            active={pathname.startsWith('/chantiers/entretien')}
                            pending={pendingHref === '/chantiers/entretien'}
                            onNavigate={handleNavigate}
                            onPrefetch={prefetchRoute}
                            className="px-2.5"
                        />
                    </div>}

                    {(canView('quotes.view') || canView('invoices.view') || canView('contracts.view') || canView('reminders.view')) && <NavDropdown
                        label="Facturation"
                        icon={<FileText className="w-4 h-4" />}
                        active={facturationActive}
                    >
                        {(canView('quotes.view') || canView('invoices.view')) && <NavDropdownItem
                            href="/finances"
                            icon={<FileText className="w-4 h-4" />}
                            label="Devis & Factures"
                            active={pathname.startsWith('/finances')}
                            onClick={() => handleNavigate('/finances')}
                        />}
                        {canView('contracts.view') && <NavDropdownItem
                            href="/contracts"
                            icon={<ClipboardSignature className="w-4 h-4" />}
                            label="Contrats"
                            active={pathname.startsWith('/contracts')}
                            onClick={() => handleNavigate('/contracts')}
                        />}
                        {canView('reminders.view') && <NavDropdownItem
                            href="/reminders"
                            icon={<MailWarning className="w-4 h-4" />}
                            label="Relances"
                            active={pathname.startsWith('/reminders')}
                            onClick={() => handleNavigate('/reminders')}
                        />}
                    </NavDropdown>}

                    {canView('catalog.view') && <NavChipLink
                        href="/catalog"
                        icon={<Package className="w-4 h-4" />}
                        label="Catalogue"
                        active={pathname.startsWith('/catalog')}
                        pending={pendingHref === '/catalog'}
                        onNavigate={handleNavigate}
                        onPrefetch={prefetchRoute}
                    />}

                    {showAtelierAi && (
                        <NavChipLink
                            href="/atelier-ia"
                            icon={<Bot className="w-4 h-4" />}
                            label="ATELIER IA"
                            active={pathname.startsWith('/atelier-ia')}
                            pending={pendingHref === '/atelier-ia'}
                            onNavigate={handleNavigate}
                            onPrefetch={prefetchRoute}
                        />
                    )}

                    {canView('leads.view') && <NavDropdown
                        label="Autres"
                        active={autreActive}
                        badge={newRequests}
                    >
                        <NavDropdownItem
                            href="/requests"
                            icon={<Inbox className="w-4 h-4" />}
                            label="Demandes"
                            badge={newRequests}
                            active={pathname.startsWith('/requests')}
                            onClick={() => handleNavigate('/requests')}
                        />
                    </NavDropdown>}
                </nav>

                {/* Spacer mobile + tablette */}
                <div className="flex-1 lg:hidden" />

                {/* Actions à droite */}
                <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
                    <ThemeToggle />
                    {canView('settings.view') && <Link
                        href="/settings"
                        prefetch
                        onClick={() => handleNavigate('/settings')}
                        onPointerEnter={() => prefetchRoute('/settings')}
                        className={`btn-icon hidden lg:flex ${pendingHref === '/settings' ? 'translate-y-[2px]' : ''}`}
                        title="Paramètres"
                    >
                        <Settings className="w-5 h-5 text-primary" />
                    </Link>}
                    <NotificationBell notifications={notifications} />
                    <UserMenu profile={profile} />
                </div>
                {pendingHref && <div className="nav-pending-bar" aria-hidden="true" />}
            </header>

            <MobileDrawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onNavigate={handleNavigate}
                onPrefetch={prefetchRoute}
                navItems={navItems}
                profile={profile}
                notifications={notifications}
            />
        </>
    );
};
