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
} from 'lucide-react';
import type { UserProfile } from '@/lib/data/queries/user';
import { AI_NAME } from '@/lib/brand';
import type { OrganizationModules } from '@/lib/organization-modules';

// Exact copy of ThemeToggle from the backup prototype
// Note: backup has NO mounted check — keep it to avoid hydration issues in SSR
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
                    {/* Identité utilisateur */}
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

type NotificationsData = { overdueInvoices: number; expiringQuotes: number; newRequests?: number }

const NotificationBell = ({ notifications }: { notifications: NotificationsData }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const router = useRouter();

    useEffect(() => { setMounted(true); }, []);

    const total = notifications.overdueInvoices + notifications.expiringQuotes;

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
                                        <p className="text-xs text-secondary mt-0.5">Échéance dépassée, paiement en attente</p>
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
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
};

export const Topbar = ({ profile, orgName: _orgName, logoUrl: _logoUrl, notifications = { overdueInvoices: 0, expiringQuotes: 0 }, modules }: { profile: UserProfile | null; orgName?: string | null; logoUrl?: string | null; notifications?: NotificationsData; modules?: OrganizationModules }) => {
    const pathname = usePathname() || '/dashboard';
    const showAtelierAi = !!(modules?.quote_ai || modules?.document_ai || modules?.voice_input);

    return (
        <header className="flex items-center px-6 py-3 border-b border-[var(--elevation-border)] backdrop-blur-glass sticky top-0 z-50 bg-base/40 dark:bg-black/20">
            {/* Nav centré qui prend tout l'espace libre avec espacement premium */}
            <nav className="hidden md:flex items-center justify-center md:gap-6 lg:gap-10 flex-1">
                <Link href="/dashboard" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname === '/dashboard' ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <LayoutDashboard className="w-4 h-4" />
                    Tableau de bord
                </Link>
                <Link href="/clients" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/clients') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <UserCircle className="w-4 h-4" />
                    Clients
                </Link>
                <Link href="/finances" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/finances') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <FileText className="w-4 h-4" />
                    Facturation
                </Link>
                <div className="flex items-center gap-1">
                    <Link href="/chantiers" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/chantiers') && !pathname.startsWith('/chantiers/planning') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                        <HardHat className="w-4 h-4" />
                        Chantiers
                    </Link>
                    <Link href="/chantiers/planning" title="Planning global" className={`p-1 rounded transition-colors ${pathname.startsWith('/chantiers/planning') ? 'text-accent' : 'text-secondary hover:text-primary'}`}>
                        <Calendar className="w-3.5 h-3.5" />
                    </Link>
                </div>
                <Link href="/catalog" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/catalog') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <Package className="w-4 h-4" />
                    Catalogue
                </Link>
                <Link href="/reminders" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/reminders') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <MailWarning className="w-4 h-4" />
                    Relances
                </Link>
                {showAtelierAi && (
                    <Link href="/atelier-ia" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${pathname.startsWith('/atelier-ia') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                        <Bot className="w-4 h-4" />
                        {AI_NAME}
                    </Link>
                )}
                <Link href="/requests" className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap relative ${pathname.startsWith('/requests') ? 'text-primary' : 'text-secondary hover:text-primary'}`}>
                    <Inbox className="w-4 h-4" />
                    Demandes
                    {(notifications.newRequests ?? 0) > 0 && (
                        <span className="absolute -top-2 -right-3 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 leading-none">
                            {(notifications.newRequests ?? 0) > 9 ? '9+' : notifications.newRequests}
                        </span>
                    )}
                </Link>
            </nav>

            {/* Actions à droite */}
            <div className="flex items-center gap-3 flex-shrink-0">
                <ThemeToggle />
                <Link
                    href="/settings"
                    className="w-10 h-10 flex items-center justify-center hover:scale-110 transition-all duration-300 ease-out"
                    title="Paramètres"
                >
                    <Settings className="w-5 h-5 text-primary" />
                </Link>
                <NotificationBell notifications={notifications} />
                <UserMenu profile={profile} />
            </div>
        </header>
    );
};
