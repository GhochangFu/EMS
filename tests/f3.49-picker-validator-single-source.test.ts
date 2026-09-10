import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.49` / ADR 0058 Amendment 2 — picker == validator is **one function**,
 * held by a source scan.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6). Files are read by relative path from the repo root, never through a
 * static `@bms` import (the `F2.7` lesson).
 *
 * Why a static gate as well as the integration cases in
 * `asset-templates.seed-rules.picker.integration.spec.ts`: those prove
 * equality on one fixture. A future second path — a `kind` filter added to
 * the picker's query only, or the map-first short-circuit re-added to the
 * validator — keeps that fixture green while diverging on other data. The
 * scan fails the moment the rules module has two readers of the hard-coded
 * map or two of `template_points`, because a union computed in two places has
 * no compiler edge between them. Its named limit: it cannot see a divergence
 * *inside* the one function; `rule-points.spec.ts` and the integration cases
 * hold that.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const SERVICE_REL = "apps/api/src/rules/rules.service.ts";
const POINTS_REL = "apps/api/src/rules/rule-points.ts";

/**
 * Block and line comments removed, so a match is code rather than prose. Both
 * files explain themselves at length and quote the very names this scan looks
 * for — asserted against raw source, "the service does not name the map" is
 * false on a docblock alone (the `F4.108` failure).
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * The brace-matched body of a function or method, from its header text.
 *
 * The body's opening brace is the first `{` that ends its line: a return type
 * such as `Promise<{ assets: RuleBuilderCatalogAsset[] }>` keeps its braces
 * inline, so this skips it and lands on the body. Sliced on comment-stripped
 * source, so a brace in prose cannot unbalance it.
 */
function bodyOf(source: string, header: string, file: string): string {
  const at = source.indexOf(header);
  if (at < 0) {
    throw new Error(
      `${file} no longer declares \`${header}\`. If it moved, this test must move with it — ` +
        "do not delete it.",
    );
  }
  const open = source.slice(at).search(/\{[ \t]*\r?\n/);
  if (open < 0) {
    throw new Error(`${file}: no body brace found after \`${header}\``);
  }
  const start = at + open;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") {
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`${file}: unbalanced braces in \`${header}\``);
}

const service = codeOnly(read(SERVICE_REL));
const points = codeOnly(read(POINTS_REL));

describe("F3.49 — the rules service reaches the point set only through rule-points.ts", () => {
  it("rules.service.ts names neither the hard-coded map nor template_points", () => {
    expect(
      service,
      "`rules.service.ts` calls `pointKeysForAsset` directly. The picker's list must come from " +
        "`ruleTargetPointKeysByAsset`, the one place the map ∪ template union is computed — a " +
        "direct map read here is the `F3.49` defect exactly: a picker that offers a strict " +
        "subset of what `assertCompatiblePoint` accepts.",
    ).not.toContain("pointKeysForAsset");
    expect(
      service,
      "`rules.service.ts` reads `templatePoints` itself. The template side of the union lives " +
        "in `rule-points.ts` only; a second reader here can drift from the validator's.",
    ).not.toContain("templatePoints");
    // Anti-vacuity: the service does reach the set, through the shared helper —
    // a service that lost both calls would pass the two negatives above.
    expect(service).toContain("ruleTargetPointKeysByAsset(");
    expect(service).toContain("assertCompatiblePoint(");
  });
});

describe("F3.49 — rule-points.ts has one reader of the map and one of template_points", () => {
  it("calls pointKeysForAsset once and selects from templatePoints once", () => {
    const declarations = countOf(points, "export function pointKeysForAsset(");
    // Anti-vacuity for the subtraction below: the declaration is counted, so
    // "one call" is one call and not "zero calls plus the declaration".
    expect(declarations, "`pointKeysForAsset` is no longer declared in rule-points.ts").toBe(1);
    expect(
      countOf(points, "pointKeysForAsset(") - declarations,
      "`rule-points.ts` reads the hard-coded map in more than one place. `mergeRulePointKeys` " +
        "is the one reader; a second — such as the map-first short-circuit `E2.4` Q1 had in " +
        "`assertCompatiblePoint` — is a second code path that changes no answer today and " +
        "drifts silently the next time either side widens (ADR 0058 Amendment 2).",
    ).toBe(1);

    // Anti-vacuity: the table is imported, so `.from(templatePoints)` is the
    // read and not a name that stopped resolving.
    expect(points).toMatch(/import \{[^}]*\btemplatePoints\b[^}]*\} from "@bms\/db"/);
    expect(
      countOf(points, ".from(templatePoints)"),
      "`rule-points.ts` queries `template_points` in more than one place. " +
        "`ruleTargetPointKeysByAsset` is the one query; a second one — an unfiltered read for the " +
        "catalog's `assetIds == null` branch, say — is a second union.",
    ).toBe(1);
  });

  it("assertCompatiblePoint's body consults ruleTargetPointKeysByAsset", () => {
    const body = bodyOf(points, "export async function assertCompatiblePoint(", POINTS_REL);
    // A slicer that returned the whole file would make the claim unfalsifiable.
    expect(body.length).toBeGreaterThan(200);
    expect(body.length).toBeLessThan(points.length);
    expect(
      body,
      "`assertCompatiblePoint` no longer refuses against `ruleTargetPointKeysByAsset`'s answer. " +
        "That is the validator half of picker == validator; without it the two are two lists again.",
    ).toContain("ruleTargetPointKeysByAsset(");
  });
});

describe("F3.49 — getBuilderCatalog offers ruleTargetPointKeysByAsset's answer", () => {
  it("getBuilderCatalog's body consults ruleTargetPointKeysByAsset", () => {
    const body = bodyOf(service, "async getBuilderCatalog(", SERVICE_REL);
    expect(body.length).toBeGreaterThan(200);
    expect(body.length).toBeLessThan(service.length);
    expect(
      body,
      "`getBuilderCatalog` no longer offers `ruleTargetPointKeysByAsset`'s answer. That is the " +
        "picker half of picker == validator.",
    ).toContain("ruleTargetPointKeysByAsset(");
  });
});
