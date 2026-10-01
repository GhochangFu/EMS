import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { AlarmSocketEvent } from "@bms/shared";

import { catalogValuesQueryPrefix } from "./use-dashboard-telemetry";
import { siteWidgetsQueryPrefix, useSiteWidgetsAlarmRefresh } from "./use-site-widgets";

/**
 * `F3.73` critique — the canvas's one `/ws/alarms` subscription refreshes the catalog values as
 * well as the site widgets, so the Active alarms tile (`alarms.active.count`, a catalog binding)
 * cannot show fewer alarms than the rail beside it. The socket is mocked: the test captures the
 * handler `useSiteWidgetsAlarmRefresh` registers and fires it once.
 */

const socket = vi.hoisted(() => ({ handler: null as ((event: AlarmSocketEvent) => void) | null }));

vi.mock("./use-alarms-socket", () => ({
  useAlarmsSocket: (onAlarm: (event: AlarmSocketEvent) => void) => {
    socket.handler = onAlarm;
  },
}));

const DASHBOARD_ID = "11111111-1111-4111-8111-111111111111";
const SITE_WIDGETS_KEY = [...siteWidgetsQueryPrefix, DASHBOARD_ID, null] as const;
const CATALOG_KEY = [...catalogValuesQueryPrefix, DASHBOARD_ID] as const;

/** Seeds one site-widgets and one catalog-values entry, mounts the hook, and fires one alarm event. */
function fireOneAlarmEvent(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(SITE_WIDGETS_KEY, { seeded: true });
  qc.setQueryData(CATALOG_KEY, { values: [] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  socket.handler = null;
  renderHook(() => useSiteWidgetsAlarmRefresh(), { wrapper });
  expect(socket.handler).not.toBeNull();
  act(() => {
    socket.handler?.({} as AlarmSocketEvent);
  });
  return qc;
}

/** Positive control: the event invalidates the site-widgets entry (the rail's read). */
export function anAlarmEventInvalidatesTheSiteWidgetsRead(): void {
  const qc = fireOneAlarmEvent();
  expect(qc.getQueryState(SITE_WIDGETS_KEY)?.isInvalidated).toBe(true);
}

/** The same event invalidates the catalog-values entry (the Active alarms tile's read). */
export function anAlarmEventInvalidatesTheCatalogValuesRead(): void {
  const qc = fireOneAlarmEvent();
  expect(qc.getQueryState(CATALOG_KEY)?.isInvalidated).toBe(true);
}
