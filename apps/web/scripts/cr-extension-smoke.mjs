import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * `pnpm --filter web smoke:cr` — a cheap static smoke of the Control Room
 * extension: every file below must still hold its needles (and none of its
 * forbidden ones). It proves the pieces are wired, not that they behave; the
 * specs and `tests/f3.70-smoc-site-view.test.ts` own the behaviour.
 *
 * Since `F3.70` (ADR 0076 decision 9) the seven SMOC pages are tabs of the
 * site page: their contents live in `src/components/control-room/smoc/`,
 * `SmocSiteView` hosts them under one telemetry provider, `lib/smoc-pages.ts`
 * holds the tab table, and the seven `/cr-*` routes in `app.tsx` redirect
 * into the tabs through `SmocLegacyRedirect`.
 *
 * The `AGENTS.md` and `docs/roadmap.md` needles pin prose; a `chore(agents):`
 * sweep that rewords it must update them here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

/** The seven tabs: key, `SMOC_TABS` label and area, content component. */
const TABS = [
  { key: "overview", label: "Main Dashboard", area: "overview", content: "ControlRoomOverviewContent" },
  { key: "sld", label: "Electrical SLD", area: "electrical", content: "ControlRoomSldContent" },
  { key: "ups", label: "UPS Monitoring", area: "upsBattery", content: "ControlRoomUpsContent" },
  { key: "battery", label: "Battery Bank", area: "upsBattery", content: "ControlRoomBatteryContent" },
  { key: "hvac", label: "HVAC System", area: "hvac", content: "ControlRoomHvacContent" },
  { key: "env", label: "Environment", area: "environment", content: "ControlRoomEnvContent" },
  { key: "it", label: "IT & Rack Load", area: "it", content: "ControlRoomItContent" },
];

/** The page names and files the `F3.70` move deleted. */
const DEAD_PAGES = ["Overview", "Sld", "It", "Ups", "Battery", "Hvac", "Env"];
const DEAD_PAGE_FILES = ["overview", "sld", "it", "ups", "battery", "hvac", "env"];

const SMOC_DIR = "src/components/control-room/smoc";

const checks = [
  {
    file: "src/app.tsx",
    expected: [
      'import { SmocLegacyRedirect } from "./components/smoc-legacy-redirect";',
      'path="/control-room/site/:locationId/:tab?"',
      "<ControlRoomSitePage user={user} />",
      ...TABS.flatMap((tab) => [`path="/cr-${tab.key}"`, `<SmocLegacyRedirect tab="${tab.key}" />`]),
    ],
    forbidden: [
      "<ControlRoomRoute",
      ...DEAD_PAGES.map((name) => `ControlRoom${name}Page`),
      ...DEAD_PAGE_FILES.map((name) => `./pages/control-room-${name}-page`),
    ],
  },
  {
    file: "src/layouts/app-shell.tsx",
    expected: ['{ label: "Control Room", path: "/control-room", nested: true }'],
    forbidden: ['label: "CR ·', 'path: "/cr-'],
  },
  {
    file: "src/lib/smoc-pages.ts",
    expected: [
      ...TABS.map((tab) => `{ key: "${tab.key}", label: "${tab.label}", area: "${tab.area}" }`),
      'export const DEFAULT_SMOC_TAB: SmocTabKey = "overview";',
      'export const SMOC_SITE_CODE = "RSMOC-WC";',
      'export const SMOC_ORG_CODE = "ESKOM";',
      "export function isSmocSite",
      "export function findSmocSite",
      "export function smocTabPath",
    ],
  },
  {
    file: "src/components/control-room/smoc-site-view.tsx",
    expected: [
      ...TABS.map((tab) => `${tab.key}: <${tab.content} />,`),
      'data-testid="smoc-tabs"',
      "allowedSmocTabs(scope)",
      "<SchematicTelemetryProvider assetCodes={CR_TRACKED_ASSET_CODES} pointKeys={CR_POINT_KEYS}>",
      "Outside your asset-group scope",
    ],
  },
  {
    file: "src/pages/control-room/site-page.tsx",
    expected: ["<SmocSiteView", "isSmocSite(site)", "smocTabFromParam(tabParam)"],
  },
  {
    file: "src/components/smoc-legacy-redirect.tsx",
    expected: ["findSmocSite(", "smocTabPath("],
  },
  {
    file: `${SMOC_DIR}/overview.tsx`,
    expected: [
      "export function ControlRoomOverviewContent",
      ...TABS.filter((tab) => tab.key !== "overview").map((tab) => `smocTabPath(locationId, "${tab.key}")`),
      "Critical Systems Summary",
      "Environment Snapshot",
      "ModuleSummaryCard",
      "CR Electrical SLD · UPS · Battery · HVAC · Environment",
      "UPS Monitoring",
      "Battery Bank",
      "HVAC System",
    ],
    forbidden: ['to="/cr-', "import { AppShell }"],
  },
  {
    file: "src/components/control-room/quick-drilldown.tsx",
    expected: TABS.filter((tab) => tab.key !== "overview").map(
      (tab) => `smocTabPath(locationId, "${tab.key}")`,
    ),
    forbidden: ['to="/cr-'],
  },
  {
    file: `${SMOC_DIR}/sld.tsx`,
    expected: ["export function ControlRoomSldContent"],
    forbidden: ["import { AppShell }"],
  },
  {
    file: `${SMOC_DIR}/it.tsx`,
    expected: ["export function ControlRoomItContent"],
    forbidden: ["import { AppShell }"],
  },
  {
    file: `${SMOC_DIR}/ups.tsx`,
    expected: [
      "export function ControlRoomUpsContent",
      "fetchRules",
      "CR-UPS-1",
      "CR-UPS-2",
      "CR-BATT-1",
      "CR-BATT-2",
      "UPS Monitoring · 2 x 30 kVA",
      "Manual Bypass · disabled",
      "Battery Test · disabled",
      "function UpsBlockDiagram",
      "rule-driven",
    ],
    forbidden: ["import { AppShell }"],
  },
  {
    file: "../../AGENTS.md",
    expected: [
      "Phase 5 Control Room extension",
      "/cr-ups",
      "/cr-battery",
      "CR UPS Monitoring",
      "CR Battery Bank",
    ],
  },
  {
    file: "../../docs/roadmap.md",
    expected: [
      "G.1 — CR UPS Monitoring",
      "G.2 — CR Battery Bank",
      "/cr-ups",
      "/cr-battery",
      "R.crUps",
      "R.crBat",
    ],
  },
  {
    file: `${SMOC_DIR}/battery.tsx`,
    expected: [
      "export function ControlRoomBatteryContent",
      "fetchRules",
      "CR-BATT-1",
      "CR-BATT-2",
      "Battery Bank · 2 strings, 32 cells each",
      "Equalize Charge · disabled",
      "Capacity Test · disabled",
      "generateCells",
      "rule-driven",
      "No battery Rule Engine threshold is currently matched",
      "Adjust temperature and backup thresholds from the Rule Engine page",
    ],
    forbidden: [
      "import { AppShell }",
      "(slice.batteryTempC ?? 0) >= 30",
      "(slice.backupMin ?? 99) < 20",
      "voltage > 13.55",
      "voltage < 11.85",
      "voltage > 13.4",
      "voltage < 12.0",
      "temperature >= 34",
      "temperature >= 30",
      "derived operating band",
    ],
  },
  {
    // `seed.ts` was split into sibling `*-seed.ts` modules to stay under the
    // AGENTS.md §4.5 line cap; the rule needles moved to one file and the asset
    // needles to another, so the check follows them rather than the old path.
    file: "../../packages/db/src/automation-rules-seed.ts",
    expected: [
      "CR_BATT_1_TEMP_WARNING",
      "CR_BATT_2_TEMP_WARNING",
      "CR_BATT_1_BACKUP_LOW",
      "CR_BATT_2_BACKUP_LOW",
      "CR_HVAC_1_RETURN_TEMP_WARNING",
      "CR_HVAC_2_RETURN_TEMP_WARNING",
      "CR_HVAC_1_COMPRESSOR_FAULT",
      "CR_HVAC_2_COMPRESSOR_FAULT",
      "CR-ENV-OP-CONSOLE",
      "CR-LEAK-01",
      "CR-SMOKE-01",
      "TEMP_WARNING",
      "WET_ALARM",
      "SMOKE_ALARM",
      'pointKey: "battery_temp_c"',
      'pointKey: "backup_min"',
      'pointKey: "return_air_temp_c"',
      'pointKey: "compressor_ok"',
      'pointKey: "temperature_c"',
      'pointKey: "leak_state"',
      'pointKey: "smoke_state"',
      'operator: "gte"',
      'operator: "lt"',
      'operator: "eq"',
    ],
  },
  {
    file: "../../packages/db/src/eskom-assets-seed.ts",
    expected: [
      "CR-ENV-OP-CONSOLE",
      "CR-LEAK-01",
      "CR-SMOKE-01",
      'domain: "hvac"',
      'domain: "environment"',
    ],
  },
  {
    file: "src/components/live-svg/control-room-bindings.ts",
    expected: [
      "HVAC_POINT_KEYS",
      "...HVAC_POINT_KEYS",
      "CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
      "CR_ENVIRONMENT_CODES",
      "...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
    ],
  },
  {
    file: `${SMOC_DIR}/hvac.tsx`,
    expected: [
      "export function ControlRoomHvacContent",
      "fetchRules",
      "CR-HVAC-1",
      "CR-HVAC-2",
      "HVAC System · 2 x 4 TR Precision AC",
      "Force Changeover · disabled",
      "Set Schedule · disabled",
      "Lead / Lag Strategy",
      "Run-Hour Balance",
      "rule-driven",
    ],
    forbidden: ["import { AppShell }"],
  },
  {
    // The point keys moved out of `index.ts` into `constants.ts`, which the
    // barrel re-exports (the next check). The declaration line is the needle:
    // the bare name also appears in docblock prose elsewhere in the package.
    file: "../../packages/shared/src/constants.ts",
    expected: [
      "export const CONTROL_ROOM_ENVIRONMENT_POINT_KEYS = [",
      '"temperature_c"',
      '"humidity_pct"',
      '"leak_state"',
      '"smoke_state"',
    ],
  },
  {
    file: "../../packages/shared/src/index.ts",
    expected: ['export * from "./constants";'],
  },
  {
    file: "../../apps/sim/src/index.js",
    expected: [
      "CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
      "environmentState",
      "stepEnvironment",
      'row.domain === "environment"',
    ],
  },
  {
    // The rule-point vocabulary moved out of `rules.service.ts` into its own module.
    file: "../../apps/api/src/rules/rule-points.ts",
    expected: [
      "CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
      'domain === "environment"',
      'code.startsWith("CR-ENV")',
    ],
  },
  {
    file: `${SMOC_DIR}/env.tsx`,
    expected: [
      "export function ControlRoomEnvContent",
      "fetchRules",
      "CR-ENV-OP-CONSOLE",
      "CR-LEAK-01",
      "CR-SMOKE-01",
      "Environment Monitoring",
      "Test Sensors · disabled",
      "Calibrate · disabled",
      "Sensor Floorplan",
      "Water Leak Detection",
      "Smoke Detection",
      "rule-driven",
    ],
    forbidden: ["import { AppShell }"],
  },
];

let failed = false;

for (const check of checks) {
  const path = resolve(webRoot, check.file);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.file}`);
    console.error(`  unreadable: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const missing = check.expected.filter((needle) => !content.includes(needle));
  const forbidden = (check.forbidden ?? []).filter((needle) => content.includes(needle));
  if (missing.length > 0 || forbidden.length > 0) {
    failed = true;
    console.error(`FAIL ${check.file}`);
    for (const needle of missing) {
      console.error(`  missing: ${needle}`);
    }
    for (const needle of forbidden) {
      console.error(`  forbidden: ${needle}`);
    }
  } else {
    console.log(`PASS ${check.file}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("PASS CR extension smoke");
}
