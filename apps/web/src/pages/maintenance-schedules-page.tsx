import { useQuery } from "@tanstack/react-query";

import { fetchAssets } from "../api/assets";
import { MaintenanceSchedulesPanel } from "../components/maintenance-schedules-panel";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type MaintenanceSchedulesPageProps = {
  user: AuthUser;
};

/** Dedicated Operations screen for schedule generation and management. */
export function MaintenanceSchedulesPage({
  user,
}: MaintenanceSchedulesPageProps) {
  const assetsQ = useQuery({
    queryKey: ["assets", "list"],
    queryFn: () => fetchAssets(),
  });

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Operations · Maintenance schedules · generate work orders into Kanban
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Operations"
          title="Maintenance Schedule Centre"
          subtitle="PM · predictive · condition · compliance · AMC · calibration · outage"
          actions={<StatusPill label="Generates WOs" />}
        />

        {assetsQ.isLoading ? (
          <p className="text-sm text-bms-muted">Loading assets...</p>
        ) : assetsQ.isError ? (
          <p className="text-sm text-red-600">Could not load assets.</p>
        ) : (
          <MaintenanceSchedulesPanel assetOptions={assetsQ.data ?? []} />
        )}
      </div>
    </AppShell>
  );
}
