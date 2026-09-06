import { patternVariables } from "@bms/shared";
import type { AdminTemplatePointDto } from "@bms/shared";

import type {
  InstantiateAssetInput,
  InstantiateAssetsInput,
} from "../api/admin/asset-templates";

/**
 * The Instantiate dialog's payload rules (`F2.5`, ADR 0038).
 *
 * ## Why this was extracted
 *
 * These rules were written inline in `asset-template-detail-page.tsx` during
 * Unit 7, which put them where **no test in this repository can reach them**:
 * `apps/web`'s Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, so a `.tsx` is unreachable, and the coverage gate's
 * `include` stops at `apps/web/src/lib/**`. Every other decision on this
 * branch lives in `lib/` under test; these did not.
 *
 * The create form on the list page was left inline deliberately. Its rules are
 * trims that the server's Zod refuses **loudly** with a 400 the author reads.
 * The rules below fail **silently**, which is the difference that earned them
 * a spec.
 *
 * ## The rule that fails silently
 *
 * `InstantiateAssetsInput` is a union because the server rejects both-or-
 * neither in a `superRefine`. When the author picks an RTU, the cascade has
 * usually set its location too, so both ids are present and exactly one may be
 * sent. **RTU wins**, because an RTU already implies its location.
 *
 * Invert that and nothing complains: the request is valid, the server accepts
 * it, and the assets are built under the location instead of the RTU. No error
 * reaches the author, and the wrong parent is only visible later in the
 * hierarchy. That is the failure mode this module exists to hold still.
 */

/**
 * What the dialog's rows hold — free text, before any rule is applied.
 *
 * `vars` holds one entry per distinct `{token}` the pinned version's measured
 * points ask for (`templateVariables`), keyed by variable name. These are
 * **not persisted** — ADR 0039 Q-A stands: migration resolves only the
 * reserved `{asset_code}`. A tag instantiated with the wrong variable is
 * corrected through the mapping sheet, not by re-running instantiate.
 */
export type InstantiateRow = {
  code: string;
  name: string;
  vars: Record<string, string>;
};

/**
 * The distinct variables a person must supply to instantiate this template —
 * every `{token}` across its **measured** points' `sourceDataKeyPattern`s,
 * minus the reserved `asset_code`, in first-appearance order. A derived
 * point's pattern is always `null`, so filtering to `measured` and
 * `patternVariables`'s own null-skip agree; the filter is kept explicit
 * because a derived point is never a source of a variable a person fills in.
 */
export function templateVariables(template: {
  points: readonly Pick<AdminTemplatePointDto, "kind" | "sourceDataKeyPattern">[];
}): string[] {
  return patternVariables(measuredPatterns(template));
}

function measuredPatterns(template: {
  points: readonly Pick<AdminTemplatePointDto, "kind" | "sourceDataKeyPattern">[];
}): (string | null)[] {
  return template.points
    .filter((point) => point.kind === "measured")
    .map((point) => point.sourceDataKeyPattern);
}

/**
 * The pattern(s) the dialog's hint should name — a measured point's pattern,
 * but only when it actually carries a variable. `{asset_code}_KW` carries a
 * token and no variable (the reserved one is never listed), so it must not
 * appear in a hint whose whole point is "here is what to fill in".
 */
export function patternsCarryingVariables(template: {
  points: readonly Pick<AdminTemplatePointDto, "kind" | "sourceDataKeyPattern">[];
}): string[] {
  const seen = new Set<string>();
  for (const pattern of measuredPatterns(template)) {
    if (pattern && patternVariables([pattern]).length > 0) {
      seen.add(pattern);
    }
  }
  return [...seen];
}

/**
 * The named rows missing a required variable: a row with a non-blank `code`
 * (it will be sent) whose `vars[variable]` is blank or absent, for every
 * `variable` in `variables`. Row numbers are 1-based to match the `aria-label`s
 * the dialog renders (`Asset {row} {variable}`).
 */
export function missingVariables(
  rows: readonly InstantiateRow[],
  variables: readonly string[],
): { row: number; variable: string }[] {
  const missing: { row: number; variable: string }[] = [];
  rows.forEach((row, index) => {
    if (row.code.trim() === "") {
      return;
    }
    for (const variable of variables) {
      if ((row.vars[variable] ?? "").trim() === "") {
        missing.push({ row: index + 1, variable });
      }
    }
  });
  return missing;
}

/** The two ids the hierarchy picker can produce. Both may be set at once. */
export type InstantiateTarget = {
  locationId?: string;
  rtuId?: string;
};

/**
 * The rows that will actually be built.
 *
 * A row with no code is a blank line the author left behind — the dialog seeds
 * one and offers "Add another asset", so trailing empties are normal, not a
 * mistake to report. `name` falls back to `code` rather than to `""`, because
 * `instantiateAssetSchema` requires a non-empty name and an unnamed asset is
 * better identified by its own code than refused.
 *
 * `sourceDataKeyVars` is included only when at least one of the row's vars is
 * non-blank after trimming — a row with every var blank omits the key rather
 * than sending `{ unit: "" }`, so a template with no variables never grows a
 * body the server has no use for, and a variable left blank is reported by
 * the server's own "unresolved" message rather than sent as an empty string.
 */
export function namedRows(rows: readonly InstantiateRow[]): InstantiateAssetInput[] {
  return rows
    .filter((row) => row.code.trim() !== "")
    .map((row) => {
      const trimmedVars = Object.fromEntries(
        Object.entries(row.vars)
          .map(([key, value]) => [key, value.trim()] as const)
          .filter(([, value]) => value !== ""),
      );
      const asset: InstantiateAssetInput = {
        code: row.code.trim(),
        name: row.name.trim() || row.code.trim(),
      };
      if (Object.keys(trimmedVars).length > 0) {
        asset.sourceDataKeyVars = trimmedVars;
      }
      return asset;
    });
}

/** How many assets the button offers to build. */
export function namedCount(rows: readonly InstantiateRow[]): number {
  return namedRows(rows).length;
}

/** Whether a target has been chosen at all. */
export function hasTarget(target: InstantiateTarget): boolean {
  return Boolean(resolveTarget(target));
}

/**
 * Picks the one id to send.
 *
 * `null` when neither is set. Note the guards test for a **non-empty** string,
 * not merely a present key: the picker can hand back `""` for "no selection",
 * and `Boolean("")` is false while `"" !== undefined` is true — so a truthiness
 * check is correct here and a presence check would send an empty id the server
 * refuses.
 */
export function resolveTarget(
  target: InstantiateTarget,
): { kind: "rtu"; id: string } | { kind: "location"; id: string } | null {
  // RTU first, and the order is the rule. See the docblock.
  if (target.rtuId) {
    return { kind: "rtu", id: target.rtuId };
  }
  if (target.locationId) {
    return { kind: "location", id: target.locationId };
  }
  return null;
}

/**
 * The message shown when the author has chosen no target.
 *
 * The button is disabled in this state, so this is unreachable through the UI.
 * It is a real refusal rather than a `locationId: ?? ""` that would build a
 * request guaranteed to 400 — the author would then read a message about a
 * location that does not exist instead of the one thing they have to do.
 */
export const NO_TARGET_MESSAGE = "Choose a location or an RTU to build these assets in.";

/**
 * Builds the request body, or returns the refusal.
 *
 * A discriminated result rather than a throw, so the caller cannot forget to
 * handle the empty-target case and the message cannot be lost.
 */
export function buildInstantiatePayload(
  target: InstantiateTarget,
  rows: readonly InstantiateRow[],
): { ok: true; input: InstantiateAssetsInput } | { ok: false; message: string } {
  const resolved = resolveTarget(target);
  if (!resolved) {
    return { ok: false, message: NO_TARGET_MESSAGE };
  }
  const assets = namedRows(rows);
  if (resolved.kind === "rtu") {
    return { ok: true, input: { rtuId: resolved.id, assets } };
  }
  return { ok: true, input: { locationId: resolved.id, assets } };
}
