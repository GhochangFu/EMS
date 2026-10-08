import type { AdminAssetPointDto } from "@bms/shared";

import { createBodyFrom, editBodyFrom, emptyAssetPointForm, formFrom } from "./asset-point-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertBody(actual: object, expected: object, message: string): void {
  // Key order and value both: `{ engMax: 9 }` must be exactly that, so a body
  // that restates an unchanged field fails here rather than passing a subset check.
  const sort = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).sort()));
  assert(sort(actual) === sort(expected), `${message} — expected ${sort(expected)}, got ${sort(actual)}`);
  assert(
    Object.values(actual).every((value) => value !== undefined),
    `${message} — a key with an undefined value is a key the body should not carry, got ${Object.keys(actual)}`,
  );
}

const RTU_A = "c1000000-0000-4000-8000-0000000000ra";
const RTU_B = "c1000000-0000-4000-8000-0000000000rb";

const LOADED: AdminAssetPointDto = {
  id: "c1000000-0000-4000-8000-000000000001",
  assetId: "c1000000-0000-4000-8000-0000000000a1",
  assetCode: "C1-PUMP",
  assetName: "C1 pump",
  locationId: null,
  locationName: null,
  pointKey: "power_kw",
  sourceDataKey: "C1_RAW",
  sensorCode: "S1",
  unit: null,
  active: true,
  sourceKind: "measured",
  rtuId: RTU_A,
  createdAt: new Date(0).toISOString(),
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: 5,
  engMax: null,
  qualityPolicy: null,
  templateDefaults: { scaleMultiplier: 2, scaleOffset: null, engMin: null, engMax: 100, qualityPolicy: "accept_bad" },
};

/**
 * ADR 0056 Amendment 3 part A (`F2.31`) — the edit body is the diff against the
 * loaded row: a key is sent only when the form differs from what was loaded.
 */
export function runEditDiffTests(): void {
  const form = formFrom(LOADED);
  assertBody(editBodyFrom(LOADED, form), {}, "(a) an untouched form sends nothing");
  assertBody(editBodyFrom(LOADED, { ...form, engMax: "9" }), { engMax: 9 }, "(b) only the typed field");
  assertBody(editBodyFrom(LOADED, { ...form, engMin: "" }), { engMin: null }, "(c) an emptied stored value clears");
  assertBody(editBodyFrom(LOADED, { ...form, engMin: "abc" }), {}, "(d) a non-number is not sent");
  assertBody(editBodyFrom(LOADED, { ...form, engMin: "5.0" }), {}, "a number equal to the stored one is no change");
  assertBody(editBodyFrom(LOADED, { ...form, pointKey: "" }), {}, "(e) a required field is never cleared");
  assertBody(editBodyFrom(LOADED, { ...form, pointKey: "other_kw" }), { pointKey: "other_kw" }, "a re-key is sent");
  assertBody(editBodyFrom(LOADED, { ...form, sourceDataKey: "" }), {}, "(e) nor the source data key");
  assertBody(
    editBodyFrom(LOADED, { ...form, sourceDataKey: "C1_RAW2" }),
    { sourceDataKey: "C1_RAW2" },
    "a changed source data key",
  );
  assertBody(editBodyFrom(LOADED, { ...form, sensorCode: "S2" }), { sensorCode: "S2" }, "(f) a changed sensor code");
  assertBody(editBodyFrom(LOADED, { ...form, unit: "A" }), { unit: "A" }, "a changed unit");
  // Each of the four numbers on its own, so dropping one from `NUMBER_FIELDS`
  // loses that field's edit here rather than silently in the dialog.
  assertBody(editBodyFrom(LOADED, { ...form, scaleMultiplier: "1.5" }), { scaleMultiplier: 1.5 }, "a typed multiplier");
  assertBody(editBodyFrom(LOADED, { ...form, scaleOffset: "-2" }), { scaleOffset: -2 }, "a typed offset");
  // The PATCH body has `sensorCode` / `unit` optional, not nullable: an emptied
  // box is omitted, as before this change (a recorded gap, not a clear).
  assertBody(editBodyFrom(LOADED, { ...form, sensorCode: "" }), {}, "an emptied sensor code is omitted");
  assertBody(
    editBodyFrom(LOADED, { ...form, qualityPolicy: "discard_bad" }),
    { qualityPolicy: "discard_bad" },
    "a chosen quality policy",
  );
  assertBody(
    editBodyFrom({ ...LOADED, qualityPolicy: "accept_bad" }, { ...form, qualityPolicy: "" }),
    { qualityPolicy: null },
    "an emptied stored quality policy clears",
  );
}

/** The RTU: three-valued on edit — untouched (absent), blank (`null`), chosen (uuid). */
export function runEditRtuTests(): void {
  const form = formFrom(LOADED);
  assert(form.rtuId === RTU_A, `the form seeds the stored RTU, got ${form.rtuId}`);
  assertBody(editBodyFrom(LOADED, { ...form, rtuId: "" }), { rtuId: null }, "(g) blank unwires");
  assertBody(editBodyFrom(LOADED, { ...form, rtuId: RTU_B }), { rtuId: RTU_B }, "(h) another RTU rewires");
  assertBody(editBodyFrom(LOADED, { ...form, engMax: "9" }), { engMax: 9 }, "(i) an untouched RTU is absent");
  const unwired = { ...LOADED, rtuId: null };
  assertBody(editBodyFrom(unwired, formFrom(unwired)), {}, "an unwired row left blank sends no rtuId");
}

/**
 * The form seeds from the row's **own** five, never the effective value: a
 * seeded template default would turn into an override on the next save.
 */
export function runFormSeedTests(): void {
  const form = formFrom(LOADED);
  assert(form.engMin === "5", `own engMin seeds the box, got ${form.engMin}`);
  assert(form.engMax === "", `an inherited engMax leaves the box empty, got ${form.engMax}`);
  assert(form.scaleMultiplier === "", `an inherited multiplier leaves the box empty, got ${form.scaleMultiplier}`);
  assert(form.qualityPolicy === "", `an inherited policy leaves the select empty, got ${form.qualityPolicy}`);
  assert(form.unit === "" && form.sensorCode === "S1", "null text fields read as an empty box");
}

/** A create omits every empty box, the RTU included; a chosen RTU is sent. */
export function runCreateBodyTests(): void {
  const form = { ...emptyAssetPointForm("asset-1"), pointKey: "power_kw", sourceDataKey: "RAW" };
  assertBody(
    createBodyFrom(form),
    { assetId: "asset-1", pointKey: "power_kw", sourceDataKey: "RAW" },
    "an empty create sends the three required fields only",
  );
  assertBody(
    createBodyFrom({
      ...form,
      rtuId: RTU_A,
      engMax: "100",
      engMin: "x",
      scaleMultiplier: "1.5",
      scaleOffset: "-2",
      qualityPolicy: "accept_bad",
      unit: "kW",
    }),
    {
      assetId: "asset-1",
      pointKey: "power_kw",
      sourceDataKey: "RAW",
      rtuId: RTU_A,
      engMax: 100,
      scaleMultiplier: 1.5,
      scaleOffset: -2,
      qualityPolicy: "accept_bad",
      unit: "kW",
    },
    "a create sends what was filled in, and drops a non-number",
  );
}
