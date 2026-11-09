import type { ReactNode } from "react";

import type { AccessibleScope } from "@bms/shared";

import { StatusBarClock } from "../../components/status-bar-clock";
import { SystemStatusIndicator } from "../../components/system-status-indicator";

/** `F4.341` PR 5 — the page area under the shell: the KPI ribbon and the body, moved verbatim. */
export function ShellMain({
  kpiRibbon,
  scope,
  children,
}: {
  kpiRibbon: ReactNode;
  scope: AccessibleScope | null;
  children: ReactNode;
}) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <section className="surface-ribbon flex min-h-14 shrink-0 items-center px-4 py-2 text-xs text-ink-muted">
        <div className="flex w-full flex-wrap items-center gap-3">
          {kpiRibbon}
          {scope?.kind === "asset_group" ? (
            <span className="rounded border border-warning-line bg-warning-wash px-2 py-1 font-semibold text-warning-ink">
              Limited asset-group access
            </span>
          ) : null}
        </div>
      </section>
      <div className="flex-1 overflow-auto surface-page p-4">{children}</div>
    </main>
  );
}

/** The chrome footer every shell carries, moved verbatim from `app-shell.tsx`. */
export function ShellFooter() {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between bg-chrome px-4 text-xs text-on-dark/70">
      <span className="flex items-center gap-2">
        <span>IONSiTE NEXUS · telemetry-driven</span>
        <StatusBarClock />
        <SystemStatusIndicator />
      </span>
      <span className="flex items-center gap-2">
        <span className="font-mono">v0.1</span>
        <span className="text-accent-on-chrome">
          Powered By: <b className="text-on-dark">Euphoria Infotech India Limited</b>
        </span>
      </span>
    </footer>
  );
}
