import { Topbar } from '@/components/layout/Topbar';
import { Footer } from '@/components/layout/Footer';
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import { getOrganization } from '@/lib/data/queries/organization';
import { getCurrentOrganizationId } from '@/lib/data/queries/clients';
import { createClient } from '@/lib/supabase/server';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';

async function getNotificationsData(): Promise<{ overdueInvoices: number; expiringQuotes: number; newRequests: number; decennaleExpiringDays: number | null; chantiersAtRisk: number }> {
    const supabase = await createClient();
    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { overdueInvoices: 0, expiringQuotes: 0, newRequests: 0, decennaleExpiringDays: null, chantiersAtRisk: 0 };

    const { todayParis, dateParis } = await import('@/lib/utils')
    const today = todayParis();
    const in3days = dateParis(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const [{ count: overdueInvoices }, { count: expiringQuotes }, { count: newRequests }, { data: orgDecennale }] = await Promise.all([
        supabase
            .from('invoices')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('status', 'sent')
            .lt('due_date', today),
        supabase
            .from('quotes')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .in('status', ['sent', 'viewed'])
            .gte('valid_until', today)
            .lte('valid_until', in3days),
        supabase
            .from('quote_requests')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('status', 'new'),
        supabase
            .from('organizations')
            .select('decennale_enabled, decennale_date_fin')
            .eq('id', orgId)
            .single(),
    ]);

    let decennaleExpiringDays: number | null = null;
    if (orgDecennale?.decennale_enabled && orgDecennale?.decennale_date_fin) {
        const daysLeft = Math.ceil((new Date(orgDecennale.decennale_date_fin).getTime() - Date.now()) / 86400000);
        if (daysLeft <= 60) decennaleExpiringDays = daysLeft;
    }

    return { overdueInvoices: overdueInvoices ?? 0, expiringQuotes: expiringQuotes ?? 0, newRequests: newRequests ?? 0, decennaleExpiringDays, chantiersAtRisk: 0 };
}

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [profile, org, notifications, modules] = await Promise.all([
        getCurrentUserProfile(),
        getOrganization(),
        getNotificationsData(),
        getOrganizationModules(),
    ]);

    return (
        <>
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="liquid-glow absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent rounded-full"></div>
                <div className="liquid-glow absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-accent-green rounded-full"></div>
            </div>
            <div className="relative z-10 flex flex-col min-h-screen">
                <Topbar
                    profile={profile}
                    orgName={org?.name ?? null}
                    logoUrl={org?.logo_url ?? null}
                    notifications={notifications}
                    modules={modules}
                />
                {notifications.decennaleExpiringDays !== null && (
                    <div className={`w-full px-6 py-2.5 text-center text-sm font-semibold ${notifications.decennaleExpiringDays < 0 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'}`}>
                        {notifications.decennaleExpiringDays < 0
                            ? `⚠ Votre garantie décennale a expiré il y a ${Math.abs(notifications.decennaleExpiringDays)} jour${Math.abs(notifications.decennaleExpiringDays) > 1 ? 's' : ''} — renouvelez-la d'urgence dans les Réglages.`
                            : `⚠ Votre garantie décennale expire dans ${notifications.decennaleExpiringDays} jour${notifications.decennaleExpiringDays > 1 ? 's' : ''} — pensez au renouvellement (Réglages).`
                        }
                    </div>
                )}
                <div className="grow">
                    {children}
                </div>
                <Footer orgName={org?.name ?? null} />
            </div>
        </>
    );
}
