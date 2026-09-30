import { Link } from "react-router-dom";

import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { AppShell } from "../../layouts/app-shell";
import { visibleMasterDataAreas } from "../../lib/admin-access";
import type { AuthUser } from "../../stores/auth-store";

type AdminHubPageProps = {
  user: AuthUser;
};

/**
 * The Master Data Hub landing page (`F3.76`): one card for each area the role
 * sees, with a link to each of the area's screens. It replaced a redirect to
 * `defaultAdminRoute`.
 */
export function AdminHubPage({ user }: AdminHubPageProps) {
  const areas = visibleMasterDataAreas(user.role);

  return (
    <AppShell
      user={user}
      kpiRibbon={<span className="text-ink">Administration · Master Data Hub</span>}
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Administration"
          title="Master Data Hub"
          subtitle="Choose an area. Each link opens its screen."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {areas.map((area) => (
            <SectionCard
              key={area.id}
              title={area.label}
              subtitle={area.description}
              className="h-full"
            >
              <ul aria-label={area.label} className="space-y-1.5">
                {area.tabs.map((tab) => (
                  <li key={tab.path}>
                    <Link
                      to={tab.path}
                      className="text-sm font-semibold text-accent-strong hover:underline"
                    >
                      {tab.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
