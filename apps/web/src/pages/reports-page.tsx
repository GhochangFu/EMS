import { ReportsPanel } from "../components/reports-panel";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type ReportsPageProps = {
  user: AuthUser;
};

/** Reports & Analytics screen — energy report preview, export and history (`F3.5a`). */
export function ReportsPage({ user }: ReportsPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Operations · Reports & Analytics · Energy report preview, export and history
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.rp"
          title="Reports & Analytics"
          subtitle="One-click generation · Energy Consumption PDF · XLSX · CSV · saved report history"
          actions={<StatusPill label="PDF · XLSX · CSV Active" />}
        />

        <ReportsPanel user={user} />
      </div>
    </AppShell>
  );
}
