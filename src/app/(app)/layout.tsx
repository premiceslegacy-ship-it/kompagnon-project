import { Footer } from '@/components/layout/Footer';
import NextTopLoader from 'nextjs-toploader';
import { getCurrentUserProfile } from '@/lib/data/queries/user';
import { getOrganizationShell } from '@/lib/data/queries/organization';
import { getOrganizationModules } from '@/lib/data/queries/organization-modules';
import { getCurrentMembershipContext, getUserPermissions } from '@/lib/data/queries/membership';
import { AppShell } from '@/components/layout/AppShell';

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
            <NextTopLoader color="var(--accent)" showSpinner={false} height={3} />
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="liquid-glow absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent rounded-full"></div>
                <div className="liquid-glow absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-accent-green rounded-full"></div>
            </div>
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
            </div>
        </>
    );
}
