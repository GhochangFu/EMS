import { RulesPanel } from "../components/rules-panel";
import { PageHeader } from "../components/page-header";
import { StatusPill } from "../components/status-pill";
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
        <PageHeader
          eyebrow="R.rl"
          title="Automation Rule Engine"
          subtitle="IF-THEN logic · threshold checks · time-window traces"
          actions={<StatusPill label="Rule Builder" />}
        />

        <RulesPanel />
      </div>
    </AppShell>
  );
}
