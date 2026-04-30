import { ReportsPanel } from "../components/reports-panel";
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
        <header className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Reports & Analytics
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              One-click generation · Energy Consumption CSV · mockup{" "}
              <span className="font-mono text-xs">R.rp</span>
            </p>
          </div>
          <div className="rounded border border-bms-green/20 bg-bms-green/10 px-3 py-2 text-xs font-semibold text-bms-green">
            Sprint E: preview and CSV only
          </div>
        </header>

        <ReportsPanel />
      </div>
    </AppShell>
  );
}
