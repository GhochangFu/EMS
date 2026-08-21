import { CALC_DIALECT, MAX_FORMULA_POINT_REFS } from "@bms/shared";
import type { TemplateKpi } from "@bms/shared";

import { previewInputKeys } from "./calc-preview";
import { upgradeKpiToCalcDialect, type FormulaValidation } from "./template-formula-validation";
import type { PointGridProblem } from "./template-points-grid";

/**
 * The KPIs tab's form rules (`F2.5`, ADR 0038 decision 9 — Unit 9d).
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
 * ## `pointKeys` is derived once the dialect is `bms-calc-v1`, and manual before
 *
 * `templateKpiSchema`'s `superRefine` demands exact two-way correspondence
 * under `bms-calc-v1`: every `{ref}` in the expression must appear in
 * `pointKeys`, and every entry in `pointKeys` must be used. A hand-maintained
 * array cannot survive that — each expression edit silently invalidates it, and
 * the author's only feedback is a Zod path on a field they never touched.
 *
 * So a validated KPI's `pointKeys` is **computed from its expression**, on
 * every edit and not only when Validate is pressed. An `"unvalidated"` KPI
 * keeps its manual list, because its expression need not parse and there is
 * nothing to derive from. That asymmetry is the decision, not an oversight.
 *
 * ## Decision 9's atomicity is Unit 5's, and stays there
 *
 * `upgradeKpiToCalcDialect` returns **the input reference itself** when
 * validation fails, so a caller that writes its result unconditionally writes
 * nothing new — not the dialect, not the expression. `validateKpiRow` builds a
 * candidate and hands it to that function rather than reimplementing the rule.
 */

/** `contentEnvelopeSchema` caps every section at 200 entries. */
export const MAX_KPI_ENTRIES = 200;

/** `pointKeys` is `.min(1).max(MAX_FORMULA_POINT_REFS)`. */
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

/** Reads the stored `content.kpis`, tolerating a row shape this UI predates. */
export function kpiRowsFrom(kpis: readonly TemplateKpi[] | undefined): TemplateKpiRow[] {
  return (kpis ?? []).map((kpi) => ({
    code: kpi.code,
    name: kpi.name,
    unit: kpi.unit ?? "",
    pointKeys: [...kpi.pointKeys],
    expression: kpi.expression,
    dialect: kpi.dialect,
    higherIsBetter: kpi.higherIsBetter ?? null,
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
 * Derived from the expression once the dialect is `bms-calc-v1`, so a validated
 * KPI can never carry a stale array; the manual list while unvalidated, because
 * an expression that does not parse yields nothing to derive.
 */
export function effectivePointKeys(row: TemplateKpiRow): string[] {
  if (row.dialect !== CALC_DIALECT) {
    return [...row.pointKeys];
  }
  return previewInputKeys(row.expression);
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
 * field in which to make them agree.
 */
export function validateKpiRow(
  row: TemplateKpiRow,
  declaredPointKeys: readonly string[],
): { validation: FormulaValidation; row: TemplateKpiRow } {
  const candidate: TemplateKpi = {
    code: row.code,
    name: row.name,
    pointKeys: previewInputKeys(row.expression),
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
    if (keys.length === 0) {
      problems.push({
        row: index,
        field: "pointKeys",
        message:
          row.dialect === CALC_DIALECT
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
