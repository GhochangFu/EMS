// Uploads the thin-line glyphs (out/fill/*.svg) into one organization's mimic symbol library on
// a running portal, through the public API — the same routes the admin screen calls.
//
//   BMS_URL=https://bms.demosites.co.in BMS_TOKEN=<access token> \
//     node iso-glyphs/upload.mjs --org <organization uuid> [--code isoline] [--dry-run]
//
// BMS_TOKEN is the signed-in admin's bearer token (DevTools → Network → any /api/v1 request →
// the Authorization header, without "Bearer "). It is read from the environment only, never
// printed. The library is created when the organization has none with this code, with the
// "fill" style the thin-line set needs. A symbol whose name is already in the library is skipped,
// so a second run after a failure uploads only what is missing.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each glyph's label and palette group (MIMIC_SYMBOL_GROUP_CODES), in palette order. */
const GLYPHS = {
  tank: ["Storage tank", "water"],
  clarifier: ["Clarifier", "water"],
  membrane: ["Membrane skid", "water"],
  vessel: ["Pressure vessel", "water"],
  tower: ["Cooling tower", "water"],
  aeration: ["Aeration basin", "water"],
  dosing: ["Dosing skid", "water"],
  pump: ["Centrifugal pump", "water"],
  discharge: ["Discharge outfall", "water"],
  valve: ["Gate valve", "water"],
  filter: ["Pressure filter", "water"],
  unit: ["Package unit", "general"],
  transformer: ["Transformer", "electrical"],
  breaker: ["Circuit breaker", "electrical"],
  switchboard: ["Switchboard", "electrical"],
  generator: ["Generator set", "electrical"],
  meter: ["Energy meter", "electrical"],
  motor: ["Electric motor", "mechanical"],
  ups: ["UPS", "it_ups"],
  battery: ["Battery string", "it_ups"],
  rack: ["Equipment rack", "it_ups"],
  chiller: ["Chiller", "hvac"],
  ahu: ["Air handling unit", "hvac"],
  fan: ["Axial fan", "hvac"],
  compressor: ["Air compressor", "mechanical"],
  boiler: ["Boiler", "mechanical"],
  sensor: ["Sensor / transmitter", "environment"],
  lamp: ["Light fitting", "facility"],
  lift: ["Lift", "facility"],
  flowmeter: ["Flow meter", "water"],
  rtu: ["RTU panel", "it_ups"],
  damper: ["Air damper", "hvac"],
  "butterfly-valve": ["Butterfly valve", "water"],
  "check-valve": ["Check valve", "water"],
  strainer: ["Y-strainer", "water"],
  "heat-exchanger": ["Plate heat exchanger", "hvac"],
  blower: ["Centrifugal blower", "mechanical"],
  "submersible-pump": ["Submersible pump", "water"],
  "bar-screen": ["Bar screen", "water"],
  "filter-press": ["Filter press", "water"],
  "horizontal-tank": ["Horizontal tank", "water"],
  "condensing-unit": ["Condensing unit", "hvac"],
  "solar-panel": ["Solar PV array", "electrical"],
  "wind-turbine": ["Wind turbine", "electrical"],
  "ev-charger": ["EV charger", "electrical"],
  "capacitor-bank": ["Capacitor bank", "electrical"],
  isolator: ["Isolator", "electrical"],
  vfd: ["Variable frequency drive", "electrical"],
  "smoke-detector": ["Smoke detector", "environment"],
  "pressure-gauge": ["Pressure gauge", "environment"],
};

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    code: { type: "string", default: "isoline" },
    label: { type: "string", default: "Isometric thin-line" },
    licence: { type: "string", default: "Own work" },
    "dry-run": { type: "boolean", default: false },
  },
});

const base = (process.env.BMS_URL ?? "").replace(/\/+$/, "");
const token = process.env.BMS_TOKEN ?? "";
if (!base || !values.org || (!token && !values["dry-run"])) {
  console.error("Usage: BMS_URL=… BMS_TOKEN=… node iso-glyphs/upload.mjs --org <uuid> [--code isoline] [--dry-run]");
  process.exit(2);
}
const api = `${base}/api/v1/mimic-symbol-libraries`;
const auth = { Authorization: `Bearer ${token}` };

/** A failed call's status and the API's message, never the request (it carries the token). */
async function failure(response, what) {
  const text = await response.text().catch(() => "");
  let message = text.slice(0, 300);
  try {
    message = JSON.parse(text).message ?? message;
  } catch {
    // not JSON: keep the text
  }
  return new Error(`${what}: HTTP ${response.status} ${Array.isArray(message) ? message.join("; ") : message}`);
}

async function findOrCreateLibrary() {
  const list = await fetch(`${api}?organizationId=${encodeURIComponent(values.org)}`, { headers: auth });
  if (!list.ok) throw await failure(list, "List libraries");
  const { organization } = await list.json();
  const found = organization.find((lib) => lib.organizationId === values.org && lib.code === values.code);
  if (found) {
    if (found.style !== "fill") throw new Error(`Library "${values.code}" exists with style "${found.style}"; the thin-line set needs "fill". Use another --code.`);
    return found;
  }
  const created = await fetch(api, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId: values.org,
      code: values.code,
      label: values.label,
      style: "fill",
      licence: values.licence,
      attribution: "IONSiTE NEXUS isometric thin-line glyphs, drawn with the anatomy kit (MIT, © 2026 Ryan).",
    }),
  });
  if (!created.ok) throw await failure(created, "Create library");
  const library = await created.json();
  console.log(`Created library ${library.key} (${library.label}).`);
  return library;
}

const ids = Object.keys(GLYPHS);
if (values["dry-run"]) {
  for (const id of ids) {
    const bytes = readFileSync(join(HERE, "out", "fill", `${id}.svg`)).length;
    console.log(`would upload ${id} (${GLYPHS[id][0]}, ${GLYPHS[id][1]}), ${bytes} bytes`);
  }
  console.log(`${ids.length} glyphs to org ${values.org}, library "${values.code}" (fill) at ${base}`);
  process.exit(0);
}

const library = await findOrCreateLibrary();
const have = new Set(library.symbols.map((symbol) => symbol.key.split(":").pop()));
let uploaded = 0;
let skipped = 0;
const failed = [];
for (const id of ids) {
  if (have.has(id)) {
    skipped += 1;
    continue;
  }
  const [label, group] = GLYPHS[id];
  const form = new FormData();
  form.append("name", id);
  form.append("label", label);
  form.append("group", group);
  form.append("file", new Blob([readFileSync(join(HERE, "out", "fill", `${id}.svg`))], { type: "image/svg+xml" }), `${id}.svg`);
  const response = await fetch(`${api}/${library.id}/symbols`, { method: "POST", headers: auth, body: form });
  if (response.ok) {
    uploaded += 1;
    console.log(`uploaded ${id}`);
  } else {
    const error = await failure(response, id);
    failed.push(error.message);
    console.log(`FAILED ${error.message}`);
    if (response.status === 401) break; // the token expired: stop, sign in again, run again
  }
}
console.log(`Library ${library.key}: ${uploaded} uploaded, ${skipped} already there, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
