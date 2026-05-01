import { ReportsPanel } from "../components/reports-panel";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type ReportsPageProps = {
  user: AuthUser;
};

/** Reports & Analytics screen for Phase 5 Sprint E energy CSV reports. */
export function ReportsPage({ user }: ReportsPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Operations · Reports & Analytics · Energy CSV preview/export
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.rp"
          title="Reports & Analytics"
          subtitle="One-click generation · Energy Consumption CSV · preview/export only"
          actions={<StatusPill label="CSV Active" />}
        />

        <ReportsPanel />
      </div>
    </AppShell>
  );
}
