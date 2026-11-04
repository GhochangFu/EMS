/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — the rules behind a **standalone**
 * calculated point's panel and the asset list's batch wizard: a point on an
 * asset with no template, so nothing is inherited and every calc field is the
 * author's own (decision 1).
 *
 * Pure, and here rather than in the components, because the coverage gate
 * reaches `src/lib/**` and nothing above it (the `asset-point-calc-override.ts`
 * rule). The draft is the override panel's text draft — the same five fields,
 * so `PointCalcFormulaFields` / `PointCalcScheduleFields` edit it unchanged —
 * plus the key the point writes and the backfill choice.
 *
 * **One set of rules (decision 3).** `calcPointDraftProblems` is the API's own
 * `validateMergedCalcOverride` from `@bms/shared`, called the way
 * `CalcPointStandaloneService.validate` calls it: against an all-null
 * template, `declaredBy: "this asset"`, `inheritance: false`, over the key
 * lists {@link knownRefsFor} builds the way that service builds them. The
 * server stays the authority (scope, qualified codes, cycles); this is the
 * same sentence, earlier.
 */
import {
  CALC_DIALECT,
  CALC_DIALECTS,
  CALC_POINT_BATCH_MAX_ASSETS,
  CALC_TRIGGERS,
  validateMergedCalcOverride,
} from "@bms/shared";
import type {
  AdminAssetDto,
  AdminAssetPointDto,
  AssetPointCalcConfigDto,
  AssetPointCalcOverrideFields,
  CalcBackfillRunDto,
  CalcPointSetBody,
} from "@bms/shared";
import { calcPointBatchRefusedResponseSchema } from "@bms/shared/contracts";

import { draftFromFields, type OverrideDraft } from "./asset-point-calc-override";
import type { FormulaPoint } from "./template-formula-validation";

/** The override draft's five text fields, the catalog key, and the backfill days as text (`""` = none). */
export type CalcPointDraft = OverrideDraft & { readonly pointKey: string; readonly backfillDays: string };

/** The backfill select's choices after "none" (ADR 0109 decision 7: 1–31 days). */
export const BACKFILL_DAY_CHOICES: readonly number[] = [1, 7, 14, 31];

/**
 * A new point's draft. Grammar and Runs open on a value, never on `""`: a
 * standalone select has no `inherit (…)` option, so an empty value would show
 * the first option while the draft held nothing.
 */
export function emptyCalcPointDraft(pointKey = ""): CalcPointDraft {
  return {
    pointKey,
    formula: "",
    formulaDialect: CALC_DIALECT,
    calcTrigger: "scheduled",
    calcIntervalSeconds: "",
    maxInputAgeSeconds: "",
    backfillDays: "",
  };
}

/** The dialect the draft is written in — the Grammar select's value, never `""` on a standalone point. */
export function draftDialect(draft: CalcPointDraft): (typeof CALC_DIALECTS)[number] {
  return CALC_DIALECTS.find((known) => known === draft.formulaDialect) ?? CALC_DIALECT;
}

/**
 * The wizard's `dirty` (F3.85's leave prompt): the draft differs from the one
 * the form opened on. The shell sees a bubbled `change` only from an input,
 * a textarea or a select; the formula editor is CodeMirror's contenteditable,
 * so a formula-only edit is caught here or nowhere.
 */
export function calcPointDraftChanged(draft: CalcPointDraft, start: CalcPointDraft): boolean {
  return (Object.keys(start) as (keyof CalcPointDraft)[]).some((field) => draft[field] !== start[field]);
}

/** An edit opens on what the point runs (`effective` equals `override` on a standalone item). */
export function calcPointDraftFromConfig(config: AssetPointCalcConfigDto): CalcPointDraft {
  return { ...draftFromFields(config.effective), pointKey: config.pointKey, backfillDays: "" };
}

/** The draft for a wizard's typed values (a copilot fill included) — the inverse of {@link draftToCalcPointBody}. */
export function calcPointDraftFromFields(fields: Readonly<Record<string, unknown>>, pointKey: string): CalcPointDraft {
  const days = fields.backfillDays;
  return {
    ...draftFromFields(fields),
    pointKey,
    backfillDays: typeof days === "number" && Number.isInteger(days) ? String(days) : "",
  };
}

/**
 * The body `calcPointSetBodySchema` parses, from the text draft. A field left
 * empty is **absent** (the wizard asks for it), except the interval, whose
 * `null` is the legal value of a streaming point; no backfill is absent.
 */
export function draftToCalcPointBody(draft: CalcPointDraft): Partial<CalcPointSetBody> {
  const formula = draft.formula.trim();
  const interval = draft.calcIntervalSeconds.trim();
  const maxAge = draft.maxInputAgeSeconds.trim();
  const days = draft.backfillDays.trim();
  const body: Partial<CalcPointSetBody> = {
    formulaDialect: CALC_DIALECTS.find((known) => known === draft.formulaDialect),
    calcTrigger: CALC_TRIGGERS.find((known) => known === draft.calcTrigger),
    calcIntervalSeconds: interval === "" ? null : Number(interval),
  };
  if (formula !== "") body.formula = formula;
  if (maxAge !== "") body.maxInputAgeSeconds = Number(maxAge);
  if (days !== "") body.backfillDays = Number(days);
  if (body.formulaDialect === undefined) delete body.formulaDialect;
  if (body.calcTrigger === undefined) delete body.calcTrigger;
  return body;
}

/** The point keys a formula may read, as the API's standalone write builds them (rule 3). */
export type DeclaredKeys = { readonly measured: readonly string[]; readonly all: readonly string[] };

type AssetRow = Pick<AdminAssetPointDto, "pointKey" | "sourceKind">;

/**
 * `measured` — every row that is not itself calculated (what a `v1` formula
 * may read); `all` — every key on the asset plus this one (the cross-asset
 * dialects; a self-reference is the server's cycle refusal, not a key-list one).
 */
export function knownRefsFor(rows: readonly AssetRow[], pointKey: string): DeclaredKeys {
  return {
    measured: rows.filter((row) => row.sourceKind !== "computed").map((row) => row.pointKey),
    all: [...new Set([...rows.map((row) => row.pointKey), pointKey])],
  };
}

/** The formula editor's point list: a calculated row is `derived`, every other `measured`. */
export function formulaPointsFor(rows: readonly AssetRow[]): FormulaPoint[] {
  const seen = new Map<string, FormulaPoint>();
  for (const row of rows) {
    seen.set(row.pointKey, { pointKey: row.pointKey, kind: row.sourceKind === "computed" ? "derived" : "measured" });
  }
  return [...seen.values()];
}

const NO_TEMPLATE: AssetPointCalcOverrideFields = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

/** What the server's rule 3 would refuse, in its own sentences; empty when the draft is usable. */
export function calcPointDraftProblems(draft: CalcPointDraft, declared: DeclaredKeys): string[] {
  const body = draftToCalcPointBody(draft);
  const fields: AssetPointCalcOverrideFields = {
    formula: body.formula ?? null,
    formulaDialect: body.formulaDialect ?? null,
    calcTrigger: body.calcTrigger ?? null,
    calcIntervalSeconds: body.calcIntervalSeconds ?? null,
    maxInputAgeSeconds: body.maxInputAgeSeconds ?? null,
  };
  return validateMergedCalcOverride(fields, NO_TEMPLATE, declared, { declaredBy: "this asset", inheritance: false });
}

/**
 * A config-shaped stand-in for a point not yet written, so the override
 * panel's field parts (which read `pointKey` and an all-null `template`) can
 * render the Add form. Never sent; never shown as a settings table.
 */
export function standaloneConfigFor(pointKey: string): AssetPointCalcConfigDto {
  return {
    pointKey,
    kind: "standalone",
    templatePointId: null,
    label: null,
    unit: null,
    assetPointId: null,
    template: NO_TEMPLATE,
    override: NO_TEMPLATE,
    effective: NO_TEMPLATE,
    minCoverageRatio: null,
    runtime: null,
    backfill: null,
  };
}

// ---- the batch (ADR 0109 decision 4, ruling 4) ----------------------------

/** Why a selected asset is left out of a batch. */
export const BATCH_TEMPLATE_EXCLUSION = "has a template — use its override";

/** ADR 0109 Consequences: the page says which formulas the bulk action suits. */
export const BATCH_QUALIFIED_REF_NOTE =
  "A formula that names an asset as {ASSET_CODE.key} is tied to that asset's code, so it suits a " +
  "single point better: the bulk action suits formulas over each asset's own points.";

/** The selected assets a batch can write (no template) and the ones it leaves out. */
export function batchEligibility<T extends Pick<AdminAssetDto, "templateId">>(
  assets: readonly T[],
): { eligible: T[]; excluded: T[] } {
  return {
    eligible: assets.filter((asset) => asset.templateId === null),
    excluded: assets.filter((asset) => asset.templateId !== null),
  };
}

/** The cap sentence when `count` exceeds `CALC_POINT_BATCH_MAX_ASSETS`, else `null`. */
export function batchCapProblem(count: number): string | null {
  return count > CALC_POINT_BATCH_MAX_ASSETS
    ? `A calculated point can be added to at most ${CALC_POINT_BATCH_MAX_ASSETS} assets at once; ` +
        `${count} are selected.`
    : null;
}

export type BatchRefusal = { readonly assetId: string; readonly assetCode: string | null; readonly reason: string };

/**
 * The batch 400's `refused[]` from a thrown `ApiError` (whose message is the
 * response text), or `null` when the error is not that body.
 */
export function batchRefusals(cause: unknown): BatchRefusal[] | null {
  if (!(cause instanceof Error)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cause.message);
  } catch {
    return null;
  }
  const result = calcPointBatchRefusedResponseSchema.safeParse(parsed);
  return result.success ? result.data.refused : null;
}

// ---- backfill progress (`F4.311` PR 6b, ADR 0109 decision 7) ---------------

/** How often the calc-points list re-reads while a backfill is queued or running. */
export const BACKFILL_POLL_MS = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two ISO instants, never negative. */
function wholeDays(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS));
}

function rowsText(rows: number): string {
  return `${rows.toLocaleString("en-US")} ${rows === 1 ? "row" : "rows"}`;
}

/**
 * One line for a point's latest backfill run. Days are counted from the
 * run's window start (`fromAt`), never from when it was asked for
 * (`createdAt`): a run asked for now covers the days before now. A failed
 * run shows its stored `error` as the server wrote it (a fixed sentence or
 * an error's name, never a raw response body); it is concatenated rather
 * than templated, which is what the F4.204 scan reads as a raw render.
 */
export function backfillProgressLabel(run: CalcBackfillRunDto): string {
  if (run.status === "failed") return "Backfill failed: " + (run.error ?? "no reason was recorded");
  const total = wholeDays(run.fromAt, run.toAt);
  if (run.status === "done") return `Backfill done: ${total} days, ${rowsText(run.writtenRows)}`;
  if (run.doneThrough === null) return "Backfill: queued";
  const done = Math.min(total, wholeDays(run.fromAt, run.doneThrough));
  return `Backfill: ${done} of ${total} days, ${rowsText(run.writtenRows)}`;
}

/** The calc-points list's `refetchInterval`: {@link BACKFILL_POLL_MS} while any run is queued or running, else off. */
export function backfillPollInterval(items: readonly AssetPointCalcConfigDto[] | undefined): number | false {
  const active = (items ?? []).some(
    (item) => item.backfill !== null && (item.backfill.status === "queued" || item.backfill.status === "running"),
  );
  return active ? BACKFILL_POLL_MS : false;
}
