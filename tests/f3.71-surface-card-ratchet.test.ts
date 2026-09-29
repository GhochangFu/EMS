import { describe, expect, it } from "vitest";

import { surfaceCardCounts, surfaceCardFindings } from "./support/surface-card-scan";

/**
 * `F3.71` V1 — the spelled-out surface ratchet (ADR 0085 decisions 5 and 6, plan §4). A card a
 * call site still spells as `bg-surface` + `border-line`, or a form field whose class names
 * `border-line` / `rounded border`, is a surface the vocabulary does not style: it stays flat
 * under the neumorphic style. `tests/support/surface-card-scan.ts` finds them.
 *
 * While the sweeps run, `FLOOR` holds each file's count at the foundation commit, grouped by the
 * sweep unit that owns it; a count may only fall (one direction, so an unmerged sweep never
 * reddens another), and a file not in the table must hold none. Each merged sweep deletes its
 * rows. The last step deletes the table: V1 becomes a hard zero, with `KEPT` as the exact
 * allowlist. Group D waits for `F3.32e` (ADR 0084), whose branch edits those files.
 */

const FLOOR: Record<string, number> = {
  // S1 control room
  "apps/web/src/components/control-room/active-alarms-rail.tsx": 2,
  "apps/web/src/components/control-room/capability-footer.tsx": 1,
  "apps/web/src/components/control-room/generated-site-asset-card.tsx": 1,
  "apps/web/src/components/control-room/key-parameters.tsx": 1,
  "apps/web/src/components/control-room/quick-drilldown.tsx": 1,
  "apps/web/src/components/control-room/smoc/battery.tsx": 2,
  "apps/web/src/components/control-room/smoc/env.tsx": 3,
  "apps/web/src/components/control-room/smoc/hvac.tsx": 2,
  "apps/web/src/components/control-room/smoc/it.tsx": 4,
  "apps/web/src/components/control-room/smoc/overview.tsx": 7,
  "apps/web/src/components/control-room/smoc/sld.tsx": 3,
  "apps/web/src/components/control-room/smoc/ups.tsx": 5,
  "apps/web/src/pages/control-room/organizations-page.tsx": 1,
  "apps/web/src/pages/crac-page.tsx": 1,
  "apps/web/src/pages/sld-page.tsx": 1,
  // S2 dashboards and widgets
  "apps/web/src/components/asset-health/asset-health-card.tsx": 1,
  "apps/web/src/components/asset-health/health-summary-donut.tsx": 1,
  "apps/web/src/components/dashboard-templates/widget-editor.tsx": 6,
  "apps/web/src/components/dashboards/asset-role-binding-picker.tsx": 2,
  "apps/web/src/components/dashboards/chart-series-picker.tsx": 1,
  "apps/web/src/components/dashboards/dashboard-scope-fields.tsx": 3,
  "apps/web/src/components/dashboards/duplicate-dashboard-dialog.tsx": 3,
  "apps/web/src/components/dashboards/metric-source-picker.tsx": 1,
  "apps/web/src/components/dashboards/point-picker.tsx": 3,
  "apps/web/src/pages/admin/dashboard-builder-edit-page.tsx": 3,
  "apps/web/src/pages/admin/dashboard-builder-page.tsx": 3,
  "apps/web/src/pages/admin/dashboard-template-detail-page.tsx": 3,
  "apps/web/src/pages/admin/dashboard-template-stock-view-page.tsx": 1,
  "apps/web/src/pages/admin/dashboard-templates-page.tsx": 7,
  "apps/web/src/pages/dashboard-page.tsx": 2,
  "apps/web/src/pages/location-dashboard-page.tsx": 6,
  // S3a admin master data (a–l)
  "apps/web/src/components/admin/active-filter-bar.tsx": 1,
  "apps/web/src/components/admin/control-room-view-field.tsx": 3,
  "apps/web/src/components/admin/hierarchy-filter-bar.tsx": 4,
  "apps/web/src/pages/admin/asset-groups-page.tsx": 1,
  "apps/web/src/pages/admin/asset-points-page.tsx": 10,
  "apps/web/src/pages/admin/assets-page.tsx": 8,
  "apps/web/src/pages/admin/calc-parameters-page.tsx": 7,
  "apps/web/src/pages/admin/escalation-profiles-page.tsx": 5,
  "apps/web/src/pages/admin/location-types-page.tsx": 3,
  "apps/web/src/pages/admin/locations-page.tsx": 8,
  // S3b admin master data (m–t)
  "apps/web/src/components/org-location-accordion.tsx": 1,
  "apps/web/src/pages/admin/manual-readings-page.tsx": 4,
  "apps/web/src/pages/admin/mimic-layouts-page.tsx": 2,
  "apps/web/src/pages/admin/notification-channels-page.tsx": 6,
  "apps/web/src/pages/admin/notification-deliveries-page.tsx": 2,
  "apps/web/src/pages/admin/organizations-page.tsx": 5,
  "apps/web/src/pages/admin/point-keys-page.tsx": 7,
  "apps/web/src/pages/admin/rtus-page.tsx": 6,
  "apps/web/src/pages/admin/telemetry-import-page.tsx": 2,
  // S4 assets and asset templates
  "apps/web/src/components/asset-templates/dashboard-view-editor.tsx": 1,
  "apps/web/src/components/asset-templates/dashboard-widget-editor.tsx": 23,
  "apps/web/src/components/asset-templates/dashboards-tab.tsx": 1,
  "apps/web/src/components/asset-templates/formula-preview.tsx": 1,
  "apps/web/src/components/asset-templates/stock-catalog-accordion.tsx": 1,
  "apps/web/src/components/assets/asset-detail-panel.tsx": 1,
  "apps/web/src/components/assets/asset-images-panel.tsx": 2,
  "apps/web/src/components/assets/asset-point-bulk-edit-panel.tsx": 3,
  "apps/web/src/components/assets/point-calc-override-panel.tsx": 5,
  "apps/web/src/pages/admin/asset-template-detail-page.tsx": 3,
  "apps/web/src/pages/admin/asset-template-stock-view-page.tsx": 1,
  "apps/web/src/pages/admin/asset-templates-page.tsx": 10,
  "apps/web/src/pages/assets-page.tsx": 3,
  // S5 alarms and rules
  "apps/web/src/components/alarm-details-panel.tsx": 9,
  "apps/web/src/components/alarm-summary-card.tsx": 1,
  "apps/web/src/components/rule-builder-panel.tsx": 1,
  "apps/web/src/components/rules-panel.tsx": 6,
  "apps/web/src/pages/alarm-kb-page.tsx": 2,
  "apps/web/src/pages/alarms-page.tsx": 2,
  // S6 energy and reports
  "apps/web/src/components/energy-source-stack-chart.tsx": 3,
  "apps/web/src/components/energy-top-bar-chart.tsx": 3,
  "apps/web/src/components/load-trend-chart.tsx": 2,
  "apps/web/src/components/report-history.tsx": 1,
  "apps/web/src/components/report-schedules.tsx": 1,
  "apps/web/src/components/reports-panel.tsx": 10,
  "apps/web/src/pages/energy-page.tsx": 1,
  // S7 maintenance, onboarding, login, lib
  "apps/web/src/components/maintenance-schedules-panel.tsx": 22,
  "apps/web/src/lib/vocabulary.ts": 1,
  "apps/web/src/pages/admin/onboarding-chat-page.tsx": 5,
  "apps/web/src/pages/login-page.tsx": 3,
  "apps/web/src/pages/work-orders-page.tsx": 13,
  // D after F3.32e merges
  "apps/web/src/components/dashboards/widget-inspector.tsx": 24,
  "apps/web/src/components/mimic-editor/canvas.tsx": 1,
  "apps/web/src/components/mimic-editor/palette.tsx": 2,

};

/** Sites kept on purpose, by file, with the reason. Exact: a stale entry fails V1b. */
const KEPT: Record<string, { count: number; reason: string }> = {};

describe("F3.71 V1 the spelled-out surface ratchet", () => {
  it("V1 no file holds more spelled-out cards and fields than its floor", () => {
    const over = [...surfaceCardCounts()]
      .filter(([file, n]) => n > (FLOOR[file] ?? 0) + (KEPT[file]?.count ?? 0))
      .map(([file, n]) => `${file}: ${n} > ${(FLOOR[file] ?? 0) + (KEPT[file]?.count ?? 0)}`);
    expect(over).toEqual([]);
  });

  it("V1b every KEPT entry still matches its file's count", () => {
    const counts = surfaceCardCounts();
    const stale = Object.entries(KEPT)
      .filter(([file, { count }]) => (counts.get(file) ?? 0) - (FLOOR[file] ?? 0) < count)
      .map(([file]) => file);
    expect(stale).toEqual([]);
  });

  it("V1 the scan is live: it finds a spelled-out card", () => {
    expect(surfaceCardFindings('const a = "rounded border border-line bg-surface p-4";')).toEqual(["card:1"]);
  });

  it("V1 the scan is live: it finds a spelled-out field", () => {
    expect(surfaceCardFindings('<input className="w-full rounded border px-2" />')).toEqual(["field:1"]);
  });

  it("V1 the scan does not count a vocabulary field", () => {
    expect(surfaceCardFindings('<select className="surface-field w-full px-2 py-1" />')).toEqual([]);
  });
});
