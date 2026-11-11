import {
  MAX_HEALTH_BANDS,
  MAX_HEALTH_WEIGHT,
  STANDARD_HEALTH_BANDS,
  templateHealthSchema,
} from "@bms/shared/contracts";
import type {
  AdminTemplatePointDto,
  TemplateHealth,
  TemplateHealthBand,
  TemplateVersionSummaryDto,
} from "@bms/shared";

import { UNSAFE_KEYS, type StoredTemplateContent } from "./template-content-merge";

/**
 * The Health tab's form rules (`F4.355`, ADR 0038 Amendment 7, ADR 0050
 * Amendment 4).
 *
 * The component holds the wiring; every rule that can be wrong is here, for the
 * reason `template-maintenance-form.ts` gives: `apps/web`'s coverage gate reaches
 * `src/lib/**` and nothing above it.
 *
 * ## Percent on screen, `0..1` on the wire
 *
 * `minScore` is stored in `0..1` (ADR 0050 Amendment 1 decision 2). The tab shows
 * and takes it in percent, and the conversion happens here and only here (B2).
 * Both directions go through `toPrecision(12)`, so `0.7` reads as `70` rather
 * than `70.00000000000001` and `57.5` writes `0.575` rather than a float neighbour.
 *
 * ## The shared schema is the authority
 *
 * Validation runs `templateHealthSchema` from `@bms/shared` — the schema the API
 * itself runs on a write — and only rewords its messages in percent. Nothing here
 * refuses what that schema accepts. The one check the schema cannot make (a
 * weight naming a point this template does not declare) is the server's, and its
 * refusal is shown verbatim; such a weight is kept and flagged (`declared: false`),
 * never dropped silently.
 *
 * ## A weight of 1 is not written
 *
 * An omitted weight is `1.0` (ADR 0050 Amendment 1 decision 3), so writing `1`
 * only adds a reference that `publish()` must check. An untouched tab therefore
 * stores no `weights` key at all (Amendment 7 B2).
 */

/** One band, as the DOM holds it. `minPercent` is text so an empty box and `0` differ. */
export type HealthBandRow = {
  code: string;
  label: string;
  minPercent: string;
  /**
   * The stored `minScore` this row was read from. While `minPercent` still reads
   * as this value rendered, the write sends it back unchanged, so a cut-point
   * with more than 12 significant digits is not rewritten by a save of another
   * field, and two stored cut-points that render alike stay distinct.
   */
  storedMinScore?: number;
};

/** One weight. `declared: false` is a stored weight whose key is no point on this version. */
export type HealthWeightRow = {
  pointKey: string;
  label: string;
  kind: string | null;
  weight: string;
  declared: boolean;
};

export type HealthForm = {
  bands: HealthBandRow[];
  weights: HealthWeightRow[];
  /** Set by "Remove health bands" after its confirm (B4); cleared by any edit. */
  removeBlock: boolean;
};

/** What a save would do to `content.health`. */
export type HealthWrite =
  | { kind: "none" }
  | { kind: "remove" }
  | { kind: "set"; value: TemplateHealth };

export type HealthFormProblem = {
  section: "bands" | "weights";
  /** Row index in `form.bands` / `form.weights`, or `null` for the whole section. */
  row: number | null;
  field: "code" | "label" | "minPercent" | "weight" | null;
  message: string;
};

export { MAX_HEALTH_BANDS, MAX_HEALTH_WEIGHT };

/**
 * A plain decimal, optionally with an exponent. The exponent is accepted because
 * `String(number)` writes one below `1e-6`, and a value this module rendered must
 * parse back (code review, F4.355 PR 2). Hex, `Infinity` and `NaN` are refused.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** `0.95` → `"95"`, `0.575` → `"57.5"`. A non-finite value reads as an empty box. */
export function minScoreToPercentText(minScore: number): string {
  if (!Number.isFinite(minScore)) {
    return "";
  }
  return String(Number((minScore * 100).toPrecision(12)));
}

/** `"95"` → `0.95`. `null` for an empty box or anything that is not a plain decimal. */
export function percentTextToMinScore(text: string): number | null {
  const percent = parseDecimal(text);
  return percent === null ? null : Number((percent / 100).toPrecision(12));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The stored `health` block, read loosely from the `z.record(z.unknown())`
 * content (a row may predate ADR 0019). `undefined` when there is none.
 */
export function storedHealth(content: StoredTemplateContent): TemplateHealth | undefined {
  const health = content.health;
  if (!isRecord(health)) {
    return undefined;
  }
  const bands: TemplateHealthBand[] = Array.isArray(health.bands)
    ? health.bands.filter(isRecord).map((band) => ({
        code: typeof band.code === "string" ? band.code : "",
        label: typeof band.label === "string" ? band.label : "",
        minScore: typeof band.minScore === "number" ? band.minScore : Number.NaN,
      }))
    : [];
  const result: TemplateHealth = { bands };
  if (isRecord(health.weights)) {
    const weights: Record<string, number> = {};
    for (const key of Object.keys(health.weights)) {
      const weight = health.weights[key];
      if (!UNSAFE_KEYS.includes(key) && typeof weight === "number") {
        weights[key] = weight;
      }
    }
    result.weights = weights;
  }
  return result;
}

/** Whether a version's content carries at least one health band (B6). */
export function contentHasHealthBands(content: StoredTemplateContent): boolean {
  const health = content.health;
  return isRecord(health) && Array.isArray(health.bands) && health.bands.length > 0;
}

type WeightedPoint = Pick<AdminTemplatePointDto, "pointKey" | "label" | "kind">;

/** The form for a stored block: one weight row per point (default `"1"`), then any undeclared weight. */
export function healthFormFrom(
  stored: TemplateHealth | undefined,
  points: readonly WeightedPoint[],
): HealthForm {
  const bands = (stored?.bands ?? []).map((band) => ({
    code: band.code,
    label: band.label,
    minPercent: minScoreToPercentText(band.minScore),
    storedMinScore: band.minScore,
  }));
  const storedWeights = stored?.weights ?? {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(storedWeights, key);
  const pointKeys = new Set(points.map((point) => point.pointKey));
  const weights: HealthWeightRow[] = points.map((point) => ({
    pointKey: point.pointKey,
    label: point.label ?? point.pointKey,
    kind: point.kind,
    weight: has(point.pointKey) ? String(storedWeights[point.pointKey]) : "1",
    declared: true,
  }));
  for (const key of Object.keys(storedWeights)) {
    if (!pointKeys.has(key)) {
      weights.push({
        pointKey: key,
        label: key,
        kind: null,
        weight: String(storedWeights[key]),
        declared: false,
      });
    }
  }
  return { bands, weights, removeBlock: false };
}

/** The five standard bands as rows — only ever on a click (ADR 0050 Amendment 4). */
export function standardHealthBandRows(): HealthBandRow[] {
  return STANDARD_HEALTH_BANDS.map((band) => ({
    code: band.code,
    label: band.label,
    minPercent: minScoreToPercentText(band.minScore),
  }));
}

/** An empty row for "Add a band". */
export function blankHealthBandRow(): HealthBandRow {
  return { code: "", label: "", minPercent: "" };
}

/** A copy with row `index` moved one place up (`-1`) or down (`1`); unchanged at an edge. */
export function moveHealthBand(
  rows: readonly HealthBandRow[],
  index: number,
  direction: -1 | 1,
): HealthBandRow[] {
  const next = [...rows];
  const target = index + direction;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  const moving = next[index] as HealthBandRow;
  next[index] = next[target] as HealthBandRow;
  next[target] = moving;
  return next;
}

/** The weights a save writes: every parseable weight other than exactly 1. */
function writtenWeights(rows: readonly HealthWeightRow[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const row of rows) {
    if (UNSAFE_KEYS.includes(row.pointKey)) {
      continue;
    }
    const weight = parseDecimal(row.weight);
    // An unparseable weight is written as NaN so the schema refuses it at its
    // own path; `healthFormErrors` words that refusal.
    const value = weight ?? Number.NaN;
    if (value !== 1) {
      weights[row.pointKey] = value;
    }
  }
  return weights;
}

/** The row's cut-point: the stored value while its text is unedited, else the typed one. */
function rowMinScore(band: HealthBandRow): number {
  if (
    band.storedMinScore !== undefined &&
    band.minPercent === minScoreToPercentText(band.storedMinScore)
  ) {
    return band.storedMinScore;
  }
  return percentTextToMinScore(band.minPercent) ?? Number.NaN;
}

/** What a save sends. A `set` value may be invalid; `healthFormErrors` says why. */
export function healthWriteFrom(form: HealthForm): HealthWrite {
  if (form.removeBlock) {
    return { kind: "remove" };
  }
  const weights = writtenWeights(form.weights);
  const hasWeights = Object.keys(weights).length > 0;
  if (form.bands.length === 0 && !hasWeights) {
    return { kind: "none" };
  }
  const value: TemplateHealth = {
    bands: form.bands.map((band) => ({
      code: band.code,
      label: band.label,
      minScore: rowMinScore(band),
    })),
  };
  if (hasWeights) {
    value.weights = weights;
  }
  return { kind: "set", value };
}

function percentOf(value: unknown): string {
  return typeof value === "number" ? `${minScoreToPercentText(value)}%` : "?";
}

/**
 * Every reason the form cannot be saved, worded in percent.
 *
 * `stored` is the block the version holds now: emptying every band of a stored
 * block is not a removal (that is B4's button, behind a confirm), so it is named
 * here rather than saved as nothing.
 */
export function healthFormErrors(
  form: HealthForm,
  stored?: TemplateHealth,
): HealthFormProblem[] {
  const write = healthWriteFrom(form);
  if (write.kind === "remove") {
    return [];
  }
  if (write.kind === "none") {
    return stored === undefined
      ? []
      : [
          {
            section: "bands",
            row: null,
            field: null,
            message:
              "Add at least one band, or use Remove health bands to clear the health block.",
          },
        ];
  }

  const problems: HealthFormProblem[] = [];
  const taken = new Set<string>();
  const add = (problem: HealthFormProblem) => {
    const key = `${problem.section}|${problem.row}|${problem.field}`;
    if (!taken.has(key)) {
      taken.add(key);
      problems.push(problem);
    }
  };

  form.bands.forEach((band, row) => {
    if (Number.isNaN(rowMinScore(band))) {
      add({
        section: "bands",
        row,
        field: "minPercent",
        message: "Enter the minimum score as a percent between 0 and 100, for example 85.",
      });
    }
  });
  form.weights.forEach((weight, row) => {
    if (parseDecimal(weight.weight) === null) {
      add({
        section: "weights",
        row,
        field: "weight",
        message: `Enter a weight greater than 0 and at most ${MAX_HEALTH_WEIGHT}.`,
      });
    }
  });

  // With nothing stored there is nothing to remove, so only offer it when there is.
  const addABand =
    stored === undefined
      ? "Add at least one band."
      : "Add at least one band, or use Remove health bands to clear the health block.";

  const parsed = templateHealthSchema.safeParse(write.value);
  if (parsed.success) {
    return problems;
  }
  const bands = write.value.bands;
  for (const issue of parsed.error.issues) {
    const [section, index, field] = issue.path;
    if (section === "bands") {
      if (typeof index !== "number") {
        add({
          section: "bands",
          row: null,
          field: null,
          message:
            issue.code === "too_small"
              ? addABand
              : issue.code === "too_big"
                ? `At most ${MAX_HEALTH_BANDS} bands.`
                : issue.message,
        });
        continue;
      }
      if (field === "minScore") {
        const band = bands[index];
        const previous = bands[index - 1];
        const message =
          issue.code === "custom" && issue.message.includes("must start at 0")
            ? `The lowest band must start at 0% so every score lands in a band; it starts at ${percentOf(band?.minScore)}.`
            : issue.code === "custom"
              ? `This band starts at ${percentOf(band?.minScore)}, which is not below the band above it (${percentOf(previous?.minScore)}). Bands must descend.`
              : "Enter a minimum score between 0% and 100%.";
        add({ section: "bands", row: index, field: "minPercent", message });
        continue;
      }
      if (field === "code" || field === "label") {
        const message =
          issue.code === "custom"
            ? `Another band already uses the code "${bands[index]?.code ?? ""}".`
            : issue.code === "too_small"
              ? `Enter a ${field}.`
              : issue.code === "too_big"
                ? `At most ${"maximum" in issue ? String(issue.maximum) : "the allowed number of"} characters.`
                : issue.message;
        add({ section: "bands", row: index, field, message });
        continue;
      }
      add({ section: "bands", row: index, field: null, message: issue.message });
      continue;
    }
    if (section === "weights") {
      const row =
        typeof index === "string" ? form.weights.findIndex((weight) => weight.pointKey === index) : -1;
      // A record's key and value issues share the path `["weights", key]`, so
      // only a numeric-range or type refusal is about the weight itself; a key
      // refusal (an empty or over-long point key) keeps the schema's message.
      const aboutTheValue =
        issue.code === "invalid_type" ||
        ((issue.code === "too_small" || issue.code === "too_big") && issue.type === "number");
      add({
        section: "weights",
        row: row >= 0 ? row : null,
        field: row >= 0 ? "weight" : null,
        message:
          row >= 0 && aboutTheValue
            ? `Enter a weight greater than 0 and at most ${MAX_HEALTH_WEIGHT}.`
            : issue.message,
      });
      continue;
    }
    add({ section: "bands", row: null, field: null, message: issue.message });
  }
  return problems;
}

function comparable(write: HealthWrite): string {
  return write.kind === "set" ? JSON.stringify(write.value) : write.kind;
}

/**
 * Whether a save would change anything. Compared against the stored block as
 * this form would write it back, so an untouched tab is clean even when the
 * stored block carries weights of 1 or a band the form normalises.
 */
export function healthHasChanged(
  form: HealthForm,
  stored: TemplateHealth | undefined,
  points: readonly WeightedPoint[],
): boolean {
  const write = healthWriteFrom(form);
  if (stored === undefined) {
    return write.kind === "set";
  }
  if (write.kind === "remove") {
    return true;
  }
  return comparable(write) !== comparable(healthWriteFrom(healthFormFrom(stored, points)));
}

export type OtherVersionsHoldingAssets = {
  total: number;
  versions: { version: number; assetCount: number }[];
};

/** Assets on other versions of this code, oldest version first (B5). */
export function otherVersionsHoldingAssets(
  versions: readonly Pick<TemplateVersionSummaryDto, "id" | "version" | "assetCount">[],
  currentId: string,
): OtherVersionsHoldingAssets {
  const held = versions
    .filter((entry) => entry.id !== currentId && entry.assetCount > 0)
    .map((entry) => ({ version: entry.version, assetCount: entry.assetCount }))
    .sort((a, b) => a.version - b.version);
  return { total: held.reduce((sum, entry) => sum + entry.assetCount, 0), versions: held };
}
