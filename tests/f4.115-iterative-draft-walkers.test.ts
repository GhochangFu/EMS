import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.115` — the invariants a future edit could quietly undo.
 *
 * Assertions are **inline** here, which is §4.6's carve-out for the top-level
 * `tests/` directory; there is no `.spec` sibling.
 *
 * **CI runs this file, and that was confirmed by reading the wiring rather than
 * assumed.** The root `vitest.config.ts` declares a `repo` project whose
 * `include` glob covers every `.test.ts` under this directory, and
 * `.github/workflows/ci.yml` runs `pnpm typecheck` (line 76),
 * `pnpm typecheck:tests` (line 82) and `pnpm test:coverage` (line 181). The
 * type-check half is the one that needs a manual step: a file in `tests/` is
 * type-checked by nothing until it is named in the root `package.json`
 * `typecheck:tests` script, and this file is listed there.
 */

// Resolved from this file's own location, never from `process.cwd()`. A spec
// that reads repo files through `cwd` passes under a filtered run and dies
// under the root `pnpm test`, where the working directory is not the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const ONBOARDING_DIR = "apps/api/src/admin/onboarding";
const ADMIN_DIR = "apps/api/src/admin";
const TEMPLATE_SCHEMA_REL = "apps/api/src/admin/asset-templates/asset-templates-content.schema.ts";
const DRAFT_SCHEMA_REL = "apps/api/src/admin/onboarding/onboarding.schema.ts";
const SHARED_WALKER_REL = "apps/api/src/admin/stack-safe-json.ts";
const REDACTION_REL = "apps/api/src/admin/onboarding/onboarding-redaction.ts";

/**
 * The shape of a rebuild traversal: a stack of frames pairing the node being
 * read with the shell being filled.
 *
 * This is a **textual** pin and it is stated as one. It matches the frame
 * declaration both walkers carried before they were merged, which is what a
 * copy-paste of the walk would carry too; it cannot catch a second traversal
 * written from scratch under different names. The assertion that the shared
 * module itself still matches is what keeps it from going vacuous the day the
 * frame is rewritten.
 */
const REBUILD_FRAME = /\{\s*source:[\s\S]{0,160}?target:/;

/**
 * Every production `.ts` file under a directory, relative to the repo root.
 *
 * Iterative, so a directory added under `onboarding/` later is still walked.
 *
 * **`.test.ts` is excluded as well as `.spec.ts`**, and both exclusions are
 * needed rather than one: `onboarding-redaction.spec.ts` legitimately calls
 * `structuredClone` seven times to build its own fixtures, and no `.test.ts`
 * wrapper does today — so a filter that dropped only `.spec.ts` would pass now
 * and fail the day someone moves a fixture into a wrapper.
 */
function productionFilesUnder(relDir: string): string[] {
  const found: string[] = [];
  const pending: string[] = [relDir];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const entry of readdirSync(join(repoRoot, current), { withFileTypes: true })) {
      const rel = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(rel);
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        found.push(rel);
      }
    }
  }
  return found.sort();
}

describe("F4.115 — the onboarding draft's walkers stay iterative", () => {
  /**
   * The invariant that would have caught site 3.
   *
   * `structuredClone` recurses, and the draft is caller-supplied JSON that
   * `JSON.parse` accepts at any depth. Three call sites shipped, and the third
   * — `attachEncryptedCredentials` — was masked by the second, so verifying the
   * routes named in the plan could not see it. The directory is enumerated
   * rather than the three files listed, so a fourth site added later is caught
   * by this test rather than by a production 500.
   */
  it("has no structuredClone left in the onboarding module", () => {
    const files = productionFilesUnder(ONBOARDING_DIR);

    // A broken walk must fail loudly rather than pass having scanned nothing.
    expect(
      files.length,
      "the walk over the onboarding module found almost no files — it is broken, and an " +
        "empty offender list below would mean nothing",
    ).toBeGreaterThanOrEqual(8);

    const offenders = files.filter((rel) => read(rel).includes("structuredClone("));

    expect(
      offenders,
      `structuredClone survives in:\n${offenders.join("\n")}\n\n` +
        "It recurses, and every value in this module came from JSON.parse of a request body " +
        "or of a jsonb column, so its depth is whatever a caller chose. Use `cloneJson` from " +
        "`apps/api/src/admin/stack-safe-json.ts`. A RangeError is neither a ZodError nor an " +
        "HttpException, so the route answers 500 — on reads, and on the PATCH that would " +
        "have repaired the draft.",
    ).toEqual([]);
  });

  /**
   * The extraction cannot silently regrow a second copy.
   *
   * A re-declared local `exceedsDepth` would compile, pass every existing test,
   * and quietly reintroduce the drift §4.8 exists to prevent — two walkers to
   * fix the next time one of them is wrong.
   */
  it("keeps one exceedsDepth, imported from the shared module", () => {
    const source = read(TEMPLATE_SCHEMA_REL);

    expect(
      /function\s+exceedsDepth\s*\(/.test(source),
      `${TEMPLATE_SCHEMA_REL} declares its own exceedsDepth again. It moved to ` +
        "apps/api/src/admin/stack-safe-json.ts in F4.115 so the onboarding draft could use " +
        "the same walk; a second copy is a second thing to fix.",
    ).toBe(false);

    expect(
      /import\s*\{[^}]*\bexceedsDepth\b[^}]*\}\s*from\s*"\.\.\/stack-safe-json"/.test(source),
      `${TEMPLATE_SCHEMA_REL} must import exceedsDepth from "../stack-safe-json"`,
    ).toBe(true);
  });

  /**
   * One **rebuild** traversal, for the same reason as one `exceedsDepth`.
   *
   * `cloneJson` and `scrubSecrets` shipped as two copies of one stack of
   * `{source, target}` frames — same array branch, same shell-create-and-push,
   * same `Object.defineProperty` assign — differing in one `if` and in their
   * container predicate. That is the §4.8 drift the `exceedsDepth` extraction
   * was meant to end, regrown in the same commit. They are now one
   * `rebuildDeep` taking a predicate and a per-key visitor.
   *
   * The **predicates stay two**, deliberately: the clone's checks the prototype
   * and carries a `Date` across by reference, the scrub's descends into it and
   * rebuilds it as `{}`. That difference is behaviour, and it is pinned by an
   * assertion on each side rather than here —
   * `assertCloneJsonReturnsANonJsonObjectByReference` and
   * `assertScrubSecretsRebuildsANonJsonObject`. This test is about the walk, not
   * about what either caller descends into.
   */
  it("keeps one rebuild traversal, imported from the shared module", () => {
    const files = productionFilesUnder(ADMIN_DIR);

    // A broken walk must fail loudly rather than pass having scanned nothing.
    expect(
      files.length,
      "the walk over apps/api/src/admin found far too few files — it is broken, and the " +
        "single-match assertion below would mean nothing",
    ).toBeGreaterThanOrEqual(40);

    // ...and a regex that no longer matches the shared walker would make the
    // same assertion vacuous without the walk being broken at all.
    expect(
      REBUILD_FRAME.test(read(SHARED_WALKER_REL)),
      `${SHARED_WALKER_REL} no longer matches the frame-stack pattern this test searches for, ` +
        "so the single-match assertion below proves nothing. Update REBUILD_FRAME to the shape " +
        "rebuildDeep now uses.",
    ).toBe(true);

    expect(
      files.filter((rel) => REBUILD_FRAME.test(read(rel))),
      "more than one file under apps/api/src/admin declares a {source, target} rebuild stack. " +
        "cloneJson and scrubSecrets were two copies of that walk in F4.115 and were merged into " +
        "rebuildDeep in apps/api/src/admin/stack-safe-json.ts; a second copy is a second thing " +
        "to fix when one of them is wrong (§4.8).",
    ).toEqual([SHARED_WALKER_REL]);

    expect(
      /import\s*\{[^}]*\brebuildDeep\b[^}]*\}\s*from\s*"\.\.\/stack-safe-json"/.test(
        read(REDACTION_REL),
      ),
      `${REDACTION_REL} must build its scrub on rebuildDeep from "../stack-safe-json"`,
    ).toBe(true);
  });

  /**
   * The two *limits* stay separate by construction.
   *
   * They share the walker and nothing else. `MAX_CONTENT_DEPTH = 12` is derived
   * from how deep a human-authored template `content` nests;
   * `MAX_ONBOARDING_DRAFT_DEPTH = 10` from the draft skeleton plus the headroom
   * a free-form `config` needs. Collapsing them into one constant would make
   * each surface's derivation unreadable and would move both whenever either
   * was retuned.
   *
   * What is refused is an **import**, not a mention: each file's docblock cites
   * the other number by name, and that cross-reference is the thing that stops
   * the next reader assuming the two are meant to agree.
   */
  it("declares the two depth limits separately, each as its own numeric literal", () => {
    const draftSchema = read(DRAFT_SCHEMA_REL);
    const templateSchema = read(TEMPLATE_SCHEMA_REL);

    expect(
      /(?:^|\n)export const MAX_ONBOARDING_DRAFT_DEPTH = \d+;/.test(draftSchema),
      `${DRAFT_SCHEMA_REL} must declare MAX_ONBOARDING_DRAFT_DEPTH as its own numeric literal`,
    ).toBe(true);
    expect(
      /(?:^|\n)import[^;]*\bMAX_CONTENT_DEPTH\b/.test(draftSchema),
      `${DRAFT_SCHEMA_REL} must not import the template content limit — the walker is ` +
        "shared, the bound is not",
    ).toBe(false);

    expect(
      /(?:^|\n)const MAX_CONTENT_DEPTH = \d+;/.test(templateSchema),
      `${TEMPLATE_SCHEMA_REL} must declare MAX_CONTENT_DEPTH as its own numeric literal`,
    ).toBe(true);
    expect(
      /(?:^|\n)import[^;]*\bMAX_ONBOARDING_DRAFT_DEPTH\b/.test(templateSchema),
      `${TEMPLATE_SCHEMA_REL} must not import the draft's limit either`,
    ).toBe(false);
  });
});
