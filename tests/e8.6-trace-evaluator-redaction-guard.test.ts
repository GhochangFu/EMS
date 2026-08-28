import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rulesDir = join(repoRoot, "apps", "api", "src", "rules");
const readsPath = join(rulesDir, "rule-reads.ts");
const servicePath = join(rulesDir, "rules.service.ts");
const controllerPath = join(rulesDir, "rules.controller.ts");

/**
 * `E8.6` / ADR 0046 Amendment 3 — **a static test, and it says so.**
 *
 * AGENTS.md §4.4: when a guarantee cannot be expressed behaviourally, write a
 * static one and name which it is. Three claims here are that case, and the
 * reasons differ. What *is* behavioural — that a redacting read drops the key
 * and a non-redacting one keeps it — lives in
 * `rules.service.rls.integration.spec.ts` and is deliberately not duplicated.
 *
 * 1. **Redacted in SQL, not in the `.map()`.** A JS-side scrub returns
 *    identical bytes to the caller and passes every integration assertion. What
 *    it loses is the property the constraint is about: the value must never
 *    leave Postgres for a reader not entitled to it, because a row that crosses
 *    the wire can reach a query log or an error dump.
 * 2. **The controller derives the flag from the DB role.** The integration
 *    assertions call `listExecutions` directly and pass the flag themselves, so
 *    they cannot see how the *route* computes it — the endpoint could redact
 *    for everyone or no one and they would still pass. `readableAssetIds`
 *    already returns `null` exactly for `admin`, so `assetIds === null` is a
 *    tempting and wrong shortcut; Amendment 2 forbids it, because a future role
 *    resolving to an unrestricted scope would silently stop redacting.
 * 3. **The parameter stays required.** A default is a call site nobody has to
 *    think about. This endpoint has no role gate of its own, so the compiler
 *    finding every caller is the control — the same reason ADR 0030 made
 *    `checkResponse`'s `schema` parameter required.
 */

const reads = readFileSync(readsPath, "utf8");
const service = readFileSync(servicePath, "utf8");
const controller = readFileSync(controllerPath, "utf8");

describe("E8.6 / ADR 0046 Amendment 3 — the evaluator's subject is redacted in SQL, by role", () => {
  it("removes the key with the jsonb operator inside a sql template", () => {
    expect(
      /sql`[^`]*- 'evaluatedBy'/s.test(reads),
      "traceProjection must remove the key with the jsonb `-` operator inside a `sql` " +
        "template. A JS-side scrub returns identical bytes but has already shipped the value " +
        "out of Postgres — see this file's header.",
    ).toBe(true);

    expect(
      /jsonb_typeof\([^)]*\) = 'object'/.test(reads),
      "traceProjection must keep the jsonb_typeof guard. `jsonb - text` raises `cannot " +
        "delete from scalar` on a string, number or boolean, and `trace` is unbounded jsonb " +
        "with no CHECK — that is a 500 for non-admin callers only, never for the admin who " +
        "skips the branch.",
    ).toBe(true);
  });

  it("reaches the select list, and the row mapping never touches the key", () => {
    expect(
      /trace: traceProjection\(redactEvaluatedBy\),/.test(service),
      "listExecutions must select `traceProjection(redactEvaluatedBy)`. Building the " +
        "expression and then selecting the raw column leaves it orphaned and returns the " +
        "subject to every reader — existence is not reach.",
    ).toBe(true);

    const start = service.indexOf("  async listExecutions(");
    expect(start, "rules.service.ts must still declare `async listExecutions(`").toBeGreaterThan(-1);
    const end = service.indexOf("\n  }", start);
    const body = service.slice(start, end);
    const mappingStart = body.indexOf("items: rows.map(");
    expect(
      mappingStart,
      "listExecutions must still map its rows. If it was refactored, re-anchor this scan — " +
        "do not delete it.",
    ).toBeGreaterThan(-1);
    expect(
      /evaluatedBy|\bdelete\b/.test(body.slice(mappingStart)),
      "the row mapping must not touch evaluatedBy. Redacting there passes every behavioural " +
        "assertion and breaks constraint 1.",
    ).toBe(false);
  });

  it("derives the flag from the database role, never from the scope", () => {
    expect(
      /isGlobalAdmin\(user\)/.test(controller),
      "the executions route must resolve the redaction from `accessControl.isGlobalAdmin` — " +
        "the DB role. `jwt.role` outlives a demotion by up to JWT_TTL, and in OIDC mode " +
        "roleFromClaims falls back to `viewer` when realm roles are absent.",
    ).toBe(true);

    const start = controller.indexOf('@Get("executions")');
    expect(start, "rules.controller.ts must still route GET executions").toBeGreaterThan(-1);
    const end = controller.indexOf("@Get(", start + 10);
    const route = controller.slice(start, end === -1 ? undefined : end);
    expect(
      /this\.rules\.listExecutions\([\s\S]*?!\(await this\.accessControl\.isGlobalAdmin\(user\)\)[\s\S]*?\)/.test(
        route,
      ),
      "the route must pass `!(await isGlobalAdmin(user))` as the redaction flag. Passing a " +
        "constant, or reusing the `assetIds === null` admin signal, is the failure this " +
        "guard exists to reject — see this file's header.",
    ).toBe(true);
  });

  it("keeps the redaction parameter required", () => {
    expect(
      /redactEvaluatedBy: boolean,?\s*\)/.test(service),
      "listExecutions' third parameter must stay a required `boolean` — not optional, not " +
        "defaulted. A default is a call site nobody has to think about, and this endpoint " +
        "has no role gate of its own, so the compiler finding every caller is the control.",
    ).toBe(true);
  });
});
