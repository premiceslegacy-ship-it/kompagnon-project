import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClientById } from '@/lib/data/queries/clients';
import { getClientQuotes } from '@/lib/data/queries/quotes';
import { getClientInvoices } from '@/lib/data/queries/invoices';
import { ClientActions } from './ClientActions';
import { HistoriqueClient } from './HistoriqueClient';
import { AddressLink } from '@/components/shared/AddressLink';
import {
    ArrowLeft,
    FileText,
    Building,
    Mail,
    Phone,
    Bot,
    User,
} from 'lucide-react';

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);

const cardClasses = "rounded-3xl card transition-all duration-300 ease-out";

export default async function ClientProfilePage({ params }: { params: { id: string } }) {
    const [client, quotes, invoices] = await Promise.all([
        getClientById(params.id),
        getClientQuotes(params.id),
        getClientInvoices(params.id),
    ]);

    if (!client) {
        notFound();
    }

    const documents = [
        ...quotes.map(q => ({ type: 'quote' as const, id: q.id, number: q.number, title: q.title, status: q.status, total_ttc: q.total_ttc, created_at: q.created_at, signed_at: q.signed_at })),
        ...invoices.map(inv => ({ type: 'invoice' as const, id: inv.id, number: inv.number, title: inv.title, status: inv.status, total_ttc: inv.total_ttc, created_at: inv.created_at, signed_at: null })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    const displayName = client.company_name
        || [client.first_name, client.last_name].filter(Boolean).join(' ')
        || 'Client sans nom';

    return (
        <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
            {/* Back */}
            <Link href="/clients" className="flex items-center gap-2 text-secondary hover:text-primary transition-colors font-medium text-sm">
                <ArrowLeft className="w-4 h-4" />
                Retour aux clients
            </Link>

            {/* Header Hero */}
            <div className={`${cardClasses} p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6`}>
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0">
                            {client.type === 'company'
                                ? <Building className="w-5 h-5 text-accent" />
                                : <User className="w-5 h-5 text-accent" />
                            }
                        </div>
                        <h1 className="text-3xl font-bold text-primary leading-none">{displayName}</h1>
                        {client.status && (
                            <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase tracking-wider ${
                                client.status === 'active' ? 'bg-accent-green/10 text-accent-green' :
                                client.status === 'prospect' ? 'bg-accent/10 text-accent' :
                                'bg-secondary/10 text-secondary'
                            }`}>{
                                client.status === 'active' ? 'Actif' :
                                client.status === 'prospect' ? 'Prospect' :
                                client.status === 'inactive' ? 'Inactif' : client.status
                            }</span>
                        )}
                    </div>
                    {client.company_name && client.contact_name && (
                        <p className="text-secondary text-sm">
                            Contact référent : <span className="font-semibold text-primary">{client.contact_name}</span>
                        </p>
                    )}
                    <div className="flex flex-wrap items-center gap-6 text-secondary text-sm">
                        {client.siret && (
                            <span className="flex items-center gap-2"><Building className="w-4 h-4" /> SIRET: {client.siret}</span>
                        )}
                        {client.email && (
                            <a href={`mailto:${client.email}`} className="flex items-center gap-2 hover:text-accent transition-colors">
                                <Mail className="w-4 h-4" /> {client.email}
                            </a>
                        )}
                        {client.phone && (
                            <a href={`tel:${client.phone}`} className="flex items-center gap-2 hover:text-accent transition-colors">
                                <Phone className="w-4 h-4" /> {client.phone}
                            </a>
                        )}
                        <AddressLink
                            address_line1={client.address_line1}
                            postal_code={client.postal_code}
                            city={client.city}
                            className="text-secondary"
                            textClassName="text-secondary hover:text-accent"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-3 w-full lg:w-auto">
                    <ClientActions client={client} />
                    <Link
                        href={`/finances/quote-editor?client=${client.id}`}
                        className="flex-1 lg:flex-none px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
                    >
                        <Bot className="w-4 h-4" /> Nouveau devis
                    </Link>
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`${cardClasses} p-6 flex flex-col gap-2`}>
                    <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Chiffre d&apos;Affaires</span>
                    <span className="text-3xl font-bold text-primary tabular-nums">{formatCurrency(client.total_revenue ?? 0)}</span>
                </div>
                <div className={`${cardClasses} p-6 flex flex-col gap-2`}>
                    <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Conditions de paiement</span>
                    <span className="text-3xl font-bold text-primary tabular-nums">{client.payment_terms_days ?? 30} jours</span>
                </div>
                <div className={`${cardClasses} p-6 flex flex-col gap-2`}>
                    <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Client depuis</span>
                    <span className="text-xl font-bold text-primary">
                        {new Date(client.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                </div>
            </div>

            {/* Historique Financier */}
            <div className={`${cardClasses} overflow-hidden`}>
                <div className="flex items-center justify-between px-8 pt-6 pb-4 border-b border-[var(--elevation-border)]">
                    <div className="text-sm font-bold border-b-2 border-accent text-primary pb-1">
                        Historique Financier
                    </div>
                    <span className="text-xs text-secondary">{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
                </div>
                {documents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center min-h-[240px]">
                        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
                            <FileText className="w-6 h-6 text-accent" />
                        </div>
                        <p className="font-bold text-primary mb-1">Aucun document pour l&apos;instant</p>
                        <p className="text-sm text-secondary max-w-sm">Les devis et factures associés à ce client apparaîtront ici automatiquement.</p>
                        <Link
                            href={`/finances/quote-editor?client=${client.id}`}
                            className="mt-6 px-6 py-2.5 rounded-full bg-accent text-black font-bold text-sm hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2"
                        >
                            <Bot className="w-4 h-4" />Créer un devis
                        </Link>
                    </div>
                ) : (
                    <HistoriqueClient initialDocuments={documents} />
                )}
            </div>
        </main>
    );
}
