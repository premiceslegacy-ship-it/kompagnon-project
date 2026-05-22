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
    User,
    LogOut,
    Inbox,
    Menu,
    X,
    ClipboardSignature,
    ChevronDown,
    BarChart2,
} from 'lucide-react';
import type { UserProfile } from '@/lib/data/queries/user';
import { AI_NAME } from '@/lib/brand';
import type { OrganizationModules } from '@/lib/organization-modules';

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
            className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-300 ease-out"
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
                className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/20 p-0.5 hover:scale-105 transition-all"
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

type NotificationsData = { overdueInvoices: number; expiringQuotes: number; newRequests?: number; chantiersAtRisk?: number }

const NotificationBell = ({ notifications }: { notifications: NotificationsData }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const router = useRouter();

    useEffect(() => { setMounted(true); }, []);

    const total = notifications.overdueInvoices + notifications.expiringQuotes + (notifications.chantiersAtRisk ?? 0);

    const toggleMenu = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + window.scrollY, left: rect.right + window.scrollX - 240 });
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
                className="relative w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-300 ease-out"
                title="Notifications"
            >
                <Bell className="w-5 h-5 text-primary" />
                {total > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-black text-[9px] font-extrabold flex items-center justify-center leading-none">
                        {total > 9 ? '9+' : total}
                    </span>
                )}
            </button>
            {mounted && isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    className="absolute w-60 menu-panel py-2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
                    style={{ top: coords.top + 8, left: coords.left }}
                    onClick={e => e.stopPropagation()}
                >
                    <p className="px-4 py-2 text-xs font-bold text-secondary uppercase tracking-wider border-b border-[var(--elevation-border)]">Notifications</p>
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
                className={`relative text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${active ? 'text-primary' : 'text-secondary hover:text-primary'}`}
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
    navItems,
    profile,
    notifications,
}: {
    isOpen: boolean;
    onClose: () => void;
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
    const total = notifications.overdueInvoices + notifications.expiringQuotes + (notifications.chantiersAtRisk ?? 0);

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
                                onClick={onClose}
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
                                    onClick={onClose}
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

export const Topbar = ({ profile, orgName: _orgName, logoUrl: _logoUrl, notifications = { overdueInvoices: 0, expiringQuotes: 0 }, modules, permissionKeys = [] }: { profile: UserProfile | null; orgName?: string | null; logoUrl?: string | null; notifications?: NotificationsData; modules?: OrganizationModules; permissionKeys?: string[] }) => {
    const pathname = usePathname() || '/dashboard';
    const showAtelierAi = !!(modules?.quote_ai || modules?.document_import_ai || modules?.voice_input);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const permissionSet = new Set(permissionKeys);
    const canView = (key: string) => permissionSet.has('*') || permissionSet.has(key);

    const facturationActive = pathname.startsWith('/finances') || pathname.startsWith('/contracts') || pathname.startsWith('/reminders');
    const autreActive = pathname.startsWith('/requests');
    const newRequests = notifications.newRequests ?? 0;

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
            label: AI_NAME,
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
            <header className="flex items-center px-4 sm:px-6 py-3 header-glass sticky top-0 z-50">
                {/* Hamburger — mobile + tablette (< lg) */}
                <button
                    onClick={() => setDrawerOpen(true)}
                    className="lg:hidden w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-300 ease-out mr-1"
                    aria-label="Ouvrir le menu"
                >
                    <Menu className="w-5 h-5 text-primary" />
                </button>

                {/* Nav centré — desktop uniquement (lg+) */}
                <nav className="hidden lg:flex items-center justify-center gap-6 xl:gap-8 flex-1">
                    {canView('dashboard.view') && <Link
                        href="/dashboard"
                        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname === '/dashboard' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                    >
                        <LayoutDashboard className="w-4 h-4" />
                        Tableau de bord
                    </Link>}

                    {(canView('dashboard.view_ca') || canView('*')) && <Link
                        href="/rapports"
                        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/rapports') ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                    >
                        <BarChart2 className="w-4 h-4" />
                        Rapports
                    </Link>}

                    {canView('clients.view') && <Link
                        href="/clients"
                        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/clients') ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                    >
                        <UserCircle className="w-4 h-4" />
                        Clients
                    </Link>}

                    {canView('chantiers.view') && <div className="flex items-center gap-1">
                        <Link
                            href="/chantiers"
                            className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/chantiers') ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                        >
                            <HardHat className="w-4 h-4" />
                            Chantiers
                        </Link>
                        <Link
                            href="/chantiers/planning"
                            title="Planning global"
                            className={`p-1 rounded transition-colors ${pathname.startsWith('/chantiers/planning') ? 'text-accent' : 'text-secondary hover:text-primary'}`}
                        >
                            <Calendar className="w-3.5 h-3.5" />
                        </Link>
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
                            onClick={() => {}}
                        />}
                        {canView('contracts.view') && <NavDropdownItem
                            href="/contracts"
                            icon={<ClipboardSignature className="w-4 h-4" />}
                            label="Contrats"
                            active={pathname.startsWith('/contracts')}
                            onClick={() => {}}
                        />}
                        {canView('reminders.view') && <NavDropdownItem
                            href="/reminders"
                            icon={<MailWarning className="w-4 h-4" />}
                            label="Relances"
                            active={pathname.startsWith('/reminders')}
                            onClick={() => {}}
                        />}
                    </NavDropdown>}

                    {canView('catalog.view') && <Link
                        href="/catalog"
                        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/catalog') ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                    >
                        <Package className="w-4 h-4" />
                        Catalogue
                    </Link>}

                    {showAtelierAi && (
                        <Link
                            href="/atelier-ia"
                            className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/atelier-ia') ? 'text-primary' : 'text-secondary hover:text-primary'}`}
                        >
                            <Bot className="w-4 h-4" />
                            {AI_NAME}
                        </Link>
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
                            onClick={() => {}}
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
                        className="hidden lg:flex w-10 h-10 items-center justify-center hover:scale-110 transition-all duration-300 ease-out"
                        title="Paramètres"
                    >
                        <Settings className="w-5 h-5 text-primary" />
                    </Link>}
                    <NotificationBell notifications={notifications} />
                    <UserMenu profile={profile} />
                </div>
            </header>

            <MobileDrawer
                isOpen={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                navItems={navItems}
                profile={profile}
                notifications={notifications}
            />
        </>
    );
};
