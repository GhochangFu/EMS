import { CALC_DIALECT, CALC_DIALECTS, CALC_DIALECT_V2, MAX_FORMULA_POINT_REFS } from "@bms/shared";
import type { CalcDialect, TemplateKpi } from "@bms/shared";

import { previewCrossRefs, previewInputKeys } from "./calc-preview";
import {
  checkedDialect,
  upgradeKpiToCalcDialect,
  type FormulaValidation,
} from "./template-formula-validation";
import type { PointGridProblem } from "./template-points-grid";

/**
 * The KPIs tab's form rules (`F2.5`, ADR 0038 decision 9 — Unit 9d; `v2`
 * authoring in `F2.22`).
 *
 * ## `unit` and `higherIsBetter` are `.optional()`, not `.nullish()`
 *
 * Every other payload builder on this branch maps an emptied box to `null`,
 * because `label`, `unit` and `description` are `.nullish()` on their schemas.
 * **`templateKpiSchema` is different**, and getting it wrong is a 400 on every
 * KPI whose unit the author cleared:
 *
 * ```
 * unit: z.string().max(32).optional()          // rejects null
 * higherIsBetter: z.boolean().optional()       // rejects null
 * ```
 *
 * …inside a `.strict()` object. So "not set" must make the **key absent**, not
 * present-and-null. `buildKpiPayload` builds those two conditionally.
 *
 * ## `pointKeys` is derived once the dialect is a checked one, and manual before
 *
 * `templateKpiSchema`'s `superRefine` demands exact two-way correspondence
 * under either member of `CALC_DIALECTS`: every **local** `{ref}` in the
 * expression must appear in `pointKeys`, and every entry in `pointKeys` must be
 * used by a local reference. A hand-maintained array cannot survive that — each
 * expression edit silently invalidates it, and the author's only feedback is a
 * Zod path on a field they never touched.
 *
 * So a checked KPI's `pointKeys` is **computed from its expression**, on every
 * edit and not only when Validate is pressed, and under the dialect the row
 * names. Under `bms-calc-v2` that means the local keys only (the owner's `F2.9`
 * Q3b ruling): the `kw` in `sum({kw} @site)` and the `kwh` in `{TX_01.kwh}`
 * belong to other assets and never appear here, so a KPI whose every reference
 * is cross-asset correctly derives `[]`. An `"unvalidated"` KPI keeps its
 * manual list, because its expression need not parse and there is nothing to
 * derive from. That asymmetry is the decision, not an oversight.
 *
 * ## Decision 9's atomicity is Unit 5's, and stays there
 *
 * `upgradeKpiToCalcDialect` returns **the input reference itself** when
 * validation fails, so a caller that writes its result unconditionally writes
 * nothing new — not the dialect, not the expression. `validateKpiRow` builds a
 * candidate and hands it to that function rather than reimplementing the rule,
 * and `setKpiDialect` (`F2.22` design decision 2) extends the same guarantee to
 * a dialect change: the row moves only when its expression validates under the
 * target, and a refused change returns the input row.
 */

/** `contentEnvelopeSchema` caps every section at 200 entries. */
export const MAX_KPI_ENTRIES = 200;

/**
 * `pointKeys` is `z.array(pointKeyRef).max(MAX_KPI_POINT_REFS)`, with
 * `MAX_KPI_POINT_REFS = MAX_FORMULA_POINT_REFS`
 * (`asset-templates-content.schema.ts`, `templateKpiSchema`).
 *
 * There is no `.min(1)` on the array any more (`F2.9` correction 13): a `v2`
 * KPI whose every reference is cross-asset has no local key, so the lower bound
 * moved into the `superRefine`, where it can see the expression. An
 * `"unvalidated"` KPI must still name at least one key; a parsed KPI is refused
 * only when it has no local key **and** no cross-asset reference.
 * `kpiFormErrors` mirrors that pair below.
 */
export const MAX_KPI_POINT_KEYS = MAX_FORMULA_POINT_REFS;

const LIMITS = { code: 64, name: 255, unit: 32, expression: 1000 } as const;

/**
 * One editable KPI.
 *
 * `unit` is a string because a text box holds one; `""` means "not set".
 * `higherIsBetter` is a real tri-state — `null` is "no direction declared",
 * which is not the same as `false` ("lower is better") and drives different
 * rendering downstream. A checkbox cannot express that, so the tab uses a
 * three-option select.
 */
export type TemplateKpiRow = {
  code: string;
  name: string;
  unit: string;
  pointKeys: string[];
  expression: string;
  dialect: TemplateKpi["dialect"];
  higherIsBetter: boolean | null;
};

/**
 * Reads the stored `content.kpis`.
 *
 * **Every field is treated as possibly absent, and the types here are a
 * promise the data does not make.** `AdminAssetTemplateDto.content` is
 * `z.record(z.unknown())`, because `F2.1` shipped the column behind that and a
 * deployment may hold rows written before ADR 0019 tightened it. So a stored
 * entry can be any object at all, and `[...kpi.pointKeys]` on one that lacks
 * the field throws while **rendering** — `unwritableContentKeys` blocks the
 * write, not the read, and a tab that crashes on open is worse than one that
 * shows an incomplete row the author can repair.
 */
export function kpiRowsFrom(kpis: readonly TemplateKpi[] | undefined): TemplateKpiRow[] {
  return (kpis ?? []).map((kpi) => ({
    code: typeof kpi?.code === "string" ? kpi.code : "",
    name: typeof kpi?.name === "string" ? kpi.name : "",
    unit: typeof kpi?.unit === "string" ? kpi.unit : "",
    pointKeys: Array.isArray(kpi?.pointKeys) ? [...kpi.pointKeys] : [],
    expression: typeof kpi?.expression === "string" ? kpi.expression : "",
    // Resolved against the vocabulary rather than compared to the `v1`
    // literal (`F2.9`, ADR 0055 decision 2 and the owner's Q3 ruling, which
    // widened `templateKpiSchema.dialect`). Anything this UI does not know
    // still reads as unvalidated — the safe direction for a row it cannot
    // vouch for, with the Validate button as the way up.
    //
    // The `v1`-only ternary this replaces was **not** cosmetic: `buildKpiPayload`
    // writes `dialect: row.dialect` for every row on every save, so a stored
    // `v2` KPI read back as `"unvalidated"` was sent back that way the next
    // time the author edited any *other* KPI in the tab.
    dialect: CALC_DIALECTS.find((known) => known === kpi?.dialect) ?? "unvalidated",
    higherIsBetter: typeof kpi?.higherIsBetter === "boolean" ? kpi.higherIsBetter : null,
  }));
}

/** A new KPI. Unvalidated, per decision 9 — the button is the only way up. */
export function blankKpiRow(): TemplateKpiRow {
  return {
    code: "",
    name: "",
    unit: "",
    pointKeys: [],
    expression: "",
    dialect: "unvalidated",
    higherIsBetter: null,
  };
}

/**
 * The point keys a row declares.
 *
 * Derived from the expression once the dialect is a checked one, under that
 * dialect, so a checked KPI can never carry a stale array; the manual list
 * while `"unvalidated"`, because an expression that does not parse yields
 * nothing to derive.
 *
 * Under `bms-calc-v2` the derived list is the **local** keys only (`F2.22`; the
 * owner's `F2.9` Q3b ruling): `previewInputKeys` returns `parsed.refs`, and the
 * member key of an aggregate or the key of a qualified reference is a
 * `crossRefs` entry, never a ref. So `{FLOW} / sum({FLOW} @site)` derives
 * `["FLOW"]` for the one local read, and `sum({kw} @site)` derives `[]` —
 * which is the correct value for a KPI that reads nothing on this asset, and
 * `referencesAnotherAsset` is what keeps `kpiFormErrors` from reading it as a
 * KPI that reads nothing at all.
 *
 * The gate is `checkedDialect`, not a comparison to a literal, so a third
 * member of `CALC_DIALECTS` derives on the day it is added rather than being
 * read as manual by a check nobody remembered to extend.
 */
export function effectivePointKeys(row: TemplateKpiRow): string[] {
  const dialect = checkedDialect(row.dialect);
  if (dialect === null) {
    return [...row.pointKeys];
  }
  return previewInputKeys(row.expression, dialect);
}

/**
 * Whether a `bms-calc-v2` expression names at least one **cross-asset**
 * reference.
 *
 * The owner's Q3b ruling: `pointKeys` lists the *local* keys a KPI reads, so a
 * KPI whose every reference is an aggregate or a qualified `{CODE.key}`
 * correctly has `pointKeys: []`. That is not "a KPI that reads nothing", and
 * `templateKpiSchema` tells the two apart on exactly this question — an empty
 * array is refused only when the parse also found no cross-asset reference.
 *
 * False for every other dialect, so `v1` and `"unvalidated"` reach the same
 * refusal they always did — a `v1` row is never parsed under `v2` here, so an
 * `@` it cannot legally contain never earns it the exemption.
 */
function referencesAnotherAsset(row: TemplateKpiRow): boolean {
  if (row.dialect !== CALC_DIALECT_V2) {
    return false;
  }
  return previewCrossRefs(row.expression.trim(), CALC_DIALECT_V2).length > 0;
}

/**
 * The **Validate this expression** action (decision 9).
 *
 * Builds the candidate this row would become — the derived `pointKeys` plus the
 * expression as typed — and hands it to Unit 5's `upgradeKpiToCalcDialect`,
 * which flips the dialect on success and returns the candidate unchanged on
 * failure. The caller writes `row` only when `validation.state === "ok"`, so a
 * failed validation leaves the stored row exactly as it was.
 *
 * The refs are derived here rather than trusted from `row.pointKeys`, because
 * this is the moment the two must start agreeing and the author has had no
 * field in which to make them agree. They are derived under the dialect the
 * candidate will be checked under — `checkedDialect(row.dialect) ?? CALC_DIALECT`,
 * the same resolution `upgradeKpiToCalcDialect` makes — so a `v2` row's
 * `sum({kw} @site) + {kw}` derives `["kw"]` and validates, where a `v1`-only
 * derivation would have handed it `[]` and then refused the `{kw}` it had just
 * dropped.
 */
export function validateKpiRow(
  row: TemplateKpiRow,
  declaredPointKeys: readonly string[],
): { validation: FormulaValidation; row: TemplateKpiRow } {
  const candidate: TemplateKpi = {
    code: row.code,
    name: row.name,
    pointKeys: previewInputKeys(row.expression, checkedDialect(row.dialect) ?? CALC_DIALECT),
    expression: row.expression,
    dialect: row.dialect,
  };
  const result = upgradeKpiToCalcDialect(candidate, declaredPointKeys);
  return {
    validation: result.validation,
    row: { ...row, dialect: result.kpi.dialect, pointKeys: [...result.kpi.pointKeys] },
  };
}

/**
 * The dialect control (`F2.22` design decision 2).
 *
 * A KPI's dialect gates whether any check runs on it at all, so the select
 * cannot simply write `target` and let the linter object: a `v2` expression
 * relabelled `v1` would sit unparsed behind a label it does not satisfy. The
 * change is therefore applied only when the expression validates under the
 * target — `validateKpiRow` over the row as it would read, so the same rules run
 * as for Validate, including derivation of `pointKeys` under the target.
 *
 * **On failure the returned row is the input itself**, not the candidate. This
 * differs from `validateKpiRow`, whose candidate keeps the row's own dialect
 * and so is safe to hand back; the candidate here already reads `target`, and
 * returning it would give the caller a row that claims a dialect its expression
 * does not satisfy. Returning the input reference is Unit 5's guarantee
 * restated at this level: a caller that writes the result unconditionally
 * writes nothing new.
 */
export function setKpiDialect(
  row: TemplateKpiRow,
  target: CalcDialect,
  declaredPointKeys: readonly string[],
): { validation: FormulaValidation; row: TemplateKpiRow } {
  const result = validateKpiRow({ ...row, dialect: target }, declaredPointKeys);
  if (result.validation.state !== "ok") {
    return { validation: result.validation, row };
  }
  return result;
}

/**
 * What the author must fix before the KPIs can be sent.
 *
 * `declaredPointKeys` is the template's own `points[]`. The server checks the
 * same thing in `assertContentRefsResolve`, which reports a path into
 * `content`; this names the KPI and the key.
 */
export function kpiFormErrors(
  rows: readonly TemplateKpiRow[],
  declaredPointKeys: readonly string[],
): PointGridProblem[] {
  const problems: PointGridProblem[] = [];

  if (rows.length > MAX_KPI_ENTRIES) {
    problems.push({
      row: null,
      field: "kpis",
      message: `A template holds at most ${MAX_KPI_ENTRIES} KPIs. This one has ${rows.length}.`,
    });
  }

  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const code = row.code.trim();
    if (code === "") {
      problems.push({ row: index, field: "code", message: "A KPI needs a code." });
    } else if (code.length > LIMITS.code) {
      problems.push({
        row: index,
        field: "code",
        message: `A code is at most ${LIMITS.code} characters.`,
      });
    } else {
      const first = seen.get(code);
      if (first !== undefined) {
        problems.push({
          row: index,
          field: "code",
          message: `"${code}" is already used by KPI ${first + 1}. Each code appears once.`,
        });
      } else {
        seen.set(code, index);
      }
    }

    if (row.name.trim() === "") {
      problems.push({ row: index, field: "name", message: "A KPI needs a name." });
    } else if (row.name.trim().length > LIMITS.name) {
      problems.push({
        row: index,
        field: "name",
        message: `A name is at most ${LIMITS.name} characters.`,
      });
    }

    if (row.unit.trim().length > LIMITS.unit) {
      problems.push({
        row: index,
        field: "unit",
        message: `A unit is at most ${LIMITS.unit} characters.`,
      });
    }

    // **Empty is refused even while unvalidated.** Decision 9 protects a stored
    // expression the author did not touch, and `.min(1)` means no stored
    // expression is ever empty — so an empty field can only be one just
    // cleared. Staying silent would let Save go out and teach the rule with a
    // 400.
    const expression = row.expression.trim();
    if (expression === "") {
      problems.push({ row: index, field: "expression", message: "A KPI needs an expression." });
    } else if (expression.length > LIMITS.expression) {
      problems.push({
        row: index,
        field: "expression",
        message: `An expression is at most ${LIMITS.expression} characters.`,
      });
    }

    const keys = effectivePointKeys(row);
    // `referencesAnotherAsset` is the Q3b exemption, and it is a **narrowing**,
    // not a skip: a `v2` KPI with no local keys and no cross-asset reference
    // reads nothing and is still refused, by this branch, exactly as a `v1` one
    // is. Without it a stored `v2` KPI made the whole tab unsaveable — an
    // author who opened it to rename a different KPI could not press Save.
    if (keys.length === 0 && !referencesAnotherAsset(row)) {
      // A checked row's keys are derived, so the only thing the author can
      // change is the expression; an unvalidated row has a list to fill in.
      problems.push({
        row: index,
        field: "pointKeys",
        message:
          checkedDialect(row.dialect) !== null
            ? "This expression references no points. Every KPI must read at least one."
            : "Choose the points this KPI reads.",
      });
    } else if (keys.length > MAX_KPI_POINT_KEYS) {
      problems.push({
        row: index,
        field: "pointKeys",
        message: `A KPI reads at most ${MAX_KPI_POINT_KEYS} points.`,
      });
    }

    // `assertContentRefsResolve` rejects a KPI naming a key the template does
    // not declare. Removing that point on the Points tab is what causes it, and
    // the server's message points into `content` rather than at the KPI.
    const declared = new Set(declaredPointKeys);
    for (const key of keys) {
      if (!declared.has(key)) {
        problems.push({
          row: index,
          field: "pointKeys",
          message: `"${key}" is not a point this template declares.`,
        });
      }
    }
  });

  return problems;
}

/**
 * The `content.kpis` payload.
 *
 * `unit` and `higherIsBetter` are added **only when set**, because
 * `templateKpiSchema` is `.strict()` and both are `.optional()` — which rejects
 * `null`. Mapping an emptied box to `null`, as every other builder on this
 * branch does, would be a 400 per KPI.
 */
export function buildKpiPayload(rows: readonly TemplateKpiRow[]): TemplateKpi[] {
  return rows.map((row) => {
    const kpi: TemplateKpi = {
      code: row.code.trim(),
      name: row.name.trim(),
      pointKeys: effectivePointKeys(row),
      expression: row.expression.trim(),
      dialect: row.dialect,
    };
    const unit = row.unit.trim();
    if (unit !== "") {
      kpi.unit = unit;
    }
    if (row.higherIsBetter !== null) {
      kpi.higherIsBetter = row.higherIsBetter;
    }
    return kpi;
  });
}

/** Whether the rows differ from what is stored, compared as they would be sent. */
export function kpisHaveChanged(
  rows: readonly TemplateKpiRow[],
  stored: readonly TemplateKpi[] | undefined,
): boolean {
  return (
    JSON.stringify(buildKpiPayload(rows)) !== JSON.stringify(buildKpiPayload(kpiRowsFrom(stored)))
  );
}
