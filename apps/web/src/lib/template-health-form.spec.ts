/**
 * The Health tab's form rules (`F4.355`, ADR 0038 Amendment 7, ADR 0050
 * Amendment 4). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
import { templateHealthSchema } from "@bms/shared/contracts";
import type { TemplateHealth } from "@bms/shared";

import {
  blankHealthBandRow,
  contentHasHealthBands,
  healthFormErrors,
  healthFormFrom,
  healthHasChanged,
  healthWriteFrom,
  minScoreToPercentText,
  moveHealthBand,
  otherVersionsHoldingAssets,
  percentTextToMinScore,
  standardHealthBandRows,
  storedHealth,
  type HealthForm,
} from "./template-health-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message}\n  expected ${e}\n  received ${a}`);
}

const POINTS = [
  { pointKey: "flow_rate", label: "Flow rate", kind: "measured" },
  { pointKey: "run_status", label: null, kind: "measured" },
  { pointKey: "efficiency", label: "Efficiency", kind: "derived" },
] as const;

const FIVE: TemplateHealth = {
  bands: [
    { code: "excellent", label: "Excellent", minScore: 0.95 },
    { code: "good", label: "Good", minScore: 0.85 },
    { code: "fair", label: "Fair", minScore: 0.7 },
    { code: "poor", label: "Poor", minScore: 0.5 },
    { code: "critical", label: "Critical", minScore: 0 },
  ],
};

function formWith(bands: HealthForm["bands"], weights?: Record<string, string>): HealthForm {
  const form = healthFormFrom(undefined, POINTS);
  return {
    bands,
    weights: form.weights.map((row) =>
      weights && row.pointKey in weights ? { ...row, weight: weights[row.pointKey] as string } : row,
    ),
    removeBlock: false,
  };
}

const band = (code: string, minPercent: string, label = code) => ({ code, label, minPercent });

export function runPercentRoundTripTests(): void {
  for (const [score, text] of [
    [0.95, "95"],
    [0.85, "85"],
    [0.7, "70"],
    [0.5, "50"],
    [0, "0"],
    [0.575, "57.5"],
    [0.999, "99.9"],
    [0.123456, "12.3456"],
  ] as const) {
    same(minScoreToPercentText(score), text, `${score} shows as ${text}`);
    same(percentTextToMinScore(text), score, `${text} stores as ${score}`);
    same(percentTextToMinScore(minScoreToPercentText(score)), score, `${score} round trips`);
  }
  same(minScoreToPercentText(0.07), "7", "no float noise on 0.07 * 100");
  same(percentTextToMinScore("7"), 0.07, "no float noise on 7 / 100");
  same(minScoreToPercentText(Number.NaN), "", "a non-finite score reads as an empty box");
}

export function runPercentTextRefusalTests(): void {
  for (const text of ["", "   ", "abc", "e2", "1e", "0x10", "Infinity", "NaN", "5%", "1.2.3"]) {
    assert(percentTextToMinScore(text) === null, `"${text}" is not a percent`);
  }
  same(percentTextToMinScore(" 85 "), 0.85, "surrounding spaces are ignored");
  same(percentTextToMinScore(".5"), 0.005, "a bare fraction parses");
  same(percentTextToMinScore("1e-7"), 1e-9, "exponent text parses, so a value String() writes reads back");
  same(minScoreToPercentText(1e-9), "1e-7", "a tiny score shows as String() writes it");
}

export function runStoredHealthTests(): void {
  assert(storedHealth({}) === undefined, "no health key reads as undefined");
  assert(storedHealth({ health: null }) === undefined, "a null block reads as undefined");
  assert(storedHealth({ health: [1] }) === undefined, "an array block reads as undefined");
  same(storedHealth({ health: FIVE }), FIVE, "a valid block reads back as stored");
  same(
    storedHealth({ health: { bands: [{ code: 1, minScore: "x" }, 7] } }),
    { bands: [{ code: "", label: "", minScore: null }] },
    "malformed band fields read as empty / NaN, non-objects are skipped",
  );
  const polluted = JSON.parse('{"bands":[],"weights":{"__proto__":2,"flow_rate":3,"run_status":"x"}}');
  assert(Object.hasOwn(polluted.weights, "__proto__"), "fixture holds an own __proto__");
  same(storedHealth({ health: polluted }), { bands: [], weights: { flow_rate: 3 } }, "unsafe and non-number weights are not read");
  same(storedHealth({ health: { weights: {} } }), { bands: [], weights: {} }, "a block without bands reads empty");
}

export function runContentHasHealthBandsTests(): void {
  assert(contentHasHealthBands({ health: FIVE }), "five bands");
  assert(!contentHasHealthBands({}), "no health key");
  assert(!contentHasHealthBands({ health: { bands: [] } }), "an empty band list");
  assert(!contentHasHealthBands({ health: { weights: { flow_rate: 2 } } }), "weights only");
  assert(!contentHasHealthBands({ health: "x" }), "a non-object block");
}

export function runFormFromStoredTests(): void {
  const form = healthFormFrom({ ...FIVE, weights: { flow_rate: 2.5, ghost_tag: 4 } }, POINTS);
  same(
    form.bands.map((row) => row.minPercent),
    ["95", "85", "70", "50", "0"],
    "bands show in percent",
  );
  same(
    form.weights,
    [
      { pointKey: "flow_rate", label: "Flow rate", kind: "measured", weight: "2.5", declared: true },
      { pointKey: "run_status", label: "run_status", kind: "measured", weight: "1", declared: true },
      { pointKey: "efficiency", label: "Efficiency", kind: "derived", weight: "1", declared: true },
      { pointKey: "ghost_tag", label: "ghost_tag", kind: null, weight: "4", declared: false },
    ],
    "one row per point (default 1), then the undeclared weight kept and flagged",
  );
  assert(!form.removeBlock, "a fresh form never removes");
  same(healthFormFrom(undefined, []), { bands: [], weights: [], removeBlock: false }, "nothing stored, no points");
}

export function runUndeclaredWeightIsNeverDroppedTests(): void {
  const form = healthFormFrom({ ...FIVE, weights: { ghost_tag: 4 } }, POINTS);
  const write = healthWriteFrom(form);
  assert(write.kind === "set", "a set write");
  same(write.kind === "set" ? write.value.weights : null, { ghost_tag: 4 }, "the undeclared weight is written back");
  same(healthFormErrors(form, FIVE), [], "the lib does not block it: the schema accepts it, the server decides");
}

export function runUntouchedIsCleanTests(): void {
  const cases: (TemplateHealth | undefined)[] = [
    undefined,
    FIVE,
    { ...FIVE, weights: { flow_rate: 2 } },
    { ...FIVE, weights: { flow_rate: 1, run_status: 1 } },
    { ...FIVE, weights: { ghost_tag: 3 } },
    { bands: [{ code: "x", label: "X", minScore: 0.333333333333333 }] },
  ];
  for (const stored of cases) {
    const form = healthFormFrom(stored, POINTS);
    assert(!healthHasChanged(form, stored, POINTS), `untouched is clean: ${JSON.stringify(stored)}`);
  }
}

export function runChangeDetectionTests(): void {
  const empty = healthFormFrom(undefined, POINTS);
  assert(
    healthHasChanged({ ...empty, bands: standardHealthBandRows() }, undefined, POINTS),
    "applying the preset to an empty draft is a change",
  );
  const stored = healthFormFrom(FIVE, POINTS);
  assert(
    healthHasChanged({ ...stored, removeBlock: true }, FIVE, POINTS),
    "removing a stored block is a change",
  );
  assert(
    !healthHasChanged({ ...empty, removeBlock: true }, undefined, POINTS),
    "removing nothing is not a change",
  );
  const edited = { ...stored, bands: stored.bands.map((row, i) => (i === 1 ? { ...row, minPercent: "80" } : row)) };
  assert(healthHasChanged(edited, FIVE, POINTS), "editing a cut-point is a change");
  const weighted = { ...stored, weights: stored.weights.map((row, i) => (i === 0 ? { ...row, weight: "3" } : row)) };
  assert(healthHasChanged(weighted, FIVE, POINTS), "editing a weight is a change");
  const emptied = { ...stored, bands: [] };
  assert(healthHasChanged(emptied, FIVE, POINTS), "emptying the bands of a stored block is a change");
}

export function runWeightOfOneIsNotWrittenTests(): void {
  const write = healthWriteFrom(formWith(standardHealthBandRows()));
  assert(write.kind === "set", "a set write");
  assert(
    write.kind === "set" && !Object.prototype.hasOwnProperty.call(write.value, "weights"),
    "all weights 1 → no weights key",
  );
  const mixed = healthWriteFrom(formWith(standardHealthBandRows(), { flow_rate: "2", run_status: "1.0", efficiency: "0.5" }));
  same(mixed.kind === "set" ? mixed.value.weights : null, { flow_rate: 2, efficiency: 0.5 }, "only weights other than 1 are written");
}

export function runWriteKindsTests(): void {
  same(healthWriteFrom(formWith([])), { kind: "none" }, "no bands and no weights writes nothing");
  same(healthWriteFrom({ ...formWith(standardHealthBandRows()), removeBlock: true }), { kind: "remove" }, "remove wins");
  same(
    healthWriteFrom(formWith(standardHealthBandRows())),
    { kind: "set", value: FIVE },
    "the preset writes the five bands in 0..1",
  );
  const weightsOnly = healthWriteFrom(formWith([], { flow_rate: "2" }));
  assert(weightsOnly.kind === "set", "weights without bands is still a set (so the schema can refuse it)");
}

export function runPresetTests(): void {
  same(
    standardHealthBandRows(),
    [
      { code: "excellent", label: "Excellent", minPercent: "95" },
      { code: "good", label: "Good", minPercent: "85" },
      { code: "fair", label: "Fair", minPercent: "70" },
      { code: "poor", label: "Poor", minPercent: "50" },
      { code: "critical", label: "Critical", minPercent: "0" },
    ],
    "the preset rows",
  );
  const first = standardHealthBandRows();
  first[0]!.label = "changed";
  same(standardHealthBandRows()[0]!.label, "Excellent", "each call is a fresh copy");
  same(blankHealthBandRow(), { code: "", label: "", minPercent: "" }, "a blank row");
}

export function runMoveTests(): void {
  const rows = [band("a", "90"), band("b", "50"), band("c", "0")];
  same(moveHealthBand(rows, 1, -1).map((r) => r.code), ["b", "a", "c"], "up");
  same(moveHealthBand(rows, 1, 1).map((r) => r.code), ["a", "c", "b"], "down");
  same(moveHealthBand(rows, 0, -1).map((r) => r.code), ["a", "b", "c"], "top cannot move up");
  same(moveHealthBand(rows, 2, 1).map((r) => r.code), ["a", "b", "c"], "bottom cannot move down");
  same(moveHealthBand(rows, 9, 1).map((r) => r.code), ["a", "b", "c"], "out of range is a copy");
  assert(moveHealthBand(rows, 0, 1) !== rows, "never the same array");
  same(rows.map((r) => r.code), ["a", "b", "c"], "the input is not mutated");
}

export function runRemoveTests(): void {
  const stored = healthFormFrom({ ...FIVE, weights: { flow_rate: 2 } }, POINTS);
  const removing = { ...stored, removeBlock: true };
  same(healthWriteFrom(removing), { kind: "remove" }, "remove writes a removal whatever the rows say");
  same(healthFormErrors(removing, FIVE), [], "a removal has nothing to validate");
  const broken = { ...removing, bands: [band("x", "abc")] };
  same(healthFormErrors(broken, FIVE), [], "even with broken rows");
}

type Problem = ReturnType<typeof healthFormErrors>[number];
const where = (problems: Problem[]) => problems.map((p) => `${p.section}:${p.row}:${p.field}`);

export function runSchemaRefusalTests(): void {
  const notDescending = healthFormErrors(formWith([band("a", "50"), band("b", "60"), band("c", "0")]));
  same(where(notDescending), ["bands:1:minPercent"], "not descending → the offending row");
  assert(/60%.*50%/.test(notDescending[0]!.message), `worded in percent: ${notDescending[0]!.message}`);

  const lastNotZero = healthFormErrors(formWith([band("a", "90"), band("b", "10")]));
  same(where(lastNotZero), ["bands:1:minPercent"], "last band not 0");
  assert(/0%.*10%/.test(lastNotZero[0]!.message), `worded in percent: ${lastNotZero[0]!.message}`);

  const duplicate = healthFormErrors(formWith([band("a", "90"), band("a", "0")]));
  same(where(duplicate), ["bands:1:code"], "duplicate code → second row's code");
  assert(duplicate[0]!.message.includes('"a"'), "names the code");

  same(where(healthFormErrors(formWith([band("", "0", "Only")]))), ["bands:0:code"], "empty code");
  same(where(healthFormErrors(formWith([{ code: "a", label: "", minPercent: "0" }]))), ["bands:0:label"], "empty label");
  same(where(healthFormErrors(formWith([band("a".repeat(65), "0")]))), ["bands:0:code"], "code too long");
  same(where(healthFormErrors(formWith([{ code: "a", label: "x".repeat(129), minPercent: "0" }]))), ["bands:0:label"], "label too long");
  same(where(healthFormErrors(formWith([band("a", "120"), band("b", "0")]))), ["bands:0:minPercent"], "above 100%");
  same(where(healthFormErrors(formWith([band("a", "-5")]))), ["bands:0:minPercent"], "below 0%");

  const unparsed = healthFormErrors(formWith([band("a", "abc"), band("b", "0")]));
  same(where(unparsed), ["bands:0:minPercent"], "an unparseable percent is one problem, not two");
  assert(unparsed[0]!.message.includes("percent"), "worded as a percent");

  const eleven = Array.from({ length: 11 }, (_, i) => band(`b${i}`, String(100 - i * 10)));
  same(where(healthFormErrors(formWith(eleven))), ["bands:null:null"], "more than ten bands");

  same(where(healthFormErrors(formWith([], { flow_rate: "2" }))), ["bands:null:null"], "weights without bands");

  same(where(healthFormErrors(formWith(standardHealthBandRows(), { flow_rate: "0" }))), ["weights:0:weight"], "weight 0");
  same(where(healthFormErrors(formWith(standardHealthBandRows(), { run_status: "1001" }))), ["weights:1:weight"], "weight above 1000");
  same(where(healthFormErrors(formWith(standardHealthBandRows(), { efficiency: "x" }))), ["weights:2:weight"], "weight not a number");

  same(healthFormErrors(formWith(standardHealthBandRows())), [], "the preset is valid");
  same(healthFormErrors(formWith([])), [], "an empty draft with nothing stored is not an error");
  same(
    where(healthFormErrors(formWith([]), FIVE)),
    ["bands:null:null"],
    "emptying a stored block is named, not saved as nothing",
  );
}

/** The lib accepts exactly what the shared schema accepts, over a fixture table. */
export function runAgreesWithTheSchemaTests(): void {
  const fixtures: HealthForm[] = [
    formWith(standardHealthBandRows()),
    formWith([band("only", "0")]),
    formWith([band("a", "99.99"), band("b", "0.01"), band("c", "0")]),
    formWith([band("a", "50"), band("b", "50"), band("c", "0")]),
    formWith([band("a", "100"), band("b", "0")]),
    formWith([band("a", "100.5"), band("b", "0")]),
    formWith([band("a", "0"), band("b", "0")]),
    formWith([band("a", "60"), band("A", "0")]),
    formWith([band("a", "60"), band("a", "0")]),
    formWith([band(" ", "0")]),
    formWith(standardHealthBandRows(), { flow_rate: "1000" }),
    formWith(standardHealthBandRows(), { flow_rate: "0.001" }),
    formWith(standardHealthBandRows(), { flow_rate: "-1" }),
    formWith(Array.from({ length: 10 }, (_, i) => band(`b${i}`, String(90 - i * 10)))),
  ];
  for (const form of fixtures) {
    const write = healthWriteFrom(form);
    assert(write.kind === "set", "every fixture is a set write");
    if (write.kind !== "set") continue;
    const schemaOk = templateHealthSchema.safeParse(write.value).success;
    const libOk = healthFormErrors(form).length === 0;
    assert(schemaOk === libOk, `lib and schema disagree on ${JSON.stringify(form.bands)} / ${JSON.stringify(write.value.weights)}`);
  }
}

export function runOtherVersionsHoldingAssetsTests(): void {
  const versions = [
    { id: "v3", version: 3, status: "published" as const, assetCount: 0 },
    { id: "v2", version: 2, status: "archived" as const, assetCount: 7 },
    { id: "v1", version: 1, status: "published" as const, assetCount: 3 },
  ];
  same(
    otherVersionsHoldingAssets(versions, "v3"),
    { total: 10, versions: [{ version: 1, assetCount: 3 }, { version: 2, assetCount: 7 }] },
    "the newest published version: other versions with assets, oldest first",
  );
  same(
    otherVersionsHoldingAssets(versions, "v1"),
    { total: 0, versions: [] },
    "an older published version never invites a migration back to it (v3 is newer)",
  );
  // Positive twin of the rule above: a newer DRAFT or ARCHIVED version does not
  // count, so v2 here is the newest published version and the hint shows.
  same(
    otherVersionsHoldingAssets(
      [
        { id: "v4", version: 4, status: "draft" as const, assetCount: 0 },
        { id: "v3", version: 3, status: "archived" as const, assetCount: 5 },
        { id: "v2", version: 2, status: "published" as const, assetCount: 0 },
        { id: "v1", version: 1, status: "published" as const, assetCount: 3 },
      ],
      "v2",
    ),
    { total: 8, versions: [{ version: 1, assetCount: 3 }, { version: 3, assetCount: 5 }] },
    "a newer draft or archived version does not hide the hint; the current version is never counted",
  );
  same(
    otherVersionsHoldingAssets([{ id: "v1", version: 1, status: "published" as const, assetCount: 4 }], "v1"),
    { total: 0, versions: [] },
    "only the current version → nothing",
  );
  same(otherVersionsHoldingAssets([], "x"), { total: 0, versions: [] }, "no versions");
}

/**
 * The other direction, which `runAgreesWithTheSchemaTests` cannot reach: a
 * stored block the schema accepts must open clean, and one it refuses must not.
 * Code review found the first two rows: a tiny value reads back in exponent
 * text, and two cut-points closer than 12 significant digits render alike.
 */
export function runStoredBlockAgreesWithTheSchemaTests(): void {
  const stored: TemplateHealth[] = [
    FIVE,
    { bands: [{ code: "a", label: "A", minScore: 0.5 }, { code: "b", label: "B", minScore: 1e-9 }, { code: "c", label: "C", minScore: 0 }] },
    { bands: [{ code: "a", label: "A", minScore: 0.5000000000001 }, { code: "b", label: "B", minScore: 0.5 }, { code: "c", label: "C", minScore: 0 }] },
    { ...FIVE, weights: { flow_rate: 1e-7 } },
    { ...FIVE, weights: { flow_rate: 999.9999999999999 } },
    { bands: [{ code: "a", label: "A", minScore: 0.5 }, { code: "b", label: "B", minScore: 0.5 }] },
    { ...FIVE, weights: { flow_rate: 0 } },
  ];
  for (const block of stored) {
    const schemaOk = templateHealthSchema.safeParse(block).success;
    const form = healthFormFrom(block, POINTS);
    const libOk = healthFormErrors(form, block).length === 0;
    assert(schemaOk === libOk, `stored ${JSON.stringify(block)}: schema ${schemaOk}, lib ${libOk}`);
    assert(!healthHasChanged(form, block, POINTS), `untouched is clean: ${JSON.stringify(block)}`);
  }
  const close = stored[2]!;
  const write = healthWriteFrom(healthFormFrom(close, POINTS));
  same(
    write.kind === "set" ? write.value.bands.map((band) => band.minScore) : null,
    [0.5000000000001, 0.5, 0],
    "an unedited cut-point is written back exactly as stored",
  );
  const edited = healthFormFrom(close, POINTS);
  edited.bands[0] = { ...edited.bands[0]!, minPercent: "60" };
  const editedWrite = healthWriteFrom(edited);
  same(
    editedWrite.kind === "set" ? editedWrite.value.bands[0]!.minScore : null,
    0.6,
    "an edited cut-point takes the typed value",
  );
}

/** A refusal of a weight's key is not reworded as a refusal of its value. */
export function runWeightKeyRefusalKeepsTheSchemaMessageTests(): void {
  const stored: TemplateHealth = { ...FIVE, weights: { "": 2 } };
  const problems = healthFormErrors(healthFormFrom(stored, POINTS), stored);
  assert(problems.length === 1, `one problem, got ${JSON.stringify(problems)}`);
  assert(!problems[0]!.message.startsWith("Enter a weight"), `not worded as a value problem: ${problems[0]!.message}`);
}

/** With nothing stored there is nothing to remove, so the message does not offer it. */
export function runWeightsOnlyDraftWordingTests(): void {
  const problems = healthFormErrors(formWith([], { flow_rate: "2" }));
  same(where(problems), ["bands:null:null"], "weights without bands");
  assert(!problems[0]!.message.includes("Remove"), `no remove offered: ${problems[0]!.message}`);
}
