import { Topbar } from '@/components/layout/Topbar';
import { Footer } from '@/components/layout/Footer';
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import { getOrganization } from '@/lib/data/queries/organization';
import { getCurrentOrganizationId } from '@/lib/data/queries/clients';
import { createClient } from '@/lib/supabase/server';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';

async function getNotificationsData(): Promise<{ overdueInvoices: number; expiringQuotes: number; newRequests: number }> {
    const supabase = await createClient();
    const orgId = await getCurrentOrganizationId();
    if (!orgId) return { overdueInvoices: 0, expiringQuotes: 0, newRequests: 0 };

    const today = new Date().toISOString().split('T')[0];
    const in3days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [{ count: overdueInvoices }, { count: expiringQuotes }, { count: newRequests }] = await Promise.all([
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
    ]);

    return { overdueInvoices: overdueInvoices ?? 0, expiringQuotes: expiringQuotes ?? 0, newRequests: newRequests ?? 0 };
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
                <div className="grow">
                    {children}
                </div>
                <Footer orgName={org?.name ?? null} />
            </div>
        </>
    );
}
