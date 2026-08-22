import {
  computeTemplateVersionDelta,
  type StoredTemplatePoint,
} from "./template-version-delta";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const OPTIONS = { fromVersion: 1, toVersion: 2, assetCount: 3 };

function measured(pointKey: string, overrides: Partial<StoredTemplatePoint> = {}): StoredTemplatePoint {
  return {
    pointKey,
    kind: "measured",
    unit: null,
    sourceDataKeyPattern: `SITE/{asset_code}/${pointKey}`,
    required: true,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    ...overrides,
  };
}

function derived(pointKey: string, overrides: Partial<StoredTemplatePoint> = {}): StoredTemplatePoint {
  return {
    pointKey,
    kind: "derived",
    unit: null,
    sourceDataKeyPattern: null,
    required: true,
    formula: "{A} + {B}",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
    ...overrides,
  };
}

/** Nothing changed: an empty delta, and — the part that matters — no refusal. */
export function assertIdenticalVersionsProduceAnEmptyDelta(): void {
  const points = [measured("KW"), derived("KWH")];
  const delta = computeTemplateVersionDelta(points, points, OPTIONS);

  assert(delta.measuredAdded.length === 0, "no measured additions expected");
  assert(delta.measuredRemoved.length === 0, "no measured removals expected");
  assert(delta.measuredReKeyed.length === 0, "no re-keys expected");
  assert(delta.derivedAdded.length === 0, "no derived additions expected");
  assert(delta.derivedRemoved.length === 0, "no derived removals expected");
  assert(delta.derivedChanged.length === 0, "no derived changes expected");
  assert(delta.refusals.length === 0, "identical versions must never refuse");
  assert(
    delta.fromVersion === 1 && delta.toVersion === 2,
    "the delta must carry the two versions it describes",
  );
}

/**
 * **The regression D-4 exists to prevent.**
 *
 * `createDraftFrom` copies version N's points into fresh rows for N+1, so two
 * versions with identical point keys share no `template_points.id`. This
 * function must never see that. A fixture that reused ids would pass under an
 * id-keyed implementation, which is why the fixture below deliberately
 * constructs two *separate* arrays of structurally identical rows.
 */
export function assertDifferentRowIdentitiesWithSameKeysAreNoChange(): void {
  const versionOne = [measured("KW"), measured("VOLTAGE"), derived("KWH")];
  const versionTwo = [measured("KW"), measured("VOLTAGE"), derived("KWH")];
  assert(versionOne !== versionTwo, "the fixture must be two distinct arrays of distinct objects");

  const delta = computeTemplateVersionDelta(versionOne, versionTwo, OPTIONS);
  assert(
    delta.measuredRemoved.length === 0 && delta.measuredAdded.length === 0,
    "two versions with the same point keys are no change, however different their row " +
      "identities are — an id-keyed diff would report every point removed and re-added, " +
      "and decision 3 would then refuse every migration ever attempted",
  );
  assert(delta.refusals.length === 0, "and it must refuse nothing");
}

/** A measured point present in N and absent in N+1 refuses, naming the key. */
export function assertMeasuredRemovalRefuses(): void {
  const delta = computeTemplateVersionDelta([measured("KW"), measured("VOLTAGE")], [measured("KW")], OPTIONS);

  assert(delta.measuredRemoved.length === 1, `expected 1 removal, got ${delta.measuredRemoved.length}`);
  assert(delta.measuredRemoved[0]?.pointKey === "VOLTAGE", "the removal must name the point key");
  assert(delta.refusals.length === 1, `expected exactly 1 refusal, got ${delta.refusals.length}`);
  assert(delta.refusals[0]?.reason === "measured_removed", "the reason must be measured_removed");
  assert(delta.refusals[0]?.pointKey === "VOLTAGE", "the refusal must name the point key");
  assert(
    delta.refusals[0]?.assetCount === 3,
    `the refusal must carry the caller's asset count, got ${String(delta.refusals[0]?.assetCount)}`,
  );
  assert(
    delta.refusals[0]?.message.includes("VOLTAGE") === true,
    "the message must name the point key — it is what an operator reads",
  );
}

/** A changed `source_data_key_pattern` refuses, naming both patterns. */
export function assertMeasuredReKeyRefuses(): void {
  const before = [measured("KW", { sourceDataKeyPattern: "OLD/{asset_code}/KW" })];
  const after = [measured("KW", { sourceDataKeyPattern: "NEW/{asset_code}/KW" })];
  const delta = computeTemplateVersionDelta(before, after, OPTIONS);

  assert(delta.measuredReKeyed.length === 1, `expected 1 re-key, got ${delta.measuredReKeyed.length}`);
  assert(
    delta.measuredReKeyed[0]?.fromSourceDataKeyPattern === "OLD/{asset_code}/KW" &&
      delta.measuredReKeyed[0]?.toSourceDataKeyPattern === "NEW/{asset_code}/KW",
    "the entry must carry both patterns",
  );
  assert(delta.refusals.length === 1, "a re-key is exactly one refusal");
  assert(delta.refusals[0]?.reason === "measured_rekeyed", "the reason must be measured_rekeyed");
  assert(
    delta.refusals[0]?.message.includes("OLD/{asset_code}/KW") === true &&
      delta.refusals[0]?.message.includes("NEW/{asset_code}/KW") === true,
    "the message must name both patterns — 'the pattern changed' is not actionable on its own",
  );
  assert(delta.measuredRemoved.length === 0, "a re-key is not also a removal");
}

/** A measured point added in N+1 is reported and does **not** refuse. */
export function assertMeasuredAdditionDoesNotRefuse(): void {
  const delta = computeTemplateVersionDelta(
    [measured("KW")],
    [measured("KW"), measured("CURRENT", { required: false })],
    OPTIONS,
  );

  assert(delta.measuredAdded.length === 1, `expected 1 addition, got ${delta.measuredAdded.length}`);
  assert(delta.measuredAdded[0]?.pointKey === "CURRENT", "the addition must name the point key");
  assert(
    delta.measuredAdded[0]?.required === false,
    "the addition must carry `required` — Q-A refuses the migration when a REQUIRED " +
      "addition's pattern will not resolve, and skips an optional one",
  );
  assert(
    delta.measuredAdded[0]?.sourceDataKeyPattern === "SITE/{asset_code}/CURRENT",
    "the addition must carry the pattern the row will be built from",
  );
  assert(
    delta.measuredAdded[0]?.unit === null,
    "the addition must carry the template's unit override — null here means 'use the catalog'",
  );
  assert(delta.refusals.length === 0, "a measured addition migrates freely (decision 4)");
}

/**
 * Derived changes in every combination are reported and never refuse.
 *
 * The per-field assertion is the point: `changedFields` is what a confirming
 * operator reads, and "interval 60 -> 300, formula unchanged" is a different
 * decision from "both changed".
 */
export function assertDerivedChangesAreReportedNeverRefused(): void {
  const before = [
    derived("KWH"),
    derived("PF", { formula: "{A}" }),
    derived("GONE"),
    derived("TRIG", { calcTrigger: "streaming", calcIntervalSeconds: null }),
  ];
  const after = [
    // all five moved
    derived("KWH", {
      formula: "{A} * {B}",
      formulaDialect: "bms-calc-v1",
      calcTrigger: "streaming",
      calcIntervalSeconds: null,
      maxInputAgeSeconds: 30,
    }),
    // one moved
    derived("PF", { formula: "{A} / 2" }),
    // added
    derived("NEW"),
    // trigger only
    derived("TRIG", { calcTrigger: "scheduled", calcIntervalSeconds: 120 }),
  ];

  const delta = computeTemplateVersionDelta(before, after, OPTIONS);

  assert(
    delta.refusals.length === 0,
    `derived changes must never refuse, got ${delta.refusals.length}: ` +
      delta.refusals.map((r) => r.reason).join(", "),
  );

  const kwh = delta.derivedChanged.find((c) => c.pointKey === "KWH");
  assert(kwh !== undefined, "the fully-changed point must be reported");
  assert(
    kwh?.changedFields.length === 4,
    `KWH changed formula, calcTrigger, calcIntervalSeconds and maxInputAgeSeconds — ` +
      `expected 4 changed fields, got ${String(kwh?.changedFields.length)} ` +
      `(${kwh?.changedFields.join(", ")}). formulaDialect is the same literal in both.`,
  );
  assert(kwh?.from.calcIntervalSeconds === 60 && kwh?.to.calcIntervalSeconds === null,
    "the entry must carry both sides of every value, not just the names of what moved");

  const pf = delta.derivedChanged.find((c) => c.pointKey === "PF");
  assert(
    pf?.changedFields.length === 1 && pf?.changedFields[0] === "formula",
    `a single-field change must report exactly that field, got ${String(pf?.changedFields)}`,
  );

  const trig = delta.derivedChanged.find((c) => c.pointKey === "TRIG");
  assert(
    trig?.changedFields.includes("calcTrigger") === true &&
      trig?.changedFields.includes("calcIntervalSeconds") === true,
    "streaming -> scheduled moves the interval too, and both must be reported",
  );

  assert(
    delta.derivedRemoved.length === 1 && delta.derivedRemoved[0]?.pointKey === "GONE",
    "a derived removal must be reported",
  );
  assert(
    delta.derivedAdded.length === 1 && delta.derivedAdded[0]?.pointKey === "NEW",
    "a derived addition must be reported",
  );
  assert(
    delta.derivedRemoved[0]?.from.formula === "{A} + {B}",
    "a derived removal must carry what is being lost",
  );
}

/**
 * A `kind` flip, both directions, asserted explicitly rather than left to fall
 * out of the implementation.
 *
 * `measured -> derived` destroys the `asset_points` row ingest writes into, so
 * it is refused for the same reason a removal is. `derived -> measured` loses
 * only a computed value and gains wiring, so it is a derived removal plus a
 * measured addition, and does not refuse.
 */
export function assertKindFlipsAreClassifiedExplicitly(): void {
  const toDerived = computeTemplateVersionDelta([measured("KW")], [derived("KW")], OPTIONS);
  assert(
    toDerived.measuredRemoved.length === 1 && toDerived.measuredRemoved[0]?.pointKey === "KW",
    "measured -> derived must be reported as a measured removal",
  );
  assert(
    toDerived.derivedAdded.length === 1 && toDerived.derivedAdded[0]?.pointKey === "KW",
    "measured -> derived must also be reported as a derived addition",
  );
  assert(
    toDerived.refusals.length === 1 && toDerived.refusals[0]?.reason === "measured_removed",
    "measured -> derived must refuse — it destroys the asset_points row ingest writes into",
  );
  assert(
    toDerived.refusals[0]?.message.includes("derived") === true,
    "the message must say the point became derived, not merely that it vanished",
  );

  const toMeasured = computeTemplateVersionDelta([derived("KW")], [measured("KW")], OPTIONS);
  assert(
    toMeasured.derivedRemoved.length === 1 && toMeasured.derivedRemoved[0]?.pointKey === "KW",
    "derived -> measured must be reported as a derived removal",
  );
  assert(
    toMeasured.measuredAdded.length === 1 && toMeasured.measuredAdded[0]?.pointKey === "KW",
    "derived -> measured must also be reported as a measured addition",
  );
  assert(
    toMeasured.refusals.length === 0,
    "derived -> measured must NOT refuse: nothing physical is destroyed, and decision 4 " +
      "creates the new asset_points row",
  );
}
