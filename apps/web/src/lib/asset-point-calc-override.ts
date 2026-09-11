import {
  CALC_DIALECTS,
  CALC_DIALECT_V2,
  MAX_CALC_INTERVAL_SECONDS,
  MAX_INPUT_AGE_SECONDS_BOUND,
  MIN_CALC_INTERVAL_SECONDS,
  formatCalcError,
  parseFormula,
} from "@bms/shared";
import type { AssetPointCalcConfigDto, AssetPointCalcOverrideFields, CalcDialect } from "@bms/shared";

/**
 * The rules behind the per-point calc override panel (`F2.6`, ADR 0039
 * decisions 6, 7 and 8; `F2.22` T12 for the `bms-calc-v2` half).
 *
 * In `lib/` for the reason `template-tabs.ts` records: the coverage gate
 * reaches `src/lib/**` and nothing above it, so every rule lives here and the
 * panel holds no logic. The panel's render is `point-calc-override-panel.spec.tsx`'s
 * claim (jsdom, ADR 0042); the sentences are this module's.
 *
 * ## Why D-1 is checked in the browser at all
 *
 * The API enforces it and is the authority — this does not replace it. But
 * ADR 0039 decision 6 makes `null` mean *inherit*, so the mistake is
 * structural rather than careless: an author who changes the trigger and leaves
 * the interval alone has done the obvious thing, and the merged result is a
 * counted skip. Learning that from a 400 after pressing Save teaches the rule
 * once, at the worst moment. The panel says it while they are still typing, in
 * the same terms, and the pure spec asserts both.
 *
 * ## `F2.22` — the dialect is an input, and the formula is read under it
 *
 * Grammar is the panel's own select since `F2.22`, so the draft carries the
 * dialect as a sixth column and `draftProblems` reads the draft's formula under
 * the **merged** dialect — the draft's when chosen, the template's when
 * inheriting — with the parser the engine runs. What the panel can see on its
 * own is the grammar and a self-reference; an unknown sibling key, a qualified
 * code that resolves nowhere and a cycle through other assets need the
 * template's key list or a fleet-wide read, and stay the server's 400.
 */

/** How one column reads in the panel. */
export type ColumnOrigin = "overridden" | "inherited" | "unset";

/** Which of the five columns is set on this asset, and which falls through. */
export function columnOrigin(
  config: AssetPointCalcConfigDto,
  field: keyof AssetPointCalcOverrideFields,
): ColumnOrigin {
  if (config.override[field] !== null) {
    return "overridden";
  }
  return config.template[field] !== null ? "inherited" : "unset";
}

/** Whether this point departs from its template at all. */
export function hasAnyOverride(config: AssetPointCalcConfigDto): boolean {
  return CALC_FIELDS.some((field) => config.override[field] !== null);
}

/**
 * Clear is available only when there is something to clear.
 *
 * The API returns 404 for a clear with no row, so an always-enabled button
 * produces an error that says nothing went wrong — the worst kind.
 */
export function canClear(config: AssetPointCalcConfigDto): boolean {
  return hasAnyOverride(config);
}

export const CALC_FIELDS: readonly (keyof AssetPointCalcOverrideFields)[] = [
  "formula",
  "formulaDialect",
  "calcTrigger",
  "calcIntervalSeconds",
  "maxInputAgeSeconds",
];

/** One row of the panel: what the template says, what this asset says, what runs. */
export type CalcFieldRow = {
  field: keyof AssetPointCalcOverrideFields;
  label: string;
  origin: ColumnOrigin;
  templateValue: string;
  effectiveValue: string;
};

const LABELS: Record<keyof AssetPointCalcOverrideFields, string> = {
  formula: "Formula",
  // "Grammar", as the Calculations tab's select is labelled: the row and the
  // control below it name one thing.
  formulaDialect: "Grammar",
  calcTrigger: "Runs",
  calcIntervalSeconds: "Every",
  maxInputAgeSeconds: "Inputs valid for",
};

function display(field: keyof AssetPointCalcOverrideFields, value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (field === "calcIntervalSeconds" || field === "maxInputAgeSeconds") {
    return `${String(value)}s`;
  }
  return String(value);
}

/**
 * The panel's rows.
 *
 * All three of template, override and effective are carried rather than only
 * the effective value: "300s" tells an operator what runs but not whether
 * changing the template would change it, and that is the whole question an
 * override page exists to answer.
 */
export function calcFieldRows(config: AssetPointCalcConfigDto): CalcFieldRow[] {
  return CALC_FIELDS.map((field) => ({
    field,
    label: LABELS[field],
    origin: columnOrigin(config, field),
    templateValue: display(field, config.template[field]),
    effectiveValue: display(field, config.effective[field]),
  }));
}

/**
 * The draft an author edits: empty string means "leave this column inheriting".
 *
 * `formulaDialect` is the Grammar select's value — `""` for inherit, otherwise
 * one of `CALC_DIALECTS` (`F2.22`, design decision 9).
 */
export type OverrideDraft = {
  formula: string;
  formulaDialect: string;
  calcTrigger: string;
  calcIntervalSeconds: string;
  maxInputAgeSeconds: string;
};

export const EMPTY_DRAFT: OverrideDraft = {
  formula: "",
  formulaDialect: "",
  calcTrigger: "",
  calcIntervalSeconds: "",
  maxInputAgeSeconds: "",
};

/** Seeds the form from what is already overridden, so an edit is not a retype. */
export function draftFromConfig(config: AssetPointCalcConfigDto): OverrideDraft {
  return {
    formula: config.override.formula ?? "",
    formulaDialect: config.override.formulaDialect ?? "",
    calcTrigger: config.override.calcTrigger ?? "",
    calcIntervalSeconds:
      config.override.calcIntervalSeconds === null ? "" : String(config.override.calcIntervalSeconds),
    maxInputAgeSeconds:
      config.override.maxInputAgeSeconds === null ? "" : String(config.override.maxInputAgeSeconds),
  };
}

/**
 * The request body.
 *
 * Every column is sent exactly as the author set it, and empty is `null` —
 * **the dialect included, with or without a formula** (`F2.22` design decision
 * 9, ruling Q2). It used to be stamped `bms-calc-v1` beside any formula, on
 * the premise that there was one dialect; `F2.9` made it two, and the stamp
 * became a label the author never chose — a `v2`-shaped formula against a
 * `v2` template, Grammar left on inherit, refused for being `v1`. The API
 * parses the merged pair whichever half is stated, so a formula alone inherits
 * the template's label and a label alone re-reads the template's formula.
 */
export function draftToBody(draft: OverrideDraft): AssetPointCalcOverrideFields {
  const formula = draft.formula.trim();
  const interval = draft.calcIntervalSeconds.trim();
  const maxAge = draft.maxInputAgeSeconds.trim();
  return {
    formula: formula === "" ? null : formula,
    formulaDialect:
      draft.formulaDialect === "" ? null : (draft.formulaDialect as AssetPointCalcOverrideFields["formulaDialect"]),
    calcTrigger:
      draft.calcTrigger === "" ? null : (draft.calcTrigger as AssetPointCalcOverrideFields["calcTrigger"]),
    calcIntervalSeconds: interval === "" ? null : Number(interval),
    maxInputAgeSeconds: maxAge === "" ? null : Number(maxAge),
  };
}

/**
 * The dialect the engine would read this point under after the save: the
 * draft's when Grammar is chosen, the template's when it inherits. One
 * function, so the panel's `v2` controls and `draftProblems` cannot disagree
 * on which grammar is in force.
 */
export function mergedDialect(draft: OverrideDraft, config: AssetPointCalcConfigDto): CalcDialect | null {
  return draftToBody(draft).formulaDialect ?? config.template.formulaDialect;
}

/**
 * The template's coverage ratio as the panel's table shows it (`F2.22` item 4,
 * ruling Q3). `null` is the strict setting under ADR 0055 decision 11, so it
 * reads as what it does rather than as the dash `display` gives an unset
 * column — an operator reading "—" on this line would take it for "no limit".
 */
export function coverageRatioDisplay(ratio: number | null): string {
  return ratio === null ? "fail closed (every member must be fresh)" : String(ratio);
}

/**
 * What the panel refuses to submit, and why — the same rules the API applies to
 * the *merged* result.
 *
 * Deliberately duplicated from `apps/api`'s `validateMergedCalcOverride`, which
 * `apps/web` cannot import. The duplication is bounded to the sentences below;
 * the API stays the authority and the panel does not decide anything the server
 * would not. What it buys is that the structural mistake decision 6 makes easy
 * — change the trigger, leave the interval inheriting — is caught while the
 * author is still looking at both fields.
 *
 * `F2.22` adds the formula half: the **draft's** formula, parsed under the
 * merged dialect with the parser the engine runs, and a self-reference. Only
 * the draft's formula — a chosen grammar over the template's formula is
 * parsed by the server (`validateMergedCalcOverride` reads the merged pair
 * whenever either half is stated) and reaches the page as its 400; the panel
 * has no key list to check a reference against, no asset code to see a
 * qualified self-reference, and no domain or group membership to see an
 * `@domain`/`@group` aggregate over the point's own key, so those stay the
 * server's as well. Only a local ref and an `@site` aggregate are decidable
 * from the DTO alone.
 */
export function draftProblems(
  draft: OverrideDraft,
  config: AssetPointCalcConfigDto,
): string[] {
  const body = draftToBody(draft);
  const problems: string[] = [];

  const merged = {
    formulaDialect: body.formulaDialect ?? config.template.formulaDialect,
    calcTrigger: body.calcTrigger ?? config.template.calcTrigger,
    calcIntervalSeconds: body.calcIntervalSeconds ?? config.template.calcIntervalSeconds,
  };
  const inherited = (field: keyof AssetPointCalcOverrideFields): string =>
    body[field] === null ? " (inherited from the template)" : "";

  if (CALC_FIELDS.every((field) => body[field] === null)) {
    problems.push(
      'This override sets no column: every field is empty, and empty means "inherit". ' +
        "Use Clear to remove an existing override.",
    );
  }

  // `F2.22` items 3 and 7 — the draft's formula under the merged grammar.
  //
  // A membership test on the dialect, not a cast: `config.template.formulaDialect`
  // is a stored column carried through as-is, and a label the engine does not
  // run is the server's "not a dialect this engine runs" refusal, not a parse
  // under whichever grammar the cast happened to name. `parseFormula` is the
  // engine's own parser (`@bms/shared`), so T1's sentences reach this panel
  // through `formatCalcError` unchanged; the framing around them is this
  // module's, in words the server does not use, so that no second copy of the
  // server's formula sentence exists to drift.
  const dialect = CALC_DIALECTS.find((known) => known === merged.formulaDialect);
  if (body.formula !== null && dialect !== undefined) {
    const parsed = parseFormula(body.formula, { dialect });
    if (!parsed.ok) {
      const first = parsed.errors[0];
      problems.push(
        `Under ${dialect}${inherited("formulaDialect")} the formula does not parse: ` +
          `${first ? formatCalcError(first) : "unparseable"}.`,
      );
    } else if (
      parsed.refs.includes(config.pointKey) ||
      parsed.crossRefs.some(
        (node) => node.kind === "aggregate" && node.scope.kind === "site" && node.pointKey === config.pointKey,
      )
    ) {
      // A cycle of length one, which a pure check on this request can see: a
      // local ref to the point's own key, or an `@site` aggregate over it —
      // the asset is always a member of its own site, and it declares the key.
      //
      // **Only `@site`.** An aggregate edge comes from the *resolved* member
      // set (`apps/api/src/calc/calc-graph.ts`), and the asset is a member of
      // a group only through an `asset_group_members` row and of a domain only
      // through its own `domain` column (`calc-scope.service.ts`) — neither of
      // which the DTO carries. A parent summing the same key over a child group
      // is the ordinary use of a per-asset override, and the server stores it
      // when the asset is not in that group; refusing it here would disable
      // Save on a formula the server accepts (plan correction 45). So
      // `@domain` and `@group` stay the server's — the same line PR 1's
      // template mirror draws (`template-calc-cycles.ts`).
      //
      // The fixed part of the server's cycle sentence,
      // `asset-point-calc-override.service.ts:259-266` — the member list there
      // is data this panel cannot compute. A qualified `{OWN_CODE.key}` needs
      // the asset code, which the DTO does not carry.
      problems.push(
        `This formula would form a dependency cycle: it reads its own point "${config.pointKey}". ` +
          "Every point on a cycle waits on another, so none of them ever computes. Break " +
          "the loop — change this formula, or the aggregate scope that draws the other " +
          "points in.",
      );
    }
  }

  if (body.calcIntervalSeconds !== null) {
    if (!Number.isInteger(body.calcIntervalSeconds)) {
      problems.push("The interval must be a whole number of seconds.");
    } else if (
      body.calcIntervalSeconds < MIN_CALC_INTERVAL_SECONDS ||
      body.calcIntervalSeconds > MAX_CALC_INTERVAL_SECONDS
    ) {
      problems.push(
        `The interval must be between ${MIN_CALC_INTERVAL_SECONDS} and ` +
          `${MAX_CALC_INTERVAL_SECONDS} seconds.`,
      );
    }
  }
  if (body.maxInputAgeSeconds !== null) {
    if (!Number.isInteger(body.maxInputAgeSeconds)) {
      problems.push("The input validity window must be a whole number of seconds.");
    } else if (body.maxInputAgeSeconds < 1 || body.maxInputAgeSeconds > MAX_INPUT_AGE_SECONDS_BOUND) {
      problems.push(
        `The input validity window must be between 1 and ${MAX_INPUT_AGE_SECONDS_BOUND} seconds.`,
      );
    }
  }

  // ADR 0055 decision 10, in `validateMergedCalcOverride`'s exact sentence
  // (gated against drift by `tests/f2.22-editor-mirrors-server-wording.test.ts`
  // pair (a)).
  //
  // On the merged pair, and each half says whether it was inherited. The D-1
  // shape decision 6 makes easy runs both ways here: Runs overridden to
  // streaming on a `v2` template the author never re-labelled, or Grammar
  // chosen as `v2` on a streaming template whose trigger they never touched.
  // The panel disables the streaming option under a merged `v2` (design
  // decision 5), so the second arm is reached through a streaming trigger the
  // template or a stored override already carries, never through the select.
  if (merged.formulaDialect === CALC_DIALECT_V2 && merged.calcTrigger === "streaming") {
    problems.push(
      `The merged formulaDialect is "${CALC_DIALECT_V2}"${inherited("formulaDialect")} but ` +
        `calcTrigger is "streaming"${inherited("calcTrigger")}. A "${CALC_DIALECT_V2}" point ` +
        `requires calcTrigger: "scheduled" — a cross-asset formula resolves its members once ` +
        "per sweep and cannot run on a single reading.",
    );
  }

  // D-1, in the same terms the API uses.
  if (merged.calcTrigger === "scheduled" && merged.calcIntervalSeconds === null) {
    problems.push(
      `Runs is "scheduled"${inherited("calcTrigger")} but no interval is ` +
        `set${inherited("calcIntervalSeconds")}. A scheduled formula needs an interval; set ` +
        "both together.",
    );
  }
  if (merged.calcTrigger === "streaming" && merged.calcIntervalSeconds !== null) {
    problems.push(
      `Runs is "streaming"${inherited("calcTrigger")} but the interval is ` +
        `${merged.calcIntervalSeconds}s${inherited("calcIntervalSeconds")}. A streaming formula ` +
        "runs on its inputs and must carry no interval." +
        (body.calcIntervalSeconds === null && config.template.calcIntervalSeconds !== null
          ? " An override cannot clear an inherited value — empty means inherit — so a " +
            "scheduled template point cannot be overridden to streaming. Change the template " +
            "version instead."
          : ""),
    );
  }

  return problems;
}

/** Whether Save may be pressed. */
export function canSubmit(draft: OverrideDraft, config: AssetPointCalcConfigDto): boolean {
  return draftProblems(draft, config).length === 0;
}

/** How long ago, in the coarsest unit that still says something useful. */
function ago(elapsedMs: number): string {
  // A clock that reads slightly behind the server's would otherwise produce
  // "-1 s ago", which looks like a bug in the engine rather than in the clock.
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) {
    return `${seconds} s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ago`;
  }
  return `${Math.floor(seconds / 3600)} h ago`;
}

/**
 * The calc-points status pill's text (`F2.9` Task 16 — ADR 0055 decision 8,
 * plan design decision 9, layer 3), or `null` when there is no pill to render.
 *
 * `written 12 s ago` / `skipped: dependency_cycle`. The two arms say different
 * things on purpose. For a formula that computed, the useful fact is *when* —
 * a point last written an hour ago on a 5-minute interval is the symptom an
 * operator is looking for. For a refusal, the useful fact is *why*: the reason
 * is what tells them whether they broke it by moving an asset into a group, and
 * the age of a refusal that repeats every due window says nothing.
 *
 * `nowMs` is a parameter and the clock is never read here — the caller passes
 * its own, so this stays pure and the "12 s ago" case is a fixed number rather
 * than a race.
 *
 * `lastSkipReason` is rendered as received. It is `z.string()` in the contract
 * on purpose: the vocabulary lives in `apps/api`, and a web-side map from
 * reason to prose would silently fall through to nothing the first time the
 * engine gained a reason — which is exactly when an operator most needs to see
 * one. `dependency_cycle` is not beautiful, but it is searchable, it matches
 * the label on `bms_api_calc_skipped_total`, and it is never absent.
 */
export function calcRuntimePillLabel(
  runtime: AssetPointCalcConfigDto["runtime"],
  nowMs: number,
): string | null {
  if (runtime === null) {
    return null;
  }
  if (runtime.lastOutcome === "written") {
    return `written ${ago(nowMs - new Date(runtime.at).getTime())}`;
  }
  return runtime.lastSkipReason === null ? "skipped" : `skipped: ${runtime.lastSkipReason}`;
}
