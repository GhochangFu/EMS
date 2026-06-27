import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  throw new Error("Usage: node export-phe-from-json.mjs <path-to-mcp-json>");
}

/** @param {Record<string, unknown>[]} rows */
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

const all = JSON.parse(fs.readFileSync(src, "utf8")).recordset;
const phewb = all.filter((r) => r.OrgCode === "PHEWB");

const fullCols = [
  "EdgeRTUId","RTUCode","EdgeRTUName","StationCode","StationName","RegionCode","RegionName","OrgCode","OrgName","DeviceId","DeviceCode","DeviceName","DeviceDisplayName","DeviceRole","DeviceSensorId","SensorCode","SensorName","SensorDescription","DataUnitCode","DataTypeCode","DataCategoryCode","SensorTypeCode","DataKey","SuggestedBmsPointKey","SensorActiveFlag","DeviceActiveFlag",
];
const bmsCols = [
  "EdgeRTUId","RTUCode","EdgeRTUName","StationCode","StationName","RegionCode","RegionName","OrgCode","OrgName","DeviceId","DeviceCode","DeviceRole","SensorCode","SensorName","DataUnitCode","SuggestedBmsPointKey","DataKey",
];

const pick = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""])));

fs.writeFileSync(path.join(outDir, "phe-rtu-device-sensor-mapping.csv"), toCsv(pick(all, fullCols)));
fs.writeFileSync(path.join(outDir, "phe-bms-point-mapping-suggestions.csv"), toCsv(pick(all, bmsCols)));
fs.writeFileSync(path.join(outDir, "phewb-rtu-device-sensor-mapping.csv"), toCsv(pick(phewb, fullCols)));
fs.writeFileSync(path.join(outDir, "phewb-bms-point-mapping-suggestions.csv"), toCsv(pick(phewb, bmsCols)));

const summary = {
  exportedAt: new Date().toISOString(),
  source: { server: "eskooldb.database.windows.net", database: "TeleCash_Wallet_1" },
  files: {
    "phe-rtu-device-sensor-mapping.csv": { rows: all.length },
    "phe-bms-point-mapping-suggestions.csv": { rows: all.length },
    "phewb-rtu-device-sensor-mapping.csv": { rows: phewb.length },
    "phewb-bms-point-mapping-suggestions.csv": { rows: phewb.length },
    "phe-daily-snap-latest.csv": { rows: 5 },
  },
  distinct: {
    rtuCount: new Set(all.map((r) => r.RTUCode)).size,
    deviceCount: new Set(all.map((r) => r.DeviceCode)).size,
    phewbRtuCount: new Set(phewb.map((r) => r.RTUCode)).size,
    phewbDeviceCount: new Set(phewb.map((r) => r.DeviceCode)).size,
  },
};
fs.writeFileSync(path.join(outDir, "phe-export-manifest.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
