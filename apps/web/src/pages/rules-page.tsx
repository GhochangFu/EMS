import { RulesPanel } from "../components/rules-panel";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type RulesPageProps = {
  user: AuthUser;
};

/** Operations screen for Phase 5 Sprint D basic automation rules. */
export function RulesPage({ user }: RulesPageProps) {
  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Operations · Rule Engine · simple thresholds and time-window traces
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <header className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Automation Rule Engine
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              IF-THEN logic · threshold checks · time-window traces
            </p>
          </div>
          <div className="rounded border border-bms-green/20 bg-bms-green/10 px-3 py-2 text-xs font-semibold text-bms-green">
            Sprint D scope: no visual builder or real-ingestion adapters
          </div>
        </header>

        <RulesPanel />
      </div>
    </AppShell>
  );
}
