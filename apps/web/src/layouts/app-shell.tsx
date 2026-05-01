import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { roleLabel } from "../lib/role-label";
import type { AuthUser } from "../stores/auth-store";
import { StatusBarClock } from "../components/status-bar-clock";

const topNav = [
  { label: "Overview", to: "/" },
  { label: "Sites", to: "/map" },
  { label: "Energy", to: "/energy" },
] as const;

const moduleGroups = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard", path: "/" },
      { label: "Alarm Centre", path: "/alarms" },
      { label: "Sites Map", path: "/map" },
      { label: "Electrical SLD", path: "/sld" },
      { label: "HVAC · CRAC", path: "/crac" },
      { label: "Energy Analytics", path: "/energy" },
    ],
  },
  {
    title: "Control Room 2D",
    items: [
      { label: "CR · Main Dashboard", path: "/cr-overview" },
      { label: "CR · Electrical SLD", path: "/cr-sld" },
      { label: "CR · UPS Monitoring", path: "/cr-ups" },
      { label: "CR · Battery Bank", path: "/cr-battery" },
      { label: "CR · HVAC System", path: "/cr-hvac" },
      { label: "CR · Environment", path: "/cr-env" },
      { label: "CR · IT & Rack Load", path: "/cr-it" },
    ],
  },
  {
    title: "Maintenance",
    items: [
      { label: "Maintenance", path: "/work-orders" },
      { label: "Schedule Centre", path: "/maintenance-schedules" },
    ],
  },
  {
    title: "Automation",
    items: [
      { label: "Rule Engine", path: "/rules" },
      { label: "Reports", path: "/reports" },
    ],
  },
] as const;

type AppShellProps = {
  user: AuthUser;
  children: ReactNode;
  /** When set, replaces the default KPI ribbon placeholder (Sprint 3 dashboard). */
  kpiRibbon?: ReactNode;
};

export function AppShell({ user, children, kpiRibbon }: AppShellProps) {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col bg-bms-canvas text-bms-ink">
      <header className="flex h-12 shrink-0 items-center justify-between bg-bms-header px-4 text-sm text-white">
        <div className="flex items-center gap-3">
          <span className="font-condensed text-lg font-bold tracking-tight text-bms-green">
            SMOC BMS
          </span>
          <span className="hidden text-white/70 sm:inline">
            Eskom Smart Metering Operating Centre
          </span>
        </div>
        <div className="text-right">
          <div className="font-medium">{user.displayName}</div>
          <div className="text-xs text-white/60">{roleLabel(user.role)}</div>
        </div>
      </header>

      <nav className="flex h-10 shrink-0 items-center gap-1 bg-bms-green-dark px-2 text-sm font-medium text-white shadow-sm">
        {topNav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded px-3 py-1.5 hover:bg-white/10 ${
              location.pathname === item.to ? "bg-white/15" : ""
            }`}
          >
            {item.label}
          </Link>
        ))}
        <span
          className="ml-1 cursor-not-allowed rounded px-3 py-1.5 text-white/50"
          title="Out of scope for prototype"
        >
          Settings
        </span>
      </nav>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-gray-200 bg-white py-3 text-sm">
          {moduleGroups.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-bms-muted">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((m) => (
                  <li key={m.path}>
                    <Link
                      to={m.path}
                      className={`block w-full border-l-2 px-3 py-1.5 hover:bg-bms-canvas ${
                        location.pathname === m.path
                          ? "border-bms-green bg-bms-canvas/80 font-semibold text-bms-ink"
                          : "border-transparent text-bms-muted"
                      }`}
                    >
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <section className="flex min-h-14 shrink-0 items-center border-b border-gray-200 bg-white px-4 py-2 text-xs text-bms-muted shadow-sm">
            {kpiRibbon ?? (
              <>
                <span className="rounded bg-gray-100 px-2 py-1 font-mono text-bms-ink">
                  KPI ribbon
                </span>
                <span className="ml-3">Sign in to view the Executive Summary.</span>
              </>
            )}
          </section>
          <div className="flex-1 overflow-auto bg-bms-canvas p-4">{children}</div>
        </main>
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between bg-bms-header px-4 text-xs text-white/70">
        <span className="flex items-center gap-2">
          <span>Prototype · telemetry-driven</span>
          <StatusBarClock />
        </span>
        <span className="font-mono">v0.1</span>
      </footer>
    </div>
  );
}
