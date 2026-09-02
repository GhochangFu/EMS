import { parseFormula } from "@bms/shared";
import type { AdminAssetTemplateDto, AdminTemplatePointDto } from "@bms/shared";

import type { TemplatePointInput, TemplatePointTier } from "../api/admin/asset-templates";

/**
 * The Points tab's grid rules (`F2.5`, ADR 0038 Unit 9b).
 *
 * ## The rule this module exists for: the grid edits seven fields and sends twelve
 *
 * `templatePointsBodySchema` takes the **whole** point set on every draft
 * update — "the points ARE the template, and a partial patch would leave 'did
 * you mean to delete the ones you omitted?' ambiguous". `replacePoints` then
 * deletes every row and reinserts from the payload.
 *
 * So a payload builder that sent only the seven fields this tab edits would
 * write `null` into `formula`, `formulaDialect`, `calcTrigger`,
 * `calcIntervalSeconds` and `maxInputAgeSeconds` for every point. The server
 * would accept it — a measured point with no formula is valid, and a *derived*
 * point stripped of its formula is caught, but a grid that also reset `kind`
 * would not even be that — and every derived point's calc configuration would
 * be gone with nothing on screen to say so.
 *
 * `adminTemplatePointDtoSchema` carries those five read-side fields for exactly
 * this reason, and says so: "an editor round-tripping a GET response back
 * through PATCH must see these fields or lose them."
 *
 * Every row therefore carries all twelve. The five this tab does not edit are
 * passed through untouched, and `setPointKind` is the **only** thing that
 * clears them.
 *
 * **`F2.13` added a thirteenth, `meta.tier`, carried the same way.** It is
 * provenance (ADR 0052 decision 2 — every stock-imported point declares its
 * tier), so `setPointKind` does not clear it either. Its wire shape is
 * different from the calc fields': the key is **omitted** for a point with no
 * tier rather than sent as `null`, because `templatePointBodySchema.meta` is
 * optional-but-closed — `{ tier }` once present, `null` and `{}` both refused.
 *
 * ## Point identity does not survive a save, and nothing depends on it
 *
 * `replacePoints` deletes and reinserts, so `AdminTemplatePointDto.id` is a
 * different value after every save. Nothing keys off it: `content` references
 * point *keys* (`assertContentRefsResolve`), and a published version's assets
 * cannot reference a draft's rows. `id` is therefore not carried into the grid
 * at all — a row's identity here is its `pointKey`, which is what the server
 * uses too.
 *
 * ## What this module does not do
 *
 * It does not re-implement `templatePointsBodySchema`'s `superRefine`. The
 * server stays the authority. What is here is the part that turns a Zod path
 * into a sentence naming the point the author just broke.
 */

/** `templatePointsBodySchema` is `.max(500)`. */
export const MAX_TEMPLATE_POINTS = 500;

export type TemplatePointKindValue = "measured" | "derived";

/**
 * One editable row.
 *
 * The seven edited fields are strings as the DOM holds them; `label`, `unit`
 * and `sourceDataKeyPattern` are `.nullish()` on the wire, so an emptied box
 * becomes `null` in `buildPointsPayload` rather than an empty string.
 *
 * The five calc fields keep their wire types. They are carried, not edited.
 *
 * `meta` is normalised on seed: the read side may hold `null` or `{}` (the
 * column default) for a point with no tier, and both become `null` here so
 * that `buildPointsPayload` has one case to omit.
 */
export type TemplatePointRow = {
  pointKey: string;
  label: string;
  unit: string;
  kind: TemplatePointKindValue;
  sourceDataKeyPattern: string;
  required: boolean;
  sortOrder: number;
  formula: string | null;
  formulaDialect: AdminTemplatePointDto["formulaDialect"];
  calcTrigger: AdminTemplatePointDto["calcTrigger"];
  calcIntervalSeconds: number | null;
  maxInputAgeSeconds: number | null;
  meta: { tier: TemplatePointTier } | null;
};

/** Seeds the grid from the loaded template, in the order the server returned. */
export function pointRowsFrom(template: AdminAssetTemplateDto): TemplatePointRow[] {
  return template.points.map((point) => ({
    pointKey: point.pointKey,
    label: point.label ?? "",
    unit: point.unit ?? "",
    kind: point.kind,
    sourceDataKeyPattern: point.sourceDataKeyPattern ?? "",
    required: point.required,
    sortOrder: point.sortOrder,
    formula: point.formula,
    formulaDialect: point.formulaDialect,
    calcTrigger: point.calcTrigger,
    calcIntervalSeconds: point.calcIntervalSeconds,
    maxInputAgeSeconds: point.maxInputAgeSeconds,
    meta: point.meta?.tier ? { tier: point.meta.tier } : null,
  }));
}

/** A new blank row, appended after the highest `sortOrder` in the grid. */
export function blankPointRow(rows: readonly TemplatePointRow[]): TemplatePointRow {
  const highest = rows.reduce((max, row) => Math.max(max, row.sortOrder), -1);
  return {
    pointKey: "",
    label: "",
    unit: "",
    kind: "measured",
    sourceDataKeyPattern: "",
    required: true,
    sortOrder: highest + 1,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    meta: null,
  };
}

/**
 * Changes a point's kind, clearing what the new kind may not carry.
 *
 * **derived → measured clears all five.** `templatePointBodySchema` refuses a
 * measured point that carries a formula or any calc field, so leaving them
 * would turn a kind change into a 400 the author cannot connect to the control
 * they touched.
 *
 * **measured → derived clears `sourceDataKeyPattern` and seeds nothing.**
 *
 * The pattern goes because a derived value is computed, and the instantiation
 * service says so in its own words: "only measured points become rows … a
 * derived point is computed by the calc engine, and there is no honest
 * `source_data_key` for it." `templatePointBodySchema` has no cross-check for
 * this field, so a stale pattern is accepted and then ignored forever — dead
 * data that reads as configuration.
 *
 * Nothing is seeded. A derived point requires `formula`, `formulaDialect` and
 * `calcTrigger`, and this tab has no controls for any of them: ADR 0038
 * decision 4 puts the trigger policy on the Calculations tab and decision 9
 * keeps it off the KPIs tab. Seeding `calcTrigger: "streaming"` here would
 * decide ADR 0037's write policy from a tab the ADR gives no say in it,
 * silently, in a field the author never sees. `pointGridErrors` names what is
 * owed instead.
 */
export function setPointKind(
  row: TemplatePointRow,
  kind: TemplatePointKindValue,
): TemplatePointRow {
  if (kind === row.kind) {
    return row;
  }
  if (kind === "measured") {
    return {
      ...row,
      kind,
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
    };
  }
  return { ...row, kind, sourceDataKeyPattern: "" };
}

/** One problem, addressed to a row. `row: null` means the grid as a whole. */
export type PointGridProblem = {
  row: number | null;
  field: string;
  message: string;
};

/**
 * What the author must fix before the grid can be sent.
 *
 * Mirrors the server's own checks so the message can name the point rather than
 * a Zod path. The server still runs all of them — this is the wording, not the
 * authority.
 */
export function pointGridErrors(rows: readonly TemplatePointRow[]): PointGridProblem[] {
  const problems: PointGridProblem[] = [];

  if (rows.length > MAX_TEMPLATE_POINTS) {
    problems.push({
      row: null,
      field: "points",
      message: `A template holds at most ${MAX_TEMPLATE_POINTS} points. This one has ${rows.length}.`,
    });
  }

  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const key = row.pointKey.trim();
    if (key === "") {
      problems.push({ row: index, field: "pointKey", message: "Choose a point key." });
      return;
    }
    // Reported against the **second** occurrence, and it names the first. The
    // server reports `[index, "pointKey"]`, which does not say which other row
    // it collided with.
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push({
        row: index,
        field: "pointKey",
        message: `"${key}" is already used by row ${first + 1}. Each point key appears once.`,
      });
    } else {
      seen.set(key, index);
    }
  });

  rows.forEach((row, index) => {
    // The Points tab can make a point derived but cannot complete it. Refusing
    // here beats a 400 naming `formula` on a tab with no formula field.
    if (row.kind === "derived" && (row.formula ?? "").trim() === "") {
      problems.push({
        row: index,
        field: "kind",
        message:
          "A derived point needs a formula and a trigger. Set them on the Calculations tab, " +
          "or change this point back to measured.",
      });
    }
    if (row.kind === "measured" && (row.formula ?? "").trim() !== "") {
      problems.push({
        row: index,
        field: "kind",
        message: "A measured point must not carry a formula.",
      });
    }
  });

  return [...problems, ...brokenFormulaRefs(rows)];
}

/**
 * Derived formulas this grid's edits have broken.
 *
 * Renaming a point key, or making a referenced point derived, both fail the
 * sibling rule in `templatePointsBodySchema`'s `superRefine` — with a Zod path
 * pointing at the *formula's* row, which is not the row the author edited. This
 * says which edit broke which formula.
 *
 * **`parseFormula`, not `validateFormula`.** `validateFormula(expr, knownRefs)`
 * returns `ok: false` with `unknown_reference` the moment a `{ref}` is outside
 * the set it is given — so passing this grid's keys would make the *removed
 * key* case, the whole point of this function, fail to parse and be skipped.
 * `parseFormula` returns the refs and lets this compare them itself.
 *
 * Reference extraction only. Nothing here re-implements the server's
 * reachability analysis, and a formula that does not parse is left to the
 * server and to the Calculations tab, which is where it can be fixed.
 */
export function brokenFormulaRefs(rows: readonly TemplatePointRow[]): PointGridProblem[] {
  const problems: PointGridProblem[] = [];
  const kindByKey = new Map(
    rows.filter((row) => row.pointKey.trim() !== "").map((row) => [row.pointKey.trim(), row.kind]),
  );

  rows.forEach((row, index) => {
    const formula = (row.formula ?? "").trim();
    if (row.kind !== "derived" || formula === "") {
      return;
    }
    const result = parseFormula(formula);
    if (!result.ok) {
      // Left to the Calculations tab and to the server. A parse error is not
      // something an edit on *this* tab caused.
      return;
    }
    for (const ref of result.refs) {
      const kind = kindByKey.get(ref);
      if (kind === undefined) {
        problems.push({
          row: index,
          field: "formula",
          // Says how to get unstuck. The formula lives on the Calculations tab,
          // and leaving this tab to reach it discards the unsaved grid — so the
          // fix available *here* is to put the key back.
          message:
            `This point's formula references "${ref}", which is no longer in this template. ` +
            "Restore that point key, or change the formula on the Calculations tab.",
        });
      } else if (kind === "derived") {
        problems.push({
          row: index,
          field: "formula",
          message:
            ref === row.pointKey.trim()
              ? "This point's formula references itself."
              : `This point's formula references "${ref}", which is now derived. A derived ` +
                "formula may only reference measured points.",
        });
      }
    }
  });

  return problems;
}

/**
 * The `points[]` payload — the whole set, every field.
 *
 * **The Calculations tab (Unit 9c) imports this.** It edits the five fields
 * this tab passes through, and needs the same whole-array builder, because the
 * server replaces the point set wholesale from whichever tab saves.
 *
 * `sortOrder` is sent explicitly rather than left to `replacePoints`' `??
 * index` fallback, so the order is what the grid shows and not what the array
 * happened to hold.
 */
export function buildPointsPayload(rows: readonly TemplatePointRow[]): TemplatePointInput[] {
  return rows.map((row) => ({
    pointKey: row.pointKey.trim(),
    // `.nullish()` on the wire. An emptied box means "no override", which is
    // `null` — `""` would store an empty label that renders as a point with a
    // blank name rather than falling back to the catalog's.
    label: row.label.trim() === "" ? null : row.label.trim(),
    unit: row.unit.trim() === "" ? null : row.unit.trim(),
    kind: row.kind,
    sourceDataKeyPattern:
      row.sourceDataKeyPattern.trim() === "" ? null : row.sourceDataKeyPattern.trim(),
    required: row.required,
    sortOrder: row.sortOrder,
    // Carried, never edited here. See this module's docblock.
    formula: row.formula,
    formulaDialect: row.formulaDialect,
    calcTrigger: row.calcTrigger,
    calcIntervalSeconds: row.calcIntervalSeconds,
    maxInputAgeSeconds: row.maxInputAgeSeconds,
    // Omitted, not nulled, for a point with no tier — see the module docblock.
    ...(row.meta ? { meta: row.meta } : {}),
  }));
}

/**
 * Whether the grid differs from what the server holds.
 *
 * Compared through `buildPointsPayload` on both sides, so a trimmed-only edit
 * is not a change — the payload is what would be sent, and if it is identical
 * the save would delete and reinsert every row to no effect while writing an
 * audit entry.
 */
export function pointsHaveChanged(
  rows: readonly TemplatePointRow[],
  template: AdminAssetTemplateDto,
): boolean {
  const next = JSON.stringify(buildPointsPayload(rows));
  const current = JSON.stringify(buildPointsPayload(pointRowsFrom(template)));
  return next !== current;
}
