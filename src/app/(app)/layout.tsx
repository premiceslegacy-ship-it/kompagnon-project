import { Footer } from '@/components/layout/Footer';
import NextTopLoader from 'nextjs-toploader';
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import { getOrganizationShell } from '@/lib/data/queries/organization';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';
import { getCurrentMembershipContext, getUserPermissions } from '@/lib/data/queries/membership';
import { AppShell } from '@/components/layout/AppShell';
import { PushEnableBanner } from '@/components/layout/PushEnableBanner';

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [profile, org, modules, permissions, membership] = await Promise.all([
        getCurrentUserProfile(),
        getOrganizationShell(),
        getOrganizationModules(),
        getUserPermissions(),
        getCurrentMembershipContext(),
    ]);

    return (
        <>
            <NextTopLoader color="var(--at-accent, var(--accent))" showSpinner={false} height={3} />
            <div className="relative z-10 flex flex-col min-h-screen">
                <AppShell
                    profile={profile}
                    orgName={org?.name ?? null}
                    logoUrl={org?.logo_url ?? null}
                    modules={modules}
                    permissionKeys={[...permissions]}
                    currentRoleSlug={membership?.roleSlug ?? null}
                >
                    {children}
                </AppShell>
                <Footer orgName={org?.name ?? null} />
                <PushEnableBanner />
            </div>
        </>
    );
}
