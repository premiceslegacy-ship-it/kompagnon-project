import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { mockData } from './lib/mock-data';
import { 
  Search, 
  Plus, 
  Upload, 
  MoreVertical, 
  Users, 
  UserPlus, 
  Euro, 
  Filter, 
  Rocket, 
  Bell, 
  LayoutDashboard, 
  UserCircle, 
  FileText, 
  Sun,
  Moon,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Calendar,
  FileDown,
  Download,
  Mail,
  TrendingUp,
  Clock,
  Percent,
  Wallet,
  Receipt,
  AlertTriangle,
  Mic,
  Building,
  MapPin,
  Phone,
  Edit2,
  Send,
  MessageSquare,
  ArrowLeft,
  Trash2,
  Eye,
  Package,
  Settings,
  Loader2,
  Check,
  X,
  MailWarning,
  Flame,
  Hourglass,
  ArrowRight,
  Pause,
  Play,
  User,
  LogOut
} from 'lucide-react';

const Icon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const ActionMenu = ({ 
  actions
}: { 
  actions: { label: string, onClick: () => void, icon?: React.ReactNode, danger?: boolean }[]
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.right + window.scrollX - 192, // 192 is w-48
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

  return (
    <>
      <button 
        ref={buttonRef} 
        onClick={toggleMenu} 
        className="p-2 rounded-full hover:bg-base transition-colors text-secondary hover:text-primary"
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {isOpen && createPortal(
        <div 
          className="absolute w-48 menu-panel py-2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
          style={{ top: coords.top, left: coords.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); action.onClick(); setIsOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm font-semibold hover:bg-base transition-colors flex items-center gap-2 ${action.danger ? 'text-red-500 hover:text-red-600' : 'text-primary'}`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <button 
      onClick={() => setIsDark(!isDark)}
      className="w-10 h-10 rounded-full bg-surface shadow-kompagnon dark:bg-surface/10 flex items-center justify-center hover:scale-105 transition-all duration-300 ease-out border border-[var(--elevation-border)]"
    >
      {isDark ? <Sun className="w-5 h-5 text-accent" /> : <Moon className="w-5 h-5 text-accent" />}
    </button>
  );
};

const UserMenu = ({ setCurrentPage }: { setCurrentPage: (page: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.right + window.scrollX - 192, // 192 is w-48
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

  return (
    <>
      <button 
        ref={buttonRef}
        onClick={toggleMenu}
        className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/20 p-0.5 hover:scale-105 transition-all"
      >
        <img className="w-full h-full object-cover rounded-full" alt="Profil utilisateur" src="https://picsum.photos/seed/user1/100/100" />
      </button>
      {isOpen && createPortal(
        <div 
          className="absolute w-48 menu-panel py-2 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
          style={{ top: coords.top + 8, left: coords.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            onClick={() => { setIsOpen(false); setCurrentPage('settings'); }}
            className="w-full text-left px-4 py-2 text-sm font-semibold text-primary hover:bg-base transition-colors flex items-center gap-2"
          >
            <User className="w-4 h-4" />
            Mon Profil
          </button>
          <div className="h-px w-full bg-[var(--elevation-border)] my-1"></div>
          <button 
            onClick={() => { setIsOpen(false); setCurrentPage('login'); }}
            className="w-full text-left px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Se déconnecter
          </button>
        </div>,
        document.body
      )}
    </>
  );
};

const Header = ({ currentPage, setCurrentPage }: { currentPage: string, setCurrentPage: (page: string) => void }) => (
  <header className="flex items-center justify-between px-8 py-4 border-b border-[var(--elevation-border)] backdrop-blur-glass sticky top-0 z-50 bg-base/40 dark:bg-black/20">
    <div className="flex items-center gap-3 w-1/4">
      <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-lg shadow-accent/20">
        <Rocket className="w-6 h-6 text-black" />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-primary">Kompagnon</h1>
    </div>
    
    <nav className="hidden md:flex items-center justify-center gap-8 flex-1">
      <button 
        onClick={() => setCurrentPage('dashboard')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'dashboard' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <LayoutDashboard className="w-4 h-4" />
        Tableau de bord
      </button>
      <button 
        onClick={() => setCurrentPage('clients')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'clients' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <UserCircle className="w-4 h-4" />
        Clients
      </button>
      <button 
        onClick={() => setCurrentPage('finances')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'finances' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <FileText className="w-4 h-4" />
        Devis & Factures
      </button>
      <button 
        onClick={() => setCurrentPage('catalog')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'catalog' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <Package className="w-4 h-4" />
        Catalogue
      </button>
      <button 
        onClick={() => setCurrentPage('reminders')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'reminders' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <MailWarning className="w-4 h-4" />
        Relances
      </button>
      <button 
        onClick={() => setCurrentPage('ai')}
        className={`text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${currentPage === 'ai' ? 'text-primary' : 'text-secondary hover:text-primary'}`}
      >
        <Sparkles className="w-4 h-4" />
        Kompagnon IA
      </button>
    </nav>

    <div className="flex items-center justify-end gap-4 w-1/4">
      <ThemeToggle />
      <button 
        onClick={() => setCurrentPage('settings')}
        className="w-10 h-10 rounded-full bg-surface dark:bg-white/5 flex items-center justify-center hover:scale-105 transition-all duration-300 ease-out border border-[var(--elevation-border)] shadow-kompagnon"
        title="Paramètres"
      >
        <Settings className="w-5 h-5 text-primary" />
      </button>
      <button className="w-10 h-10 rounded-full bg-surface dark:bg-white/5 flex items-center justify-center hover:scale-105 transition-all duration-300 ease-out border border-[var(--elevation-border)] shadow-kompagnon">
        <Bell className="w-5 h-5 text-primary" />
      </button>
      <UserMenu setCurrentPage={setCurrentPage} />
    </div>
  </header>
);

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
};

const KPIRow = () => {
  const { kpis } = mockData;
  const progress = (kpis.annualCurrent / kpis.annualGoal) * 100;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="kompagnon-card p-6 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Chiffre d'Affaires du Mois</p>
          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
            <Icon name="account_balance_wallet" className="text-accent text-sm" />
          </div>
        </div>
        <div className="mt-4">
          <p className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(kpis.monthlyRevenue)}</p>
        </div>
      </div>

      <div className="kompagnon-card p-6 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Encaissé</p>
          <div className="w-8 h-8 rounded-full bg-accent-green/10 flex items-center justify-center">
            <Icon name="payments" className="text-accent-green text-sm" />
          </div>
        </div>
        <div className="mt-4">
          <p className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(kpis.collected)}</p>
        </div>
      </div>

      <div className="kompagnon-card p-6 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <p className="text-sm font-semibold text-secondary tracking-wider uppercase">Objectif Annuel</p>
          <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Icon name="flag" className="text-blue-500 text-sm" />
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between items-end mb-2">
            <p className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(kpis.annualCurrent)}</p>
            <p className="text-sm text-secondary tabular-nums">/ {formatCurrency(kpis.annualGoal)}</p>
          </div>
          <div className="w-full h-2 bg-secondary/20 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const UrgentTasks = () => {
  const { urgentTasks } = mockData;

  return (
    <div className="kompagnon-card p-8 flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-primary">À traiter aujourd'hui</h3>
        <span className="px-3 py-1 bg-red-500/10 text-red-500 text-xs font-bold rounded-full">{urgentTasks.length} urgences</span>
      </div>
      
      <div className="space-y-4 flex-1">
        {urgentTasks.map((task) => (
          <div key={task.id} className="p-4 rounded-2xl border border-[var(--elevation-border)] bg-white/5 dark:bg-white/2 hover:bg-white/10 transition-all duration-300 ease-out group flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${task.type === 'invoice' ? 'bg-red-500/10 text-red-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
                <Icon name={task.type === 'invoice' ? 'warning' : 'auto_awesome'} />
              </div>
              <div>
                <p className="font-semibold text-primary">{task.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-secondary">{task.client}</span>
                  <span className="text-xs text-secondary">•</span>
                  <span className="text-sm font-bold text-primary tabular-nums">{formatCurrency(task.amount)}</span>
                  {task.type === 'invoice' && (
                    <span className="ml-2 px-2 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-full uppercase">
                      {task.daysLate}j de retard
                    </span>
                  )}
                  {task.type === 'quote' && (
                    <span className="ml-2 px-2 py-0.5 bg-indigo-500/10 text-indigo-500 text-[10px] font-bold rounded-full uppercase">
                      Confiance {task.confidence}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button className={`px-4 py-2 rounded-full text-sm font-bold transition-all duration-300 ease-out hover:scale-105 ${
              task.type === 'invoice' 
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' 
                : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
            }`}>
              {task.type === 'invoice' ? 'Relancer' : 'Générer'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const QuickActions = () => (
  <div className="kompagnon-card p-8 flex flex-col">
    <h3 className="text-xl font-bold text-primary mb-6">Actions Rapides</h3>
    <div className="flex flex-col gap-4">
      <button className="w-full py-4 bg-accent text-white font-bold text-lg rounded-full flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all duration-300 ease-out shadow-lg shadow-accent/20">
        <FileText className="w-5 h-5" />
        Nouveau Devis
      </button>
      <button className="w-full py-4 bg-accent-navy text-white font-bold text-lg rounded-full flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all duration-300 ease-out shadow-lg shadow-accent-navy/20 dark:bg-white/5 dark:border dark:border-[var(--elevation-border)]">
        <Icon name="person_add" />
        Nouveau Client
      </button>
    </div>
  </div>
);

const KompagnonAI = () => (
  <div className="kompagnon-card p-8 relative overflow-hidden group mt-8">
    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-indigo-500/30 transition-all duration-500"></div>
    <div className="absolute bottom-0 left-0 w-24 h-24 bg-accent-green/20 rounded-full blur-2xl -ml-10 -mb-10 group-hover:bg-accent-green/30 transition-all duration-500"></div>
    
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <Icon name="memory" className="text-indigo-500" />
        </div>
        <h3 className="text-lg font-bold text-primary">Kompagnon IA</h3>
      </div>
      <p className="text-sm text-secondary mb-4">
        La mémoire contextuelle est active. L'IA analyse vos habitudes de facturation pour optimiser vos prochains devis.
      </p>
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-accent-green"></span>
        </span>
        <span className="text-xs font-bold text-accent-green uppercase tracking-wider">Système Opérationnel</span>
      </div>
    </div>
  </div>
);

const Footer = () => (
  <footer className="p-8 border-t border-white/5 text-center">
    <p className="text-white/20 text-xs font-medium tracking-widest uppercase">Kompagnon ERP v4.2.0 • Powered by Liquid Glass AI</p>
  </footer>
);

const Dashboard = ({ userProfile }: { userProfile: any }) => {
  const { user } = mockData;
  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-4xl tracking-tight text-primary">
          <span className="font-normal">Bienvenue, </span>
          <span className="font-bold">{userProfile.firstName}</span>
        </h2>
        <p className="text-secondary text-lg">Voici un résumé de votre activité aujourd'hui.</p>
      </div>
      
      <KPIRow />
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <UrgentTasks />
        </div>
        <div className="lg:col-span-4 flex flex-col">
          <QuickActions />
          <KompagnonAI />
        </div>
      </div>
    </main>
  );
};

const NewClientModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="kompagnon-card w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
          <X className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-primary mb-6">Nouveau Client</h2>
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Nom de l'entreprise</label>
              <input type="text" required className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">SIRET</label>
              <input type="text" required className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all tabular-nums" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Email de contact</label>
              <input type="email" required className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Téléphone</label>
              <input type="tel" required className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all tabular-nums" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Adresse de facturation</label>
            <input type="text" required className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Adresse de livraison</label>
            <input type="text" className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" placeholder="Laisser vide si identique à la facturation" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Conditions de paiement</label>
            <select className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all appearance-none">
              <option value="30">30 jours net</option>
              <option value="45">45 jours fin de mois</option>
              <option value="60">60 jours net</option>
            </select>
          </div>
          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <button type="submit" className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">Créer le client</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ImportCSVModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [step, setStep] = useState(1);
  
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="kompagnon-card w-full max-w-3xl p-8 relative animate-in fade-in zoom-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
          <X className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-primary mb-6">Import CSV</h2>
        
        {step === 1 ? (
          <div className="space-y-6">
            <div 
              className="w-full h-64 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl flex flex-col items-center justify-center gap-4 text-secondary hover:border-accent/50 hover:bg-accent/5 transition-all cursor-pointer"
              onClick={() => setStep(2)}
            >
              <div className="w-16 h-16 rounded-full bg-base flex items-center justify-center border border-[var(--elevation-border)]">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-primary">Glissez votre fichier CSV ici</p>
                <p className="text-sm">ou cliquez pour parcourir</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-secondary">Associez les colonnes de votre fichier aux champs Kompagnon.</p>
            <div className="border border-[var(--elevation-border)] rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-base/50 border-b border-[var(--elevation-border)]">
                  <tr>
                    <th className="px-4 py-3 text-sm font-bold text-secondary">Colonne CSV</th>
                    <th className="px-4 py-3 text-sm font-bold text-secondary">Champ Kompagnon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--elevation-border)]">
                  {[
                    { csv: "Raison Sociale", komp: "Nom de l'entreprise" },
                    { csv: "Num_SIRET", komp: "SIRET" },
                    { csv: "Mail_Contact", komp: "Email" },
                    { csv: "Tel_Standard", komp: "Téléphone" },
                  ].map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 text-primary font-medium">{row.csv}</td>
                      <td className="px-4 py-3">
                        <select className="w-full p-2 rounded-lg bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all appearance-none">
                          <option>{row.komp}</option>
                          <option>Ignorer</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-4 pt-4">
              <button onClick={() => setStep(1)} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Retour</button>
              <button onClick={onClose} className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">Lancer l'import</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ClientsPage = ({ setCurrentPage, setSelectedClientId }: { setCurrentPage: (page: string) => void, setSelectedClientId: (id: string) => void }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [segmentFilter, setSegmentFilter] = useState('All');
  const [pendingFilter, setPendingFilter] = useState('All');
  const [quoteFilter, setQuoteFilter] = useState('All');
  const [sortBy, setSortBy] = useState('name'); // name, ca_desc, pending_desc
  
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [isImportCSVModalOpen, setIsImportCSVModalOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const { clients } = mockData;

  const filteredClients = clients.filter(client => {
    const matchesSearch = client.company.toLowerCase().includes(searchTerm.toLowerCase()) || client.contactName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || client.status === statusFilter;
    const matchesSegment = segmentFilter === 'All' || client.paretoSegment === segmentFilter;
    const matchesPending = pendingFilter === 'All' || (pendingFilter === 'has_pending' ? client.pendingAmount > 0 : client.pendingAmount === 0);
    const matchesQuote = quoteFilter === 'All' || (quoteFilter === 'has_quote' ? client.hasActiveQuote : !client.hasActiveQuote);
    
    return matchesSearch && matchesStatus && matchesSegment && matchesPending && matchesQuote;
  }).sort((a, b) => {
    if (sortBy === 'ca_desc') return b.totalRevenue - a.totalRevenue;
    if (sortBy === 'pending_desc') return b.pendingAmount - a.pendingAmount;
    return a.company.localeCompare(b.company);
  });

  const totalActive = clients.filter(c => c.status === 'Actif').length;
  const newLeads = clients.filter(c => c.status === 'Lead Chaud').length;
  const totalPending = clients.reduce((acc, c) => acc + c.pendingAmount, 0);

  const handleRowClick = (clientId: string) => {
    setSelectedClientId(clientId);
    setCurrentPage('client-profile');
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Entreprise', 'Contact', 'Email', 'Téléphone', 'Statut', 'Segment', 'CA Total', 'À Encaisser', 'Devis Actif'];
    const csvContent = [
      headers.join(','),
      ...filteredClients.map(c => 
        [c.id, `"${c.company}"`, `"${c.contactName}"`, c.email, c.phone, c.status, c.paretoSegment || '', c.totalRevenue, c.pendingAmount, c.hasActiveQuote ? 'Oui' : 'Non'].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `clients_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <NewClientModal isOpen={isNewClientModalOpen} onClose={() => setIsNewClientModalOpen(false)} />
      <ImportCSVModal isOpen={isImportCSVModalOpen} onClose={() => setIsImportCSVModalOpen(false)} />
      
      {/* Header & Actions */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-4xl font-bold text-primary">Clients</h1>
          
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <button 
              onClick={() => setIsImportCSVModalOpen(true)}
              className="flex-1 md:flex-none px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all text-sm"
            >
              <Upload className="w-4 h-4" />
              Importer
            </button>
            <button 
              onClick={handleExportCSV}
              className="flex-1 md:flex-none px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all text-sm"
            >
              <Download className="w-4 h-4" />
              Exporter
            </button>
            <button 
              onClick={() => setIsNewClientModalOpen(true)}
              className="flex-1 md:flex-none px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 text-sm"
            >
              <UserPlus className="w-4 h-4" />
              Nouveau Client
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] p-4 rounded-2xl shadow-sm">
          <div className="relative flex-1 w-full min-w-[250px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
            <input 
              type="text"
              placeholder="Rechercher un client..."
              value={searchTerm || ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary text-sm"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            <select 
              value={statusFilter || ''} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-sm appearance-none"
            >
              <option value="All">Tous statuts</option>
              <option value="Actif">Actif</option>
              <option value="Lead Chaud">Lead Chaud</option>
              <option value="Lead Froid">Lead Froid</option>
              <option value="Inactif">Inactif</option>
            </select>
            
            <select 
              value={segmentFilter || ''} 
              onChange={(e) => setSegmentFilter(e.target.value)}
              className="px-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-sm appearance-none"
            >
              <option value="All">Tous segments</option>
              <option value="Classe A (Top 20%)">Classe A (Top 20%)</option>
              <option value="Classe B (Standard)">Classe B (Standard)</option>
              <option value="Classe C (Occasionnel)">Classe C (Occasionnel)</option>
              <option value="Lead">Lead</option>
            </select>

            <select 
              value={pendingFilter || ''} 
              onChange={(e) => setPendingFilter(e.target.value)}
              className="px-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-sm appearance-none"
            >
              <option value="All">Encaissements</option>
              <option value="has_pending">À encaisser</option>
              <option value="no_pending">À jour</option>
            </select>

            <select 
              value={quoteFilter || ''} 
              onChange={(e) => setQuoteFilter(e.target.value)}
              className="px-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-sm appearance-none"
            >
              <option value="All">Devis</option>
              <option value="has_quote">Avec devis actif</option>
              <option value="no_quote">Sans devis</option>
            </select>

            <select 
              value={sortBy || ''} 
              onChange={(e) => setSortBy(e.target.value)}
              className="px-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-sm appearance-none font-semibold"
            >
              <option value="name">Trier par Nom</option>
              <option value="ca_desc">Trier par CA (Décroissant)</option>
              <option value="pending_desc">Trier par À Encaisser</option>
            </select>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="kompagnon-card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center">
            <Users className="w-6 h-6 text-accent-green" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Total Clients Actifs</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{totalActive}</p>
          </div>
        </div>
        <div className="kompagnon-card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
            <UserPlus className="w-6 h-6 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Nouveaux Leads</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{newLeads}</p>
          </div>
        </div>
        <div className="kompagnon-card p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Euro className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Total à Encaisser</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(totalPending)}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="kompagnon-card overflow-visible">
        <div className="overflow-x-auto md:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] bg-base/30">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Entreprise</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Contact</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Statut & Segment</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">CA Total</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">À encaisser</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {filteredClients.length > 0 ? (
                filteredClients.map((client) => (
                  <tr 
                    key={client.id} 
                    className="hover:bg-accent/5 transition-colors group"
                  >
                    <td className="px-6 py-4 cursor-pointer" onClick={() => handleRowClick(client.id)}>
                      <p className="font-bold text-primary hover:text-accent transition-colors">{client.company}</p>
                      <p className="text-xs text-secondary">ID: {client.id}</p>
                    </td>
                    <td className="px-6 py-4 cursor-pointer" onClick={() => handleRowClick(client.id)}>
                      <p className="text-sm text-primary">{client.contactName}</p>
                      <p className="text-xs text-secondary">{client.email}</p>
                    </td>
                    <td className="px-6 py-4 cursor-pointer" onClick={() => handleRowClick(client.id)}>
                      <div className="flex flex-col gap-2 items-start">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          client.status === 'Actif' ? 'bg-accent-green/10 text-accent-green' :
                          client.status === 'Lead Chaud' ? 'bg-accent/10 text-accent' :
                          'bg-secondary/10 text-secondary'
                        }`}>
                          {client.status}
                        </span>
                        {client.paretoSegment && (
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                            client.paretoSegment === 'Classe A (Top 20%)' ? 'border-accent text-accent bg-accent/5' :
                            client.paretoSegment === 'Classe B (Standard)' ? 'border-indigo-500/30 text-indigo-500 bg-indigo-500/5' :
                            client.paretoSegment === 'Lead' ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5' :
                            'border-[var(--elevation-border)] text-secondary'
                          }`}>
                            {client.paretoSegment}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 cursor-pointer" onClick={() => handleRowClick(client.id)}>
                      <p className="text-sm font-bold text-primary tabular-nums">{formatCurrency(client.totalRevenue)}</p>
                    </td>
                    <td className="px-6 py-4 cursor-pointer" onClick={() => handleRowClick(client.id)}>
                      <div className="flex flex-col gap-1">
                        <p className={`text-sm font-bold tabular-nums ${client.pendingAmount > 0 ? 'text-red-500' : 'text-secondary'}`}>
                          {formatCurrency(client.pendingAmount)}
                        </p>
                        {client.hasActiveQuote && (
                          <span className="text-[10px] text-accent uppercase font-bold tracking-wider">Devis en cours</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ActionMenu 
                        actions={[
                          { label: 'Voir la fiche', icon: <Eye className="w-4 h-4" />, onClick: () => handleRowClick(client.id) },
                          { label: 'Nouveau Devis', icon: <FileText className="w-4 h-4" />, onClick: () => setCurrentPage('quote-editor') },
                          { label: 'Éditer', icon: <Edit2 className="w-4 h-4" />, onClick: () => {} }
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-20 h-20 rounded-full bg-base flex items-center justify-center">
                        <Filter className="w-10 h-10 text-secondary opacity-20" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-primary">Aucun client trouvé</p>
                        <p className="text-secondary">Essayez de modifier vos critères de recherche.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
};

const FinancesPage = ({ setCurrentPage }: { setCurrentPage: (page: string) => void }) => {
  const [activeTab, setActiveTab] = useState<'quotes' | 'invoices'>('quotes');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const { quotes, invoices } = mockData;

  const filteredData = (activeTab === 'quotes' ? quotes : invoices).filter((doc: any) => 
    (doc.client.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.number.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (statusFilter === 'All' || doc.status === statusFilter)
  );

  const getStatusBadge = (status: string) => {
    const baseClasses = "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider";
    switch (status) {
      case 'Accepté':
      case 'Payée':
        return <span className={`${baseClasses} bg-accent-green/10 text-accent-green`}>{status}</span>;
      case 'Envoyé':
      case 'En attente':
        return <span className={`${baseClasses} bg-accent/10 text-accent`}>{status}</span>;
      case 'Refusé':
      case 'En retard':
        return <span className={`${baseClasses} bg-red-500/10 text-red-500`}>{status}</span>;
      default:
        return <span className={`${baseClasses} bg-secondary/10 text-secondary`}>{status}</span>;
    }
  };

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <h1 className="text-4xl font-bold text-primary">Devis & Factures</h1>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setCurrentPage('invoice-editor')}
            className="px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all"
          >
            <Plus className="w-4 h-4" />
            Nouvelle Facture
          </button>
          <button 
            onClick={() => setCurrentPage('quote-editor')}
            className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
          >
            <Sparkles className="w-4 h-4" />
            Nouveau Devis
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)]">
        <button 
          onClick={() => setActiveTab('quotes')}
          className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'quotes' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
        >
          Devis
        </button>
        <button 
          onClick={() => setActiveTab('invoices')}
          className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'invoices' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
        >
          Factures
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {activeTab === 'quotes' ? (
          <>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-accent-green" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Total Accepté ce mois</p>
                <p className="text-2xl font-bold text-primary tabular-nums font-medium">{formatCurrency(24500)}</p>
              </div>
            </div>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">En attente de réponse</p>
                <p className="text-2xl font-bold text-primary tabular-nums font-medium">12</p>
              </div>
            </div>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Percent className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Taux de conversion</p>
                <p className="text-2xl font-bold text-primary tabular-nums font-medium">68%</p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-accent-green" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Total Encaissé</p>
                <p className="text-2xl font-bold text-primary tabular-nums font-medium">{formatCurrency(128400)}</p>
              </div>
            </div>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <Receipt className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Reste à recouvrer</p>
                <p className="text-2xl font-bold text-primary tabular-nums font-medium">{formatCurrency(15200)}</p>
              </div>
            </div>
            <div className="kompagnon-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-secondary uppercase tracking-wider">En retard</p>
                <p className="text-2xl font-bold text-red-500 tabular-nums font-medium">{formatCurrency(4200)}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Table Card */}
      <div className="kompagnon-card overflow-visible">
        <div className="p-6 border-b border-[var(--elevation-border)] flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
            <input 
              type="text"
              placeholder={`Rechercher un ${activeTab === 'quotes' ? 'devis' : 'facture'}...`}
              value={searchTerm || ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary"
            />
          </div>
          <select 
            value={statusFilter || ''} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all shadow-sm appearance-none"
          >
            <option value="All">Tous les statuts</option>
            {activeTab === 'quotes' ? (
              <>
                <option value="Accepté">Accepté</option>
                <option value="En attente">En attente</option>
                <option value="Refusé">Refusé</option>
              </>
            ) : (
              <>
                <option value="Payée">Payée</option>
                <option value="En retard">En retard</option>
                <option value="Envoyé">Envoyé</option>
              </>
            )}
          </select>
        </div>
        
        <div className="overflow-x-auto md:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-base/30">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Numéro</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Client</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Montant TTC</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Statut</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {filteredData.length > 0 ? (
                filteredData.map((doc: any) => (
                  <tr key={doc.id} className="hover:bg-accent/5 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-secondary tabular-nums">{doc.number}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-bold text-primary">{doc.client}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-secondary">{doc.date}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-medium text-primary tabular-nums font-medium">{formatCurrency(doc.amount)}</p>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(doc.status)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-2 rounded-full hover:bg-base transition-colors text-secondary hover:text-primary" title="Voir PDF">
                          <FileDown className="w-4 h-4" />
                        </button>
                        <button className="p-2 rounded-full hover:bg-base transition-colors text-secondary hover:text-primary" title="Envoyer par email">
                          <Mail className="w-4 h-4" />
                        </button>
                        <ActionMenu 
                          actions={[
                            { label: 'Voir PDF', icon: <FileDown className="w-4 h-4" />, onClick: () => {} },
                            { label: 'Envoyer par email', icon: <Mail className="w-4 h-4" />, onClick: () => {} },
                            { label: 'Dupliquer', icon: <Plus className="w-4 h-4" />, onClick: () => {} },
                            { label: 'Supprimer', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => {} }
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-20 h-20 rounded-full bg-base flex items-center justify-center">
                        <Filter className="w-10 h-10 text-secondary opacity-20" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-primary">Aucun document trouvé</p>
                        <p className="text-secondary">Essayez de modifier vos critères de recherche.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
};

const AIPage = ({ setCurrentPage, setEditingQuote }: { setCurrentPage: (page: string) => void, setEditingQuote: any }) => {
  const [inputMode, setInputMode] = useState<'text' | 'doc' | 'voice'>('text');
  const [status, setStatus] = useState<'empty' | 'listening' | 'paused' | 'loading' | 'loaded'>('empty');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [transcript, setTranscript] = useState("");
  const [generatedQuotes, setGeneratedQuotes] = useState<any[]>([]);
  
  const fullText = "Installation de climatisation tri-split pour le client Boulangerie Louise. Et un autre devis pour la Boucherie Martin pour une maintenance annuelle.";
  const [charIndex, setCharIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startListening = () => {
    setStatus('listening');
    if (charIndex >= fullText.length) {
      setTranscript("");
      setCharIndex(0);
    }
    intervalRef.current = setInterval(() => {
      setCharIndex(prev => {
        const next = prev + 1;
        setTranscript(fullText.substring(0, next));
        if (next >= fullText.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatus('paused');
        }
        return next;
      });
    }, 50);
  };

  const pauseListening = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setStatus('paused');
  };

  const generateQuotesFromVoice = () => {
    setStatus('loading');
    setLoadingMessage("Analyse du besoin...");
    setTimeout(() => setLoadingMessage("Chiffrage..."), 1000);
    setTimeout(() => {
      setGeneratedQuotes([
        {
          id: 1,
          client: "Boulangerie Louise",
          title: "Installation Climatisation Tri-split",
          introText: "Suite à notre échange, veuillez trouver ci-joint notre proposition pour l'installation de votre système de climatisation.",
          sections: [
            {
              id: 1,
              title: "Matériel",
              items: [
                { id: 101, desc: "Unité extérieure Tri-split 8kW", thickness: "-", material: "Daikin", dimensions: "-", qty: 1, unit: "U", pu: 3500 },
                { id: 102, desc: "Unité intérieure murale 2.5kW", thickness: "-", material: "Daikin", dimensions: "-", qty: 3, unit: "U", pu: 450 },
              ]
            },
            {
              id: 2,
              title: "Installation & Mise en service",
              items: [
                { id: 201, desc: "Forfait pose et raccordement frigorifique", thickness: "-", material: "MO", dimensions: "-", qty: 1, unit: "Forfait", pu: 1200 },
                { id: 202, desc: "Mise en service et tests", thickness: "-", material: "MO", dimensions: "-", qty: 1, unit: "Forfait", pu: 300 },
              ]
            }
          ]
        },
        {
          id: 2,
          client: "Boucherie Martin",
          title: "Maintenance Annuelle Chambre Froide",
          introText: "Proposition de contrat de maintenance annuelle pour vos installations frigorifiques.",
          sections: [
            {
              id: 1,
              title: "Contrat de Maintenance",
              items: [
                { id: 101, desc: "Visite préventive annuelle (2 passages)", thickness: "-", material: "MO", dimensions: "-", qty: 1, unit: "Forfait", pu: 850 },
                { id: 102, desc: "Nettoyage condenseurs et évaporateurs", thickness: "-", material: "Consommable", dimensions: "-", qty: 1, unit: "Forfait", pu: 150 },
              ]
            }
          ]
        }
      ]);
      setStatus('loaded');
    }, 2500);
  };

  const handleEditQuote = (quote: any) => {
    setEditingQuote(quote);
    setCurrentPage('quote-editor');
  };

  const generateQuote = () => {
    setStatus('loading');
    const messages = ["Analyse du besoin...", "Recherche dans le catalogue...", "Chiffrage..."];
    let i = 0;
    const interval = setInterval(() => {
      setLoadingMessage(messages[i]);
      i++;
      if (i >= messages.length) clearInterval(interval);
    }, 600);

    setTimeout(() => {
      setStatus('loaded');
    }, 2500);
  };

  return (
    <main className="flex-1 p-8 max-w-[1600px] mx-auto w-full h-[calc(100vh-120px)]">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
        {/* Left Panel - Input (40%) */}
        <div className="lg:col-span-4 h-full">
          <div className="kompagnon-card p-6 h-full flex flex-col relative overflow-hidden">
            {/* Decorative Backgrounds for Voice Mode */}
            {inputMode === 'voice' && (
              <>
                <div className="absolute top-0 -left-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none"></div>
                <div className="absolute bottom-0 -right-10 w-64 h-64 bg-accent/10 rounded-full blur-[80px] pointer-events-none"></div>
              </>
            )}

            <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-full border border-[var(--elevation-border)] mb-6 relative z-10">
              {(['text', 'doc', 'voice'] as const).map((mode) => (
                <button 
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  className={`flex-1 py-2 rounded-full text-sm font-bold transition-all ${inputMode === mode ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
                >
                  {mode === 'text' ? 'Texte' : mode === 'doc' ? 'Document' : 'Vocal'}
                </button>
              ))}
            </div>

            <div className="flex-1 relative z-10 flex flex-col">
              {inputMode === 'text' && (
                <textarea 
                  className="w-full h-full p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary resize-none"
                  placeholder="Décrivez le chantier (ex: Remplacement chaudière gaz par PAC...)"
                />
              )}
              {inputMode === 'doc' && (
                <div className="w-full h-full border-dashed border-2 border-[var(--elevation-border)] rounded-2xl flex flex-col items-center justify-center gap-4 text-secondary p-8">
                  <div className="w-12 h-12 flex items-center justify-center bg-base rounded-xl shadow-sm border border-[var(--elevation-border)]">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <p>Glissez votre PDF ici</p>
                </div>
              )}
              {inputMode === 'voice' && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-8">
                  {/* Dynamic Transcription Area */}
                  <div className="w-full text-center space-y-4">
                    <div className="space-y-2">
                      <h2 className="text-primary text-xl font-light tracking-tight leading-snug min-h-[60px]">
                        {status === 'listening' || status === 'paused' ? (
                          <>
                            {transcript}
                            {status === 'listening' && <span className="animate-pulse">|</span>}
                          </>
                        ) : (
                          <>
                            "Installation de <span className="text-accent font-medium">climatisation</span> tri-split <br/> pour le client <span className="text-accent font-medium">Boulangerie Louise</span>..."
                          </>
                        )}
                      </h2>
                      <p className="text-secondary text-xs font-normal max-w-sm mx-auto">
                        L'assistant écoute et structure votre devis en temps réel.
                      </p>
                    </div>
                    {/* Visualizer */}
                    <div className="flex items-center justify-center gap-1 h-12">
                      {[4, 8, 12, 16, 10, 6, 3].map((h, i) => (
                        <div key={i} className={`w-1 rounded-full sound-bar ${i === 3 ? 'h-12 bg-primary' : 'bg-accent/40'} ${i === 0 || i === 6 ? 'h-3 opacity-40' : ''} ${i === 1 || i === 5 ? 'h-6 opacity-60' : ''} ${i === 2 || i === 4 ? 'h-9' : ''} ${status === 'paused' ? 'h-1 opacity-20' : ''}`}></div>
                      ))}
                    </div>
                  </div>
                  {/* Centered Mic Button */}
                  <div className="relative group">
                    <div className="absolute inset-0 bg-accent blur-[40px] opacity-20 group-hover:opacity-40 transition-opacity rounded-full"></div>
                    <button 
                      onClick={status === 'listening' ? pauseListening : startListening} 
                      className={`relative w-24 h-24 rounded-full bg-surface border border-[var(--elevation-border)] flex items-center justify-center vision-glow transform active:scale-95 transition-all duration-300 shadow-kompagnon ${status === 'listening' ? 'border-red-500/50 shadow-red-500/20' : ''}`}
                    >
                      {status === 'listening' ? (
                        <Pause className="w-10 h-10 font-light text-red-500 animate-pulse" />
                      ) : status === 'paused' ? (
                        <Play className="w-10 h-10 font-light text-primary ml-2" />
                      ) : (
                        <Mic className="w-10 h-10 font-light text-primary" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button 
              onClick={inputMode === 'voice' && (status === 'listening' || status === 'paused') ? generateQuotesFromVoice : generateQuote}
              className="mt-6 w-full py-4 rounded-full bg-accent text-black font-bold shadow-lg shadow-accent/20 hover:scale-[1.02] transition-all flex items-center justify-center gap-2 relative z-10"
            >
              <FileText className="w-5 h-5" />
              Générer le devis
            </button>
          </div>
        </div>

        {/* Right Panel - Result (60%) */}
        <div className="lg:col-span-8 h-full">
          <div className="kompagnon-card p-8 h-full overflow-y-auto">
            {status === 'empty' && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-secondary">
                <FileText className="w-16 h-16 opacity-20" />
                <p className="text-xl font-medium">Décrivez votre projet à gauche pour générer un devis</p>
              </div>
            )}
            
            {status === 'loading' && (
              <div className="h-full flex flex-col items-center justify-center gap-6">
                <div className="w-16 h-16 rounded-full border-4 border-accent border-t-transparent animate-spin"></div>
                <p className="text-xl font-bold text-primary animate-pulse">{loadingMessage}</p>
              </div>
            )}

            {status === 'loaded' && (
              <div className="space-y-8">
                <div className="flex items-center justify-between border-b border-[var(--elevation-border)] pb-4">
                  <h3 className="text-2xl font-bold text-primary">Devis générés ({generatedQuotes.length > 0 ? generatedQuotes.length : 1})</h3>
                  <button onClick={() => setStatus('empty')} className="text-secondary hover:text-primary transition-colors">Nouvelle génération</button>
                </div>
                
                {generatedQuotes.length > 0 ? (
                  <div className="grid grid-cols-1 gap-6">
                    {generatedQuotes.map(quote => {
                      const subTotal = quote.sections.reduce((acc: number, sec: any) => acc + sec.items.reduce((secAcc: number, item: any) => secAcc + (Number(item.qty) * Number(item.pu)), 0), 0);
                      return (
                        <div key={quote.id} className="p-6 rounded-2xl border border-[var(--elevation-border)] bg-base/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-accent/50 transition-colors">
                          <div>
                            <div className="flex items-center gap-3 mb-2">
                              <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold uppercase tracking-wider">IA</span>
                              <h4 className="text-lg font-bold text-primary">{quote.client}</h4>
                            </div>
                            <p className="text-secondary font-medium">{quote.title}</p>
                            <p className="text-sm text-secondary mt-1">{quote.sections.length} sections • {formatCurrency(subTotal)} HT</p>
                          </div>
                          <button 
                            onClick={() => handleEditQuote(quote)}
                            className="px-6 py-3 rounded-full bg-surface border border-[var(--elevation-border)] text-primary font-bold hover:bg-accent hover:text-black hover:border-accent transition-all shadow-sm flex items-center gap-2 whitespace-nowrap"
                          >
                            Ouvrir dans l'éditeur <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-[var(--elevation-border)]">
                          <th className="py-4 text-secondary">Désignation</th>
                          <th className="py-4 text-secondary text-right">Qté</th>
                          <th className="py-4 text-secondary text-right">PU HT</th>
                          <th className="py-4 text-secondary text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--elevation-border)]">
                        {[
                          { desc: "Pompe à chaleur Air/Eau", qty: 1, pu: 8500, total: 8500 },
                          { desc: "Kit installation & Raccordement", qty: 1, pu: 1200, total: 1200 },
                          { desc: "Main d'œuvre", qty: 1, pu: 1500, total: 1500 },
                        ].map((item, i) => (
                          <tr key={i}>
                            <td className="py-4 flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold">IA</span>
                              {item.desc}
                            </td>
                            <td className="py-4 text-right tabular-nums">{item.qty}</td>
                            <td className="py-4 text-right tabular-nums">{formatCurrency(item.pu)}</td>
                            <td className="py-4 text-right tabular-nums font-bold">{formatCurrency(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    <div className="flex justify-end pt-6">
                      <div className="w-64 space-y-2">
                        <div className="flex justify-between text-secondary"><span>Sous-total HT</span><span>{formatCurrency(11200)}</span></div>
                        <div className="flex justify-between text-secondary"><span>TVA (20%)</span><span>{formatCurrency(2240)}</span></div>
                        <div className="flex justify-between text-primary text-2xl font-bold pt-4 border-t border-[var(--elevation-border)] tabular-nums">
                          <span>TOTAL TTC</span><span>{formatCurrency(13440)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button className="px-8 py-4 rounded-full bg-accent-green text-black font-bold hover:scale-105 transition-all">
                        Valider & Enregistrer
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

const ClientProfilePage = ({ setCurrentPage, clientId }: { setCurrentPage: (page: string) => void, clientId: string | null }) => {
  const [activeTab, setActiveTab] = useState<'history' | 'notes'>('history');
  
  // Find the client from mockData or use a fallback
  const foundClient = mockData.clients.find(c => c.id === clientId);
  
  const client = foundClient ? {
    name: foundClient.company,
    siret: "394 827 192 00045", // Mock SIRET
    email: foundClient.email,
    phone: "01 23 45 67 89", // Mock phone
    address: "15 Avenue des Artisans, 75012 Paris", // Mock address
    status: foundClient.status,
    revenue: foundClient.totalRevenue,
    pending: foundClient.pendingAmount,
    avgPaymentDelay: 14,
    history: [
      { id: 'F-2023-089', type: 'Facture', date: '12/10/2023', amount: 12400, status: 'En retard' },
      { id: 'F-2023-085', type: 'Facture', date: '28/09/2023', amount: 8500, status: 'Payée' },
      { id: 'F-2023-072', type: 'Facture', date: '15/08/2023', amount: 32000, status: 'Payée' },
      { id: 'D-2023-142', type: 'Devis', date: '05/10/2023', amount: 15000, status: 'Accepté' },
      { id: 'D-2023-156', type: 'Devis', date: '18/10/2023', amount: 4500, status: 'En attente' },
    ],
    notes: [
      { id: 1, date: '20/10/2023 14:30', author: 'Kael', text: 'Appel de relance pour la facture F-2023-089. Promesse de paiement avant la fin de semaine.' },
      { id: 2, date: '05/10/2023 09:15', author: 'Kael', text: 'Nouveau chantier validé pour la rénovation des bureaux.' }
    ]
  } : {
    name: "Client Inconnu",
    siret: "N/A",
    email: "N/A",
    phone: "N/A",
    address: "N/A",
    status: "Inconnu",
    revenue: 0,
    pending: 0,
    avgPaymentDelay: 0,
    history: [],
    notes: []
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider";
    switch (status) {
      case 'Accepté':
      case 'Payée':
        return <span className={`${baseClasses} bg-accent-green/10 text-accent-green`}>{status}</span>;
      case 'Envoyé':
      case 'En attente':
        return <span className={`${baseClasses} bg-accent/10 text-accent`}>{status}</span>;
      case 'Refusé':
      case 'En retard':
        return <span className={`${baseClasses} bg-red-500/10 text-red-500`}>{status}</span>;
      default:
        return <span className={`${baseClasses} bg-secondary/10 text-secondary`}>{status}</span>;
    }
  };

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      {/* Back button */}
      <button 
        onClick={() => setCurrentPage('clients')}
        className="flex items-center gap-2 text-secondary hover:text-primary transition-colors font-medium text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour aux clients
      </button>

      {/* Header Client (Hero Section) */}
      <div className="kompagnon-card p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-bold text-primary leading-none">{client.name}</h1>
            <span className="px-3 py-1 bg-accent-green/10 text-accent-green text-xs font-bold rounded-full uppercase tracking-wider">Client Actif</span>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-secondary text-sm">
            <span className="flex items-center gap-2"><Building className="w-4 h-4"/> SIRET: {client.siret}</span>
            <span className="flex items-center gap-2"><Mail className="w-4 h-4"/> {client.email}</span>
            <span className="flex items-center gap-2"><Phone className="w-4 h-4"/> {client.phone}</span>
            <span className="flex items-center gap-2"><MapPin className="w-4 h-4"/> {client.address}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full lg:w-auto">
          <button className="flex-1 lg:flex-none px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all">
            <Edit2 className="w-4 h-4"/> Éditer la fiche
          </button>
          <button 
            onClick={() => setCurrentPage('quote-editor')}
            className="flex-1 lg:flex-none px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
          >
            <Sparkles className="w-4 h-4"/> Nouveau Devis
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="kompagnon-card p-6 flex flex-col gap-2">
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Chiffre d'Affaires Généré</span>
          <span className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(client.revenue)}</span>
        </div>
        <div className="kompagnon-card p-6 flex flex-col gap-2">
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Reste à Encaisser</span>
          <span className={`text-3xl font-bold tabular-nums ${client.pending > 0 ? 'text-red-500' : 'text-primary'}`}>{formatCurrency(client.pending)}</span>
        </div>
        <div className="kompagnon-card p-6 flex flex-col gap-2">
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Délai de Paiement Moyen</span>
          <span className="text-3xl font-bold text-primary tabular-nums">{client.avgPaymentDelay} jours</span>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="kompagnon-card overflow-hidden flex flex-col min-h-[500px]">
        {/* Tabs Header */}
        <div className="flex items-center gap-6 px-8 pt-6 border-b border-[var(--elevation-border)]">
          <button 
            onClick={() => setActiveTab('history')}
            className={`pb-4 text-sm font-bold transition-all border-b-2 ${activeTab === 'history' ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            Historique Financier
          </button>
          <button 
            onClick={() => setActiveTab('notes')}
            className={`pb-4 text-sm font-bold transition-all border-b-2 ${activeTab === 'notes' ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            Notes & Mémoire
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-0 flex-1">
          {activeTab === 'history' ? (
            <div className="overflow-x-auto md:overflow-visible">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-base/30">
                    <th className="px-8 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Type</th>
                    <th className="px-8 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Date</th>
                    <th className="px-8 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Montant TTC</th>
                    <th className="px-8 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Statut</th>
                    <th className="px-8 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--elevation-border)]">
                  {client.history.map((doc) => (
                    <tr key={doc.id} className="hover:bg-accent/5 transition-colors group">
                      <td className="px-8 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${doc.type === 'Facture' ? 'bg-blue-500/10 text-blue-500' : 'bg-accent/10 text-accent'}`}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-primary">{doc.type}</p>
                            <p className="text-xs text-secondary tabular-nums">{doc.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-4">
                        <p className="text-sm text-secondary">{doc.date}</p>
                      </td>
                      <td className="px-8 py-4 text-right">
                        <p className="text-sm font-bold text-primary tabular-nums">{formatCurrency(doc.amount)}</p>
                      </td>
                      <td className="px-8 py-4">
                        {getStatusBadge(doc.status)}
                      </td>
                      <td className="px-8 py-4 text-right">
                        <button className="p-2 rounded-full hover:bg-base transition-colors text-secondary hover:text-primary" title="Télécharger PDF">
                          <FileDown className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 max-w-3xl mx-auto w-full space-y-8">
              {/* Add Note Input */}
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/20 p-0.5 shrink-0">
                  <img className="w-full h-full object-cover rounded-full" alt="Profil utilisateur" src="https://picsum.photos/seed/user1/100/100" />
                </div>
                <div className="flex-1 relative">
                  <textarea 
                    placeholder="Ajouter une note, un compte-rendu d'appel..."
                    className="w-full min-h-[100px] p-4 pr-14 rounded-2xl bg-base/50 border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary resize-none"
                  />
                  <button className="absolute bottom-4 right-4 p-2 rounded-full bg-accent text-black hover:scale-105 transition-all shadow-lg shadow-accent/20">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative pl-5 space-y-8 before:absolute before:inset-y-0 before:left-[19px] before:w-px before:bg-[var(--elevation-border)]">
                {client.notes.map((note) => (
                  <div key={note.id} className="relative">
                    <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-accent ring-4 ring-surface dark:ring-[#050505]"></div>
                    <div className="bg-base/30 border border-[var(--elevation-border)] rounded-2xl p-5 ml-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-primary text-sm">{note.author}</span>
                        <span className="text-xs text-secondary">{note.date}</span>
                      </div>
                      <p className="text-secondary text-sm leading-relaxed">{note.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

const QuoteEditorPage = ({ setCurrentPage, editingQuote }: { setCurrentPage: (page: string) => void, editingQuote: any }) => {
  const [introText, setIntroText] = useState(editingQuote?.introText || "Suite à notre visite sur site, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale pour la fabrication de vos pièces de tôlerie.");
  const [sections, setSections] = useState(editingQuote?.sections || [
    {
      id: 1,
      title: "Section 1 : Découpe Laser & Pliage",
      items: [
        { id: 101, desc: "Carter de protection machine", thickness: "3mm", material: "Acier S235", dimensions: "1200x800", qty: 4, unit: "U", pu: 145.50 },
        { id: 102, desc: "Support moteur renforcé", thickness: "5mm", material: "Inox 304L", dimensions: "400x400", qty: 12, unit: "U", pu: 85.00 },
      ]
    }
  ]);
  const [client, setClient] = useState(editingQuote?.client || "AéroTech");
  const [title, setTitle] = useState(editingQuote?.title || "Fabrication sous-ensembles mécano-soudés");
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);

  const [issueDate, setIssueDate] = useState("2024-03-07");
  const [validityDate, setValidityDate] = useState("2024-04-07");

  const updateItem = (sectionId: number, itemId: number, field: string, value: string | number) => {
    setSections(sections.map((sec: any) => {
      if (sec.id === sectionId) {
        return {
          ...sec,
          items: sec.items.map((item: any) => item.id === itemId ? { ...item, [field]: value } : item)
        };
      }
      return sec;
    }));
  };

  const addFreeItem = (sectionId: number) => {
    setSections(sections.map((sec: any) => {
      if (sec.id === sectionId) {
        return {
          ...sec,
          items: [...sec.items, { id: Date.now(), desc: "", thickness: "", material: "", dimensions: "", qty: 1, unit: "U", pu: 0 }]
        };
      }
      return sec;
    }));
  };

  const addSection = () => {
    setSections([...sections, { id: Date.now(), title: `Nouvelle Section`, items: [] }]);
  };

  const removeSection = (sectionId: number) => {
    setSections(sections.filter((sec: any) => sec.id !== sectionId));
  };

  const removeItem = (sectionId: number, itemId: number) => {
    setSections(sections.map((sec: any) => {
      if (sec.id === sectionId) {
        return { ...sec, items: sec.items.filter((item: any) => item.id !== itemId) };
      }
      return sec;
    }));
  };

  const handleCatalogSelect = (item: any) => {
    if (activeSectionId) {
      setSections(sections.map((sec: any) => {
        if (sec.id === activeSectionId) {
          return {
            ...sec,
            items: [...sec.items, { 
              id: Date.now(), 
              desc: item.name, 
              thickness: item.thickness || "", 
              material: item.name.split(' ')[0] || "", 
              dimensions: item.format || "", 
              qty: 1, 
              unit: item.unit || "U", 
              pu: item.price 
            }]
          };
        }
        return sec;
      }));
    }
    setIsCatalogModalOpen(false);
  };

  const subTotal = sections.reduce((acc: number, sec: any) => acc + sec.items.reduce((secAcc: number, item: any) => secAcc + (Number(item.qty) * Number(item.pu)), 0), 0);
  const tax = subTotal * 0.20;
  const total = subTotal + tax;

  return (
    <main className="flex-1 p-8 max-w-[1600px] mx-auto w-full space-y-8">
      <datalist id="materials-list">
        {mockData.catalog.materials.map(m => <option key={m.id} value={m.name} />)}
      </datalist>
      
      {/* Catalog Modal */}
      {isCatalogModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="kompagnon-card w-full max-w-4xl p-8 relative animate-in fade-in zoom-in duration-300 max-h-[80vh] flex flex-col">
            <button onClick={() => setIsCatalogModalOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold text-primary mb-6">Catalogue Matériaux & Opérations</h2>
            
            <div className="flex-1 overflow-y-auto space-y-8 pr-2">
              <div>
                <h3 className="text-lg font-bold text-primary mb-4 border-b border-[var(--elevation-border)] pb-2">Matériaux</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mockData.catalog.materials.map(mat => (
                    <div key={mat.id} onClick={() => handleCatalogSelect(mat)} className="p-4 rounded-xl border border-[var(--elevation-border)] bg-base/30 hover:bg-accent/10 hover:border-accent/50 cursor-pointer transition-all flex justify-between items-center group">
                      <div>
                        <p className="font-bold text-primary group-hover:text-accent transition-colors">{mat.name}</p>
                        <p className="text-xs text-secondary">Ép: {mat.thickness} | Format: {mat.format}</p>
                      </div>
                      <p className="font-bold tabular-nums text-primary">{formatCurrency(mat.price)}/{mat.unit}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-primary mb-4 border-b border-[var(--elevation-border)] pb-2">Opérations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {mockData.catalog.operations.map(op => (
                    <div key={op.id} onClick={() => handleCatalogSelect(op)} className="p-4 rounded-xl border border-[var(--elevation-border)] bg-base/30 hover:bg-accent/10 hover:border-accent/50 cursor-pointer transition-all flex justify-between items-center group">
                      <p className="font-bold text-primary group-hover:text-accent transition-colors">{op.name}</p>
                      <p className="font-bold tabular-nums text-primary">{formatCurrency(op.price)}/{op.unit}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Topbar Contextuelle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setCurrentPage('finances')}
            className="w-10 h-10 rounded-full bg-surface border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-primary">Création de Devis</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="px-6 py-3 rounded-full text-secondary hover:text-primary hover:bg-surface transition-colors font-semibold flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Aperçu PDF
          </button>
          <button className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
            <Send className="w-4 h-4" />
            Enregistrer & Envoyer
          </button>
        </div>
      </div>

      {/* Paramètres & Intro */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-8">
          <div className="kompagnon-card p-8 space-y-6">
            <h3 className="text-lg font-bold text-primary border-b border-[var(--elevation-border)] pb-2">Informations Générales</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Client</label>
                <select value={client || ''} onChange={e => setClient(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
                  <option>AéroTech</option>
                  <option>Construction Métallique Dupon</option>
                  <option>AgriMachinerie</option>
                  <option>Boulangerie Louise</option>
                  <option>Boucherie Martin</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Titre du projet</label>
                <input type="text" value={title || ''} onChange={e => setTitle(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Date d'émission</label>
                  <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Validité</label>
                  <input type="date" value={validityDate} onChange={e => setValidityDate(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
              </div>
            </div>
          </div>

          {/* Récapitulatif Financier */}
          <div className="kompagnon-card p-8 space-y-6 sticky top-24">
            <h3 className="text-lg font-bold text-primary mb-4">Récapitulatif</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-secondary">
                <span>Sous-total HT</span>
                <span className="tabular-nums">{formatCurrency(subTotal)}</span>
              </div>
              <div className="flex justify-between items-center text-secondary">
                <span>TVA (20%)</span>
                <span className="tabular-nums">{formatCurrency(tax)}</span>
              </div>
            </div>
            <div className="h-px w-full bg-[var(--elevation-border)] my-6"></div>
            <div className="flex justify-between items-end">
              <span className="text-secondary font-semibold">TOTAL TTC</span>
              <span className="text-4xl font-bold text-primary tabular-nums tracking-tight">
                {formatCurrency(total)}
              </span>
            </div>
          </div>
        </div>

        {/* Éditeur Principal */}
        <div className="lg:col-span-8 space-y-8">
          <div className="kompagnon-card p-8 space-y-4">
            <label className="text-sm font-semibold text-secondary flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Texte d'introduction commercial
            </label>
            <textarea 
              value={introText || ''}
              onChange={(e) => setIntroText(e.target.value)}
              className="w-full min-h-[120px] p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all resize-y"
            />
          </div>

          {sections.map((section: any) => (
            <div key={section.id} className="kompagnon-card p-8 space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--elevation-border)] pb-4">
                <input 
                  type="text" 
                  value={section.title || ''}
                  onChange={(e) => setSections(sections.map((s: any) => s.id === section.id ? { ...s, title: e.target.value } : s))}
                  className="text-xl font-bold text-primary bg-transparent border-none focus:outline-none focus:ring-0 w-full"
                />
                <button onClick={() => removeSection(section.id)} className="p-2 text-secondary hover:text-red-500 transition-colors rounded-full hover:bg-red-500/10 flex-shrink-0 ml-4" title="Supprimer la section">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-[var(--elevation-border)]">
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[25%]">Désignation</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[10%]">Ép.</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[15%]">Matière</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[15%]">Dim. (Lxl)</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[8%] text-right">Qté</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[12%] text-right">PU HT</th>
                      <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[15%] text-right">Total HT</th>
                      <th className="pb-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--elevation-border)]">
                    {section.items.map((item: any) => (
                      <tr key={item.id} className="group">
                        <td className="py-2 pr-2">
                          <input type="text" value={item.desc || ''} onChange={(e) => updateItem(section.id, item.id, 'desc', e.target.value)} placeholder="Désignation..." className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="text" value={item.thickness || ''} onChange={(e) => updateItem(section.id, item.id, 'thickness', e.target.value)} placeholder="ex: 3mm" className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="text" list="materials-list" value={item.material || ''} onChange={(e) => updateItem(section.id, item.id, 'material', e.target.value)} placeholder="Acier..." className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="text" value={item.dimensions || ''} onChange={(e) => updateItem(section.id, item.id, 'dimensions', e.target.value)} placeholder="1000x500" className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" value={item.qty || ''} onChange={(e) => updateItem(section.id, item.id, 'qty', e.target.value)} className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary tabular-nums text-right text-sm" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" value={item.pu || ''} onChange={(e) => updateItem(section.id, item.id, 'pu', e.target.value)} className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary tabular-nums text-right text-sm" />
                        </td>
                        <td className="py-2 text-right">
                          <span className="font-bold text-primary tabular-nums pr-2 text-sm">
                            {formatCurrency(Number(item.qty) * Number(item.pu))}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <button onClick={() => removeItem(section.id, item.id)} className="p-2 text-secondary hover:text-red-500 transition-all rounded-full hover:bg-red-500/10">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="flex items-center gap-3 pt-4">
                <button onClick={() => addFreeItem(section.id)} className="flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors px-4 py-2 rounded-full border border-accent/20 bg-accent/5">
                  <Plus className="w-4 h-4" />
                  Saisie libre
                </button>
                <button onClick={() => { setActiveSectionId(section.id); setIsCatalogModalOpen(true); }} className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-accent transition-colors px-4 py-2 rounded-full border border-[var(--elevation-border)] bg-base/50">
                  <Search className="w-4 h-4" />
                  Piocher dans le catalogue
                </button>
              </div>
            </div>
          ))}

          <button onClick={addSection} className="w-full py-4 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl text-secondary font-bold hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2">
            <Plus className="w-5 h-5" />
            Ajouter une section
          </button>
        </div>
      </div>
    </main>
  );
};

const InvoiceEditorPage = ({ setCurrentPage }: { setCurrentPage: (page: string) => void }) => {
  const [items, setItems] = useState([
    { id: 1, desc: "Acompte 30% sur devis DEV-2024-001", qty: 1, pu: 13500 },
  ]);

  const [issueDate, setIssueDate] = useState("2024-03-07");
  const [dueDate, setDueDate] = useState("2024-04-07");

  const updateItem = (id: number, field: string, value: string | number) => {
    setItems(items.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  const addItem = () => {
    setItems([...items, { id: Date.now(), desc: "", qty: 1, pu: 0 }]);
  };

  const removeItem = (id: number) => {
    setItems(items.filter(item => item.id !== id));
  };

  const subTotal = items.reduce((acc, item) => acc + (Number(item.qty) * Number(item.pu)), 0);
  const tax = subTotal * 0.20;
  const total = subTotal + tax;

  return (
    <main className="flex-1 p-8 max-w-[1200px] mx-auto w-full space-y-8">
      {/* Topbar Contextuelle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setCurrentPage('finances')}
            className="w-10 h-10 rounded-full bg-surface border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-primary">Création de Facture</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button className="px-6 py-3 rounded-full text-secondary hover:text-primary hover:bg-surface transition-colors font-semibold flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Aperçu PDF
          </button>
          <button className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
            <Send className="w-4 h-4" />
            Valider & Envoyer
          </button>
        </div>
      </div>

      {/* Paramètres du Document */}
      <div className="kompagnon-card p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Client</label>
            <select className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
              <option>AéroTech</option>
              <option>Construction Métallique Dupon</option>
              <option>AgriMachinerie</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Date de facturation</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Échéance</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
          </div>
        </div>
        <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-accent" />
            <span className="font-semibold text-primary">Facturer depuis un devis existant ?</span>
          </div>
          <button className="px-4 py-2 rounded-full bg-surface border border-[var(--elevation-border)] text-sm font-bold text-primary hover:bg-base transition-colors">
            Sélectionner un devis
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Éditeur de Lignes */}
        <div className="kompagnon-card p-8 flex-1 w-full overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-[var(--elevation-border)]">
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider w-[50%]">Désignation</th>
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider w-[15%] text-right">Quantité</th>
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider w-[15%] text-right">PU HT</th>
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider w-[15%] text-right">Total HT</th>
                  <th className="pb-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {items.map((item) => (
                  <tr key={item.id} className="group">
                    <td className="py-3 pr-4">
                      <input 
                        type="text" 
                        value={item.desc || ''}
                        onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                        placeholder="Description..."
                        className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <input 
                        type="number" 
                        value={item.qty || ''}
                        onChange={(e) => updateItem(item.id, 'qty', e.target.value)}
                        className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary tabular-nums text-right"
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="relative">
                        <input 
                          type="number" 
                          value={item.pu || ''}
                          onChange={(e) => updateItem(item.id, 'pu', e.target.value)}
                          className="w-full p-2 pr-6 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary tabular-nums text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none">€</span>
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-bold text-primary tabular-nums pr-2">
                        {formatCurrency(Number(item.qty) * Number(item.pu))}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button 
                        onClick={() => removeItem(item.id)}
                        className="p-2 text-secondary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button 
            onClick={addItem}
            className="mt-4 flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors px-2 py-1"
          >
            <Plus className="w-4 h-4" />
            Ajouter une ligne
          </button>
        </div>

        {/* Récapitulatif Financier */}
        <div className="kompagnon-card p-8 w-full lg:w-[350px] shrink-0 sticky top-24 space-y-6">
          <h3 className="text-lg font-bold text-primary mb-4">Récapitulatif</h3>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center text-secondary">
              <span>Sous-total HT</span>
              <span className="tabular-nums">{formatCurrency(subTotal)}</span>
            </div>
            <div className="flex justify-between items-center text-secondary">
              <span>TVA (20%)</span>
              <span className="tabular-nums">{formatCurrency(tax)}</span>
            </div>
          </div>
          
          <div className="h-px w-full bg-[var(--elevation-border)] my-6"></div>
          
          <div className="flex justify-between items-end">
            <span className="text-secondary font-semibold">TOTAL TTC</span>
            <span className="text-4xl font-bold text-primary tabular-nums tracking-tight">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
};

const CatalogPage = () => {
  const [activeTab, setActiveTab] = useState<'materials' | 'labor'>('materials');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>('');
  const [isNewMaterialModalOpen, setIsNewMaterialModalOpen] = useState(false);
  const [isNewOperationModalOpen, setIsNewOperationModalOpen] = useState(false);
  
  const [catalogData, setCatalogData] = useState({
    materials: [
      { id: 1, ref: 'AC-S235-2MM', name: 'Tôle Acier S235 - Ép. 2mm (3000x1500)', category: 'Acier', purchasePrice: 45, margin: 30, sellingPrice: 58.50 },
      { id: 2, ref: 'AC-GALV-3MM', name: 'Tôle Acier Galvanisé - Ép. 3mm (3000x1500)', category: 'Acier Galva', purchasePrice: 65, margin: 35, sellingPrice: 87.75 },
      { id: 3, ref: 'IN-304L-1.5MM', name: 'Tôle Inox 304L Brossé - Ép. 1.5mm (2500x1250)', category: 'Inox', purchasePrice: 120, margin: 25, sellingPrice: 150 },
      { id: 4, ref: 'AL-5754-5MM', name: 'Tôle Alu 5754 H111 - Ép. 5mm (3000x1500)', category: 'Aluminium', purchasePrice: 180, margin: 30, sellingPrice: 234 },
      { id: 5, ref: 'AC-S235-10MM', name: 'Tôle Acier S235 - Ép. 10mm (3000x1500)', category: 'Acier', purchasePrice: 210, margin: 25, sellingPrice: 262.50 },
      { id: 6, ref: 'IN-316L-3MM', name: 'Tôle Inox 316L - Ép. 3mm (3000x1500)', category: 'Inox', purchasePrice: 340, margin: 20, sellingPrice: 408 },
      { id: 7, ref: 'TUBE-AC-40X40', name: 'Tube Acier Carré 40x40x2 (Barre 6m)', category: 'Profilé', purchasePrice: 24, margin: 40, sellingPrice: 33.60 },
      { id: 8, ref: 'COR-IN-50X50', name: 'Cornière Inox 304L 50x50x5 (Barre 6m)', category: 'Profilé', purchasePrice: 85, margin: 35, sellingPrice: 114.75 },
    ],
    labor: [
      { id: 101, ref: 'MO-CAO', name: 'Programmation CAO / DAO', category: 'Ingénierie', purchasePrice: 45, margin: 60, sellingPrice: 72 },
      { id: 102, ref: 'MO-LASER', name: 'Découpe Laser (Heure Machine + Opérateur)', category: 'Usinage', purchasePrice: 80, margin: 50, sellingPrice: 120 },
      { id: 103, ref: 'MO-PLIAGE', name: 'Pliage Commande Numérique', category: 'Usinage', purchasePrice: 65, margin: 55, sellingPrice: 100.75 },
      { id: 104, ref: 'MO-SOUD-TIG', name: 'Soudure TIG / MIG', category: 'Assemblage', purchasePrice: 50, margin: 60, sellingPrice: 80 },
      { id: 105, ref: 'MO-THERMO', name: 'Thermolaquage (Forfait m²)', category: 'Finition', purchasePrice: 15, margin: 70, sellingPrice: 25.50 },
    ]
  });

  const [confirmUpdateModal, setConfirmUpdateModal] = useState<{
    isOpen: boolean;
    itemId: number | null;
    oldPrice: number;
    newPrice: number;
    itemName: string;
    itemType: 'materials' | 'labor';
  }>({
    isOpen: false,
    itemId: null,
    oldPrice: 0,
    newPrice: 0,
    itemName: '',
    itemType: 'materials'
  });

  const handlePriceChange = (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>, item: any, type: 'materials' | 'labor') => {
    const newPrice = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(newPrice) && newPrice !== item.sellingPrice) {
      setConfirmUpdateModal({
        isOpen: true,
        itemId: item.id,
        oldPrice: item.sellingPrice,
        newPrice: newPrice,
        itemName: item.name,
        itemType: type
      });
    }
    setEditingPriceId(null);
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'Acier':
      case 'Acier Galva':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-500">{category}</span>;
      case 'Inox':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-500/10 text-zinc-500">{category}</span>;
      case 'Aluminium':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">{category}</span>;
      case 'Profilé':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-stone-500/10 text-stone-500">{category}</span>;
      case 'Ingénierie':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-500">{category}</span>;
      case 'Usinage':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-500">{category}</span>;
      case 'Assemblage':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500">{category}</span>;
      case 'Finition':
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-500/10 text-teal-500">{category}</span>;
      default:
        return <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-secondary/10 text-secondary">{category}</span>;
    }
  };

  const currentData = activeTab === 'materials' ? catalogData.materials : catalogData.labor;
  const filteredData = currentData.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.ref.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      {/* Price Update Confirmation Modal */}
      {confirmUpdateModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="kompagnon-card w-full max-w-md p-8 relative animate-in fade-in zoom-in duration-300">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mb-6">
              <AlertCircle className="w-6 h-6 text-accent" />
            </div>
            <h2 className="text-2xl font-bold text-primary mb-2">Mise à jour du prix</h2>
            <p className="text-secondary mb-6">
              Vous avez modifié le prix de <span className="font-bold text-primary">{confirmUpdateModal.itemName}</span> de <span className="font-bold text-primary tabular-nums">{formatCurrency(confirmUpdateModal.oldPrice)}</span> à <span className="font-bold text-accent tabular-nums">{formatCurrency(confirmUpdateModal.newPrice)}</span>.
            </p>
            <div className="bg-base/50 border border-[var(--elevation-border)] rounded-xl p-4 mb-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked className="mt-1 w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent" />
                <span className="text-sm text-primary font-medium">
                  Mettre à jour automatiquement les prix dans les devis et factures existants (brouillons) contenant cet article.
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-4">
              <button 
                onClick={() => setConfirmUpdateModal(prev => ({ ...prev, isOpen: false }))} 
                className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors"
              >
                Annuler
              </button>
              <button 
                onClick={() => {
                  setCatalogData(prev => ({
                    ...prev,
                    [confirmUpdateModal.itemType]: prev[confirmUpdateModal.itemType].map(item => 
                      item.id === confirmUpdateModal.itemId ? { ...item, sellingPrice: confirmUpdateModal.newPrice } : item
                    )
                  }));
                  setConfirmUpdateModal(prev => ({ ...prev, isOpen: false }));
                }}
                className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Material Modal */}
      {isNewMaterialModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="kompagnon-card w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-300">
            <button onClick={() => setIsNewMaterialModalOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold text-primary mb-6">Nouveau Matériau</h2>
            
            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setIsNewMaterialModalOpen(false); }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Référence interne</label>
                  <input type="text" placeholder="ex: AC-S235-2MM" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Désignation</label>
                  <input type="text" placeholder="ex: Tôle Acier S235" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Épaisseur (mm)</label>
                  <input type="number" step="0.1" placeholder="ex: 2" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Format standard (mm)</label>
                  <input type="text" placeholder="ex: 3000x1500" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Coût d'achat (HT)</label>
                  <div className="relative">
                    <input type="number" step="0.01" placeholder="0.00" className="w-full pl-4 pr-12 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Marge cible (%)</label>
                  <div className="relative">
                    <input type="number" placeholder="30" className="w-full pl-4 pr-12 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">%</span>
                  </div>
                </div>
              </div>
              <div className="pt-6 flex justify-end gap-4">
                <button type="button" onClick={() => setIsNewMaterialModalOpen(false)} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">
                  Annuler
                </button>
                <button type="submit" className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
                  Créer le matériau
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Operation Modal */}
      {isNewOperationModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="kompagnon-card w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-300">
            <button onClick={() => setIsNewOperationModalOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold text-primary mb-6">Nouvelle Opération</h2>
            
            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setIsNewOperationModalOpen(false); }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Type</label>
                  <select className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all appearance-none">
                    <option>Humain</option>
                    <option>Machine</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Nom de l'opération</label>
                  <input type="text" placeholder="ex: Pliage CN" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Taux horaire de revient</label>
                  <div className="relative">
                    <input type="number" step="0.01" placeholder="0.00" className="w-full pl-4 pr-12 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€/h</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Taux horaire de vente</label>
                  <div className="relative">
                    <input type="number" step="0.01" placeholder="0.00" className="w-full pl-4 pr-12 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" required />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€/h</span>
                  </div>
                </div>
              </div>
              <div className="pt-6 flex justify-end gap-4">
                <button type="button" onClick={() => setIsNewOperationModalOpen(false)} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">
                  Annuler
                </button>
                <button type="submit" className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
                  Créer l'opération
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <h1 className="text-4xl font-bold text-primary">Catalogue & Tarifs</h1>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-secondary" />
            <input 
              type="text" 
              placeholder="Rechercher un article..." 
              value={searchTerm || ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-80 pl-12 pr-4 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
            />
          </div>
          <button 
            onClick={() => activeTab === 'materials' ? setIsNewMaterialModalOpen(true) : setIsNewOperationModalOpen(true)}
            className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'materials' ? 'Nouveau Matériau' : 'Nouvelle Opération'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)]">
        <button 
          onClick={() => setActiveTab('materials')}
          className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'materials' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
        >
          Matériaux & Fournitures
        </button>
        <button 
          onClick={() => setActiveTab('labor')}
          className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'labor' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
        >
          Main d'œuvre (Taux horaires)
        </button>
      </div>

      {/* Table */}
      <div className="kompagnon-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-base/30 border-b border-[var(--elevation-border)]">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Référence</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Désignation</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Catégorie</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Prix d'achat HT</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Marge (%)</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Prix de vente HT</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {filteredData.length > 0 ? (
                filteredData.map((item) => (
                  <tr key={item.id} className="hover:bg-accent/5 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-primary tabular-nums">{item.ref}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-primary font-medium">{item.name}</p>
                    </td>
                    <td className="px-6 py-4">
                      {getCategoryBadge(item.category)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm text-secondary tabular-nums">{formatCurrency(item.purchasePrice)}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="px-2 py-1 rounded-md bg-base/50 text-xs font-bold text-secondary tabular-nums border border-[var(--elevation-border)]">
                        {item.margin}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {editingPriceId === item.id ? (
                        <div className="flex justify-end">
                          <input 
                            type="number" 
                            value={editingPriceValue}
                            onChange={(e) => setEditingPriceValue(e.target.value)}
                            autoFocus
                            onBlur={(e) => handlePriceChange(e, item, activeTab)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              } else if (e.key === 'Escape') {
                                setEditingPriceId(null);
                              }
                            }}
                            className="w-24 p-1 text-right bg-base border border-accent rounded-md text-primary font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50"
                          />
                        </div>
                      ) : (
                        <p 
                          onClick={() => {
                            setEditingPriceId(item.id);
                            setEditingPriceValue(item.sellingPrice.toString());
                          }}
                          className="text-sm font-bold text-primary tabular-nums cursor-pointer hover:text-accent transition-colors px-2 py-1 -mr-2 rounded-md hover:bg-accent/10 inline-block"
                          title="Cliquez pour modifier"
                        >
                          {formatCurrency(item.sellingPrice)}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <ActionMenu 
                          actions={[
                            { label: 'Éditer', icon: <Edit2 className="w-4 h-4" />, onClick: () => {} },
                            { label: 'Supprimer', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => {} }
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-20 h-20 rounded-full bg-base flex items-center justify-center">
                        <Package className="w-10 h-10 text-secondary opacity-20" />
                      </div>
                      <div>
                        <p className="text-xl font-bold text-primary">Aucun article trouvé</p>
                        <p className="text-secondary">Essayez de modifier vos critères de recherche.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
};

const RemindersPage = ({ setCurrentPage }: { setCurrentPage: (page: string) => void }) => {
  const [invoices, setInvoices] = useState([
    { id: 1, type: 'invoice', client: 'AéroTech', number: 'F-2023-089', amount: 45000, daysOverdue: 15, status: 'En retard' },
    { id: 2, type: 'invoice', client: 'Automotive Parts BZH', number: 'F-2023-092', amount: 12500, daysOverdue: 5, status: 'En retard' },
    { id: 3, type: 'invoice', client: 'AgriMachinerie', number: 'F-2023-085', amount: 8500, daysOverdue: 22, status: 'En retard' },
  ]);

  const [quotes, setQuotes] = useState([
    { id: 4, type: 'quote', client: 'Construction Métallique Dupon', number: 'D-2023-145', amount: 124000, daysPending: 12, status: 'En attente' },
    { id: 5, type: 'quote', client: 'Naval Group Sous-Traitance', number: 'D-2023-148', amount: 85000, daysPending: 8, status: 'En attente' },
  ]);

  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleSendReminder = (id: number, type: 'invoice' | 'quote') => {
    setLoadingId(id);
    setTimeout(() => {
      if (type === 'invoice') {
        setInvoices(invoices.filter(inv => inv.id !== id));
      } else {
        setQuotes(quotes.filter(q => q.id !== id));
      }
      setLoadingId(null);
    }, 1000);
  };

  const handleMarkAsDone = (id: number, type: 'invoice' | 'quote') => {
    if (type === 'invoice') {
      setInvoices(invoices.filter(inv => inv.id !== id));
    } else {
      setQuotes(quotes.filter(q => q.id !== id));
    }
  };

  const totalOverdue = invoices.reduce((acc, inv) => acc + inv.amount, 0);
  const totalPending = quotes.reduce((acc, q) => acc + q.amount, 0);

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      {/* Header & KPI */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <h1 className="text-4xl font-bold text-primary">Centre de Relances</h1>
        
        <button 
          onClick={() => setCurrentPage('settings')}
          className="px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all"
        >
          <Settings className="w-4 h-4" />
          Configurer les relances automatiques
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="kompagnon-card p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-bl-full -mr-8 -mt-8"></div>
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
            <Flame className="w-4 h-4 text-red-500" />
            Factures en retard
          </span>
          <span className="text-4xl font-bold text-red-500 tabular-nums">{formatCurrency(totalOverdue)}</span>
          <span className="text-sm text-secondary mt-2">{invoices.length} factures à relancer</span>
        </div>
        <div className="kompagnon-card p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full -mr-8 -mt-8"></div>
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-accent" />
            Devis sans réponse
          </span>
          <span className="text-4xl font-bold text-accent tabular-nums">{formatCurrency(totalPending)}</span>
          <span className="text-sm text-secondary mt-2">{quotes.length} devis en attente</span>
        </div>
      </div>

      {/* Liste des actions requises */}
      <div className="kompagnon-card overflow-hidden flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-[var(--elevation-border)]">
        
        {/* Urgences (Factures) */}
        <div className="flex-1 p-8 space-y-6">
          <h2 className="text-xl font-bold text-primary flex items-center gap-2 mb-6">
            <Flame className="w-5 h-5 text-red-500" />
            Urgences (Factures)
          </h2>
          
          <div className="space-y-4">
            {invoices.length > 0 ? invoices.map((invoice) => (
              <div key={invoice.id} className="p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)] flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 hover:border-red-500/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">{invoice.client}</span>
                    <span className="text-sm text-secondary px-2 py-0.5 rounded-md bg-surface border border-[var(--elevation-border)]">{invoice.number}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-primary tabular-nums">{formatCurrency(invoice.amount)}</span>
                    <span className="text-red-500 font-medium">Dépassé de {invoice.daysOverdue} jours</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 w-full xl:w-auto">
                  <button 
                    onClick={() => handleMarkAsDone(invoice.id, 'invoice')}
                    className="p-2 rounded-full text-secondary hover:text-accent-green hover:bg-accent-green/10 transition-colors"
                    title="Marquer comme payé"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleSendReminder(invoice.id, 'invoice')}
                    disabled={loadingId === invoice.id}
                    className="flex-1 xl:flex-none px-4 py-2 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all disabled:opacity-70 disabled:hover:scale-100"
                  >
                    {loadingId === invoice.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Envoyer Relance
                      </>
                    )}
                  </button>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 text-secondary">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Aucune facture en retard.</p>
              </div>
            )}
          </div>
        </div>

        {/* En attente (Devis) */}
        <div className="flex-1 p-8 space-y-6">
          <h2 className="text-xl font-bold text-primary flex items-center gap-2 mb-6">
            <Hourglass className="w-5 h-5 text-accent" />
            En attente (Devis)
          </h2>
          
          <div className="space-y-4">
            {quotes.length > 0 ? quotes.map((quote) => (
              <div key={quote.id} className="p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)] flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 hover:border-accent/30 transition-colors">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">{quote.client}</span>
                    <span className="text-sm text-secondary px-2 py-0.5 rounded-md bg-surface border border-[var(--elevation-border)]">{quote.number}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-primary tabular-nums">{formatCurrency(quote.amount)}</span>
                    <span className="text-accent font-medium">En attente depuis {quote.daysPending} jours</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 w-full xl:w-auto">
                  <button 
                    onClick={() => handleMarkAsDone(quote.id, 'quote')}
                    className="p-2 rounded-full text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Marquer comme refusé"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleMarkAsDone(quote.id, 'quote')}
                    className="p-2 rounded-full text-secondary hover:text-accent-green hover:bg-accent-green/10 transition-colors"
                    title="Marquer comme accepté"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleSendReminder(quote.id, 'quote')}
                    disabled={loadingId === quote.id}
                    className="flex-1 xl:flex-none px-4 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-bold flex items-center justify-center gap-2 hover:bg-base transition-all disabled:opacity-70"
                  >
                    {loadingId === quote.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Relancer
                      </>
                    )}
                  </button>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 text-secondary">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>Aucun devis en attente.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
};

const SettingsPage = ({ userProfile, setUserProfile }: { userProfile: any, setUserProfile: any }) => {
  const [activeTab, setActiveTab] = useState('profil');
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [companyDetails, setCompanyDetails] = useState({
    name: "Martin BTP",
    siret: "123 456 789 00012",
    tva: "FR 12 123456789",
    address: "15 Rue de la Paix, 75000 Paris",
    email: "contact@martin-btp.fr",
    phone: "01 23 45 67 89"
  });

  const templates = [
    { id: 1, name: 'Envoi de Devis', subject: 'Votre devis {{numero_devis}}', content: 'Bonjour {{client_nom}},\n\nVeuillez trouver ci-joint notre devis {{numero_devis}} d\'un montant de {{montant_ttc}}.\n\nCordialement,\nL\'équipe {{entreprise_nom}}' },
    { id: 2, name: 'Envoi de Facture', subject: 'Votre facture {{numero_facture}}', content: 'Bonjour {{client_nom}},\n\nVeuillez trouver ci-joint notre facture {{numero_facture}} d\'un montant de {{montant_ttc}}.\n\nCordialement,\nL\'équipe {{entreprise_nom}}' },
    { id: 3, name: 'Relance Facture (Niveau 1 : Douce)', subject: 'Relance : Facture {{numero_facture}}', content: 'Bonjour {{client_nom}},\n\nSauf erreur de notre part, la facture {{numero_facture}} de {{montant_ttc}} arrivée à échéance le {{date_echeance}} reste impayée.\n\nMerci de régulariser la situation.\n\nCordialement,\nL\'équipe {{entreprise_nom}}' },
    { id: 4, name: 'Relance Facture (Niveau 2 : Ferme)', subject: 'Dernière Relance : Facture {{numero_facture}}', content: 'Bonjour {{client_nom}},\n\nMalgré notre précédente relance, la facture {{numero_facture}} d\'un montant de {{montant_ttc}} est toujours en attente de paiement.\n\nNous vous prions de procéder au règlement dans les plus brefs délais.\n\nCordialement,\nL\'équipe {{entreprise_nom}}' },
  ];

  const renderHighlightedText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, i) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return <span key={i} className="bg-accent/20 text-accent font-bold px-1 rounded">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const renderContent = () => {
    if (activeTab === 'profil') {
      return (
        <div className="kompagnon-card p-8 space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-primary mb-6">Mon Profil</h2>
            <div className="flex flex-col md:flex-row gap-8">
              {/* Avatar Dropzone */}
              <div className="flex-shrink-0">
                <div className="w-32 h-32 rounded-full bg-base border-2 border-dashed border-[var(--elevation-border)] flex flex-col items-center justify-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all group overflow-hidden relative">
                  <img src="https://picsum.photos/seed/kael/200/200" alt="Avatar" className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-20 transition-opacity" referrerPolicy="no-referrer" />
                  <Upload className="w-8 h-8 text-secondary group-hover:text-accent mb-2 relative z-10" />
                  <span className="text-xs text-secondary font-medium relative z-10">Avatar</span>
                </div>
              </div>
              
              {/* Profil Inputs */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Prénom</label>
                  <input type="text" value={userProfile.firstName || ''} onChange={e => setUserProfile({...userProfile, firstName: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Nom</label>
                  <input type="text" value={userProfile.lastName || ''} onChange={e => setUserProfile({...userProfile, lastName: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-secondary">Email</label>
                  <input type="email" value={userProfile.email || ''} onChange={e => setUserProfile({...userProfile, email: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                </div>
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-[var(--elevation-border)]"></div>

          <div>
            <h2 className="text-2xl font-bold text-primary mb-6">Sécurité</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Nouveau mot de passe</label>
                <input type="password" placeholder="••••••••" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Confirmer le mot de passe</label>
                <input type="password" placeholder="••••••••" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
              </div>
            </div>
          </div>

          <div className="pt-6 flex justify-end">
            <button className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
              Mettre à jour le profil
            </button>
          </div>
        </div>
      );
    }

    if (activeTab === 'entreprise') {
      return (
        <div className="kompagnon-card p-8 space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-primary mb-6">Identité de l'entreprise</h2>
            <div className="flex flex-col md:flex-row gap-8">
              {/* Logo Dropzone */}
              <div className="flex-shrink-0">
                <div className="w-32 h-32 rounded-full bg-base border-2 border-dashed border-[var(--elevation-border)] flex flex-col items-center justify-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all group">
                  <Upload className="w-8 h-8 text-secondary group-hover:text-accent mb-2" />
                  <span className="text-xs text-secondary font-medium">Logo</span>
                </div>
              </div>
              
              {/* Identité Inputs */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Nom de l'entreprise</label>
                  <input type="text" value={companyDetails.name} onChange={e => setCompanyDetails({...companyDetails, name: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">SIRET</label>
                  <input type="text" value={companyDetails.siret} onChange={e => setCompanyDetails({...companyDetails, siret: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-secondary">TVA Intracommunautaire</label>
                  <input type="text" value={companyDetails.tva} onChange={e => setCompanyDetails({...companyDetails, tva: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" />
                </div>
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-[var(--elevation-border)]"></div>

          <div>
            <h2 className="text-2xl font-bold text-primary mb-6">Coordonnées</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-semibold text-secondary">Adresse postale</label>
                <input type="text" value={companyDetails.address} onChange={e => setCompanyDetails({...companyDetails, address: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Email de contact</label>
                <input type="email" value={companyDetails.email} onChange={e => setCompanyDetails({...companyDetails, email: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Téléphone</label>
                <input type="tel" value={companyDetails.phone} onChange={e => setCompanyDetails({...companyDetails, phone: e.target.value})} className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all tabular-nums" />
              </div>
            </div>
          </div>

          <div className="pt-6 flex justify-end">
            <button className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
              Sauvegarder
            </button>
          </div>
        </div>
      );
    }

    if (activeTab === 'equipe') {
      return (
        <div className="kompagnon-card p-8 space-y-8 relative">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-primary">Membres de l'équipe</h2>
            <button 
              onClick={() => setIsInviteModalOpen(true)}
              className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
            >
              <Plus className="w-4 h-4" />
              Inviter un collaborateur
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--elevation-border)]">
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Membre</th>
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Rôle</th>
                  <th className="pb-4 text-sm font-bold text-secondary uppercase tracking-wider">Statut</th>
                  <th className="pb-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                <tr className="group">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">J</div>
                      <div>
                        <p className="font-bold text-primary">Jean Dupont</p>
                        <p className="text-xs text-secondary">jean@martin-btp.fr</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-500">Gérant</span>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500">Actif</span>
                  </td>
                  <td className="py-4 text-right">
                    <ActionMenu 
                      actions={[
                        { label: 'Modifier le rôle', icon: <Edit2 className="w-4 h-4" />, onClick: () => {} },
                        { label: 'Retirer l\'accès', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => {} }
                      ]}
                    />
                  </td>
                </tr>
                <tr className="group">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-500 font-bold">S</div>
                      <div>
                        <p className="font-bold text-primary">Sophie Martin</p>
                        <p className="text-xs text-secondary">sophie@martin-btp.fr</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500">Comptable</span>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500">Actif</span>
                  </td>
                  <td className="py-4 text-right">
                    <ActionMenu 
                      actions={[
                        { label: 'Modifier le rôle', icon: <Edit2 className="w-4 h-4" />, onClick: () => {} },
                        { label: 'Retirer l\'accès', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => {} }
                      ]}
                    />
                  </td>
                </tr>
                <tr className="group">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 font-bold">M</div>
                      <div>
                        <p className="font-bold text-primary">Marc Dubois</p>
                        <p className="text-xs text-secondary">marc@martin-btp.fr</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-orange-500/10 text-orange-500">Atelier</span>
                  </td>
                  <td className="py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500">Actif</span>
                  </td>
                  <td className="py-4 text-right">
                    <ActionMenu 
                      actions={[
                        { label: 'Renvoyer l\'invitation', icon: <Mail className="w-4 h-4" />, onClick: () => {} },
                        { label: 'Annuler l\'invitation', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => {} }
                      ]}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Invite Modal */}
          {isInviteModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="kompagnon-card w-full max-w-md p-8 relative animate-in fade-in zoom-in duration-300">
                <button onClick={() => setIsInviteModalOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors">
                  <X className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-bold text-primary mb-6">Inviter un collaborateur</h2>
                
                <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setIsInviteModalOpen(false); }}>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-secondary">Email du collaborateur</label>
                    <input type="email" placeholder="email@entreprise.fr" className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all" required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-secondary">Rôle</label>
                    <select className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all appearance-none" required>
                      <option value="admin">Admin / Gérant</option>
                      <option value="be">Bureau d'étude</option>
                      <option value="atelier">Atelier</option>
                      <option value="compta">Comptabilité</option>
                    </select>
                  </div>
                  <div className="pt-6 flex justify-end gap-4">
                    <button type="button" onClick={() => setIsInviteModalOpen(false)} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">
                      Annuler
                    </button>
                    <button type="submit" className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
                      Envoyer l'invitation
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (activeTab === 'emails') {
      const activeTemplate = templates.find(t => t.id === selectedTemplate);

      return (
        <div className="kompagnon-card p-8 flex flex-col md:flex-row gap-8 min-h-[600px]">
          {/* Liste des templates */}
          <div className="w-full md:w-1/3 space-y-4 border-r border-[var(--elevation-border)] pr-8">
            <h2 className="text-xl font-bold text-primary mb-6">Modèles</h2>
            {templates.map(template => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplate(template.id)}
                className={`w-full text-left p-4 rounded-xl transition-all ${selectedTemplate === template.id ? 'bg-accent/10 border border-accent/30' : 'bg-base hover:bg-surface border border-transparent'}`}
              >
                <p className={`font-semibold ${selectedTemplate === template.id ? 'text-accent' : 'text-primary'}`}>{template.name}</p>
                <p className="text-xs text-secondary mt-1 truncate">{template.subject}</p>
              </button>
            ))}
          </div>

          {/* Editeur */}
          <div className="flex-1 flex flex-col">
            {activeTemplate ? (
              <div className="space-y-6 flex-1 flex flex-col">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Sujet de l'email</label>
                  <div className="w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent rounded-xl text-primary font-mono text-sm">
                    {renderHighlightedText(activeTemplate.subject)}
                  </div>
                </div>
                <div className="space-y-2 flex-1 flex flex-col">
                  <label className="text-sm font-semibold text-secondary flex justify-between">
                    <span>Corps du message (Aperçu)</span>
                    <span className="text-xs text-accent">Variables: {'{{client_nom}}'}, {'{{montant_ttc}}'}...</span>
                  </label>
                  <div className="w-full flex-1 min-h-[300px] px-4 py-3 bg-base dark:bg-white/5 border border-transparent rounded-xl text-primary leading-relaxed font-mono text-sm whitespace-pre-wrap overflow-y-auto">
                    {renderHighlightedText(activeTemplate.content)}
                  </div>
                </div>
                <div className="pt-4 flex justify-end">
                  <button className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
                    Modifier le modèle
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-secondary">
                <Mail className="w-12 h-12 mb-4 opacity-20" />
                <p>Sélectionnez un modèle pour le visualiser</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-bold text-primary">Paramètres</h1>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Interne */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-2">
          <button 
            onClick={() => setActiveTab('profil')}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'profil' ? 'bg-surface shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}
          >
            <UserCircle className="w-5 h-5" />
            Profil
          </button>
          <button 
            onClick={() => setActiveTab('entreprise')}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'entreprise' ? 'bg-surface shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}
          >
            <Building className="w-5 h-5" />
            Entreprise
          </button>
          <button 
            onClick={() => setActiveTab('equipe')}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'equipe' ? 'bg-surface shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}
          >
            <Users className="w-5 h-5" />
            Équipe
          </button>
          <button 
            onClick={() => setActiveTab('emails')}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold transition-all flex items-center gap-3 ${activeTab === 'emails' ? 'bg-surface shadow-sm text-primary border border-[var(--elevation-border)]' : 'text-secondary hover:bg-base hover:text-primary'}`}
          >
            <Mail className="w-5 h-5" />
            Modèles d'emails
          </button>
        </div>

        {/* Contenu */}
        <div className="flex-1">
          {renderContent()}
        </div>
      </div>
    </main>
  );
};

const LoginPage = ({ setCurrentPage }: { setCurrentPage: (page: string) => void }) => {
  const [email, setEmail] = useState("contact@martin-btp.fr");
  const [password, setPassword] = useState("password123");

  return (
    <div className="fixed inset-0 z-[100] flex flex-col lg:flex-row bg-[#050505] text-white overflow-hidden font-sans">
      {/* Panneau Gauche - Branding */}
      <div className="relative flex-1 flex flex-col justify-between p-12 lg:p-24 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
        
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center shadow-lg shadow-accent/20">
            <Rocket className="w-7 h-7 text-black" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Kompagnon</h1>
        </div>

        <div className="relative z-10 mt-20 lg:mt-0">
          <h2 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight font-display">
            L'ERP qui<br />comprend<br />votre métier.
          </h2>
          <p className="mt-6 text-lg text-white/60 max-w-md">
            Gérez vos chantiers, vos finances et vos clients avec une intelligence artificielle intégrée.
          </p>
        </div>

        <div className="relative z-10 text-sm text-white/40">
          &copy; 2024 Kompagnon. Tous droits réservés.
        </div>
      </div>

      {/* Panneau Droit - Formulaire */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-24 relative z-10 bg-[#050505]">
        <div className="w-full max-w-md bg-white/5 backdrop-blur-[40px] border border-white/10 rounded-3xl p-10 shadow-2xl">
          <h3 className="text-3xl font-bold text-white mb-2">Connexion à votre espace</h3>
          <p className="text-white/60 mb-8">Entrez vos identifiants pour accéder à votre tableau de bord.</p>

          <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setCurrentPage('dashboard'); }}>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-white/80">Email professionnel</label>
              <input 
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-white outline-none transition-all placeholder:text-white/30"
                placeholder="vous@entreprise.fr"
                required
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-white/80">Mot de passe</label>
                <a href="#" className="text-xs text-white/60 hover:text-white transition-colors">Mot de passe oublié ?</a>
              </div>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-white outline-none transition-all placeholder:text-white/30"
                placeholder="••••••••"
                required
              />
            </div>

            <button 
              type="submit"
              className="w-full py-4 mt-4 rounded-full bg-accent text-black font-bold text-lg hover:scale-[1.02] transition-all shadow-lg shadow-accent/20"
            >
              Se connecter
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [currentPage, setCurrentPage] = useState('login');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState({ firstName: 'Kael', lastName: 'Ardent', email: 'kael@kompagnon.fr' });
  const [editingQuote, setEditingQuote] = useState<any>(null);

  return (
    <div className="font-display bg-base min-h-screen transition-colors duration-300 ease-out">
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="liquid-glow absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent rounded-full"></div>
        <div className="liquid-glow absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-accent-green rounded-full"></div>
      </div>
      
      <div className="relative z-10 flex flex-col min-h-screen">
        {currentPage !== 'login' && <Header currentPage={currentPage} setCurrentPage={setCurrentPage} />}
        
        {currentPage === 'login' ? <LoginPage setCurrentPage={setCurrentPage} /> :
         currentPage === 'dashboard' ? <Dashboard userProfile={userProfile} /> : 
         currentPage === 'clients' ? <ClientsPage setCurrentPage={setCurrentPage} setSelectedClientId={setSelectedClientId} /> : 
         currentPage === 'client-profile' ? <ClientProfilePage setCurrentPage={setCurrentPage} clientId={selectedClientId} /> :
         currentPage === 'finances' ? <FinancesPage setCurrentPage={setCurrentPage} /> :
         currentPage === 'quote-editor' ? <QuoteEditorPage setCurrentPage={setCurrentPage} editingQuote={editingQuote} /> :
         currentPage === 'invoice-editor' ? <InvoiceEditorPage setCurrentPage={setCurrentPage} /> :
         currentPage === 'catalog' ? <CatalogPage /> :
         currentPage === 'reminders' ? <RemindersPage setCurrentPage={setCurrentPage} /> :
         currentPage === 'settings' ? <SettingsPage userProfile={userProfile} setUserProfile={setUserProfile} /> :
         <AIPage setCurrentPage={setCurrentPage} setEditingQuote={setEditingQuote} />}
        
        {currentPage !== 'login' && <Footer />}
      </div>
    </div>
  );
}
