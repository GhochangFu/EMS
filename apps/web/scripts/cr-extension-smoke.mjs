import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

const checks = [
  {
    file: "src/app.tsx",
    expected: [
      'import { ControlRoomUpsPage } from "./pages/control-room-ups-page";',
      'import { ControlRoomBatteryPage } from "./pages/control-room-battery-page";',
      'import { ControlRoomHvacPage } from "./pages/control-room-hvac-page";',
      'import { ControlRoomEnvPage } from "./pages/control-room-env-page";',
      'path="/cr-ups"',
      'path="/cr-battery"',
      'path="/cr-hvac"',
      'path="/cr-env"',
      "<ControlRoomUpsPage user={user} />",
      "<ControlRoomBatteryPage user={user} />",
      "<ControlRoomHvacPage user={user} />",
      "<ControlRoomEnvPage user={user} />",
    ],
  },
  {
    file: "src/layouts/app-shell.tsx",
    expected: [
      '{ label: "CR · UPS Monitoring", path: "/cr-ups" }',
      '{ label: "CR · Battery Bank", path: "/cr-battery" }',
      '{ label: "CR · HVAC System", path: "/cr-hvac" }',
      '{ label: "CR · Environment", path: "/cr-env" }',
    ],
  },
  {
    file: "src/pages/control-room-overview-page.tsx",
    expected: [
      'to="/cr-ups"',
      "UPS Monitoring",
      'to="/cr-battery"',
      "Battery Bank",
      'to="/cr-hvac"',
      "HVAC System",
      'to="/cr-env"',
      "Environment",
      "Critical Systems Summary",
      "Environment Snapshot",
      "ModuleSummaryCard",
      "SLD, IT, UPS, Battery, HVAC, and Environment",
      "UPS Monitoring",
      "Battery Bank",
      "HVAC System",
    ],
  },
  {
    file: "src/pages/control-room-ups-page.tsx",
    expected: [
      "export function ControlRoomUpsPage",
      "SchematicTelemetryProvider",
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
    file: "src/pages/control-room-battery-page.tsx",
    expected: [
      "export function ControlRoomBatteryPage",
      "SchematicTelemetryProvider",
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
    file: "../../packages/db/src/seed.ts",
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
    file: "src/pages/control-room-hvac-page.tsx",
    expected: [
      "export function ControlRoomHvacPage",
      "SchematicTelemetryProvider",
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
  },
  {
    file: "../../packages/shared/src/index.ts",
    expected: [
      "CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
      "temperature_c",
      "humidity_pct",
      "leak_state",
      "smoke_state",
    ],
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
    file: "../../apps/api/src/rules/rules.service.ts",
    expected: [
      "CONTROL_ROOM_ENVIRONMENT_POINT_KEYS",
      'domain === "environment"',
      "code.startsWith(\"CR-ENV\")",
    ],
  },
  {
    file: "src/pages/control-room-env-page.tsx",
    expected: [
      "export function ControlRoomEnvPage",
      "SchematicTelemetryProvider",
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
  },
];

let failed = false;

for (const check of checks) {
  const path = resolve(webRoot, check.file);
  const content = await readFile(path, "utf8");
  const missing = check.expected.filter((needle) => !content.includes(needle));
  const forbidden = "forbidden" in check
    ? check.forbidden.filter((needle) => content.includes(needle))
    : [];
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
