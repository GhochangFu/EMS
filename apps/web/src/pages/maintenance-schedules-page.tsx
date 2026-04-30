import { useQuery } from "@tanstack/react-query";

import { fetchAssets } from "../api/assets";
import { MaintenanceSchedulesPanel } from "../components/maintenance-schedules-panel";
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
    queryFn: fetchAssets,
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
        <header className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Maintenance Schedule Centre
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              PM · predictive · condition · compliance · AMC · calibration ·
              outage
            </p>
          </div>
          <div className="rounded border border-bms-green/20 bg-bms-green/10 px-3 py-2 text-xs font-semibold text-bms-green">
            Generated WOs appear in Maintenance Kanban
          </div>
        </header>

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
