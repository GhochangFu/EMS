import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved from this file's own location, never from `process.cwd()`. A spec
// that reads repo files through `cwd` passes under a filtered run and dies
// under the root `pnpm test`, where the working directory is not the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const API_REL = "apps/api/src/admin/onboarding/onboarding.schema.ts";
const SHARED_REL = "packages/shared/src/contracts/onboarding.ts";

/** The four draft arrays, and the constant each one's cap must name. */
const EXPECTED_CAPS: Readonly<Record<string, string>> = {
  rtus: "MAX_ONBOARDING_RTUS",
  pointKeys: "MAX_ONBOARDING_POINT_KEYS",
  assets: "MAX_ONBOARDING_ASSETS",
  assetPoints: "MAX_ONBOARDING_ASSET_POINTS",
};

const FIELDS = Object.keys(EXPECTED_CAPS);

/**
 * `field: z.array(...)…` and the `.max(NAME)` on it, over source text whose
 * whitespace has been collapsed to single spaces.
 *
 * **What the pattern tolerates, measured rather than asserted.** Collapsing
 * whitespace is not on its own enough, and the first version of this file said
 * it was. `\s+ → " "` turns the repository's own established wrap
 *
 * ```ts
 *   rtus: z
 *     .array(draftRtuSchema)
 *     .max(MAX_ONBOARDING_RTUS)
 *     .optional(),
 * ```
 *
 * into `rtus: z .array(draftRtuSchema) .max(…)`, which a `z\.array` pattern does
 * not match at all — so the guard below fired with "only found 3 of 4", exactly
 * the misleading failure the collapse was supposed to prevent. That wrap is not
 * hypothetical: `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts:501-504`
 * is `thresholds: z` / `.array(gaugeThresholdSchema.strict())` /
 * `.max(MAX_GAUGE_THRESHOLDS)` / `.optional()` — the same four-line shape, on an
 * array, with a named cap constant. `assetPoints` in the shared copy is exactly
 * 100 characters, so it is the line a print-width change would wrap first, and
 * there is no Prettier or ESLint config here to do it automatically — a human
 * would, by hand, one line at a time. So the pattern allows whitespace around
 * every dot, and one `it` below reformats the real API source and re-scans it.
 *
 * It also allows up to **two** levels of nested parentheses inside
 * `z.array( … )`, so `z.array(z.object({ … }))` reads its cap instead of
 * stopping at the inner `)` and reporting `null` — which the first version did.
 *
 * **The honest limits of this scan**, in the register of
 * `tests/f4.102-file-interceptor-limits.test.ts`. It is a regex over text, not
 * a parse, so all of this passes it unseen:
 *
 * - a cap applied somewhere other than the array declaration — a `.superRefine`
 *   on the object, or a `.max()` on a schema constant declared elsewhere and
 *   referenced here;
 * - a constant that *names* the right thing while holding the wrong number.
 *   Nothing here can compare two values across two packages by reading text;
 *   `onboarding.schema.spec.ts` and `contracts/onboarding.spec.ts` parse real
 *   fixtures at `cap` and `cap + 1` and are what gate the behaviour;
 * - a third copy of the draft schema, in a file this list does not name;
 * - **a second declaration of the same field in one of these files.** The map
 *   is written by `set`, so the last match wins and an earlier unbounded
 *   declaration is invisible. Nothing declares these four twice today, but
 *   `F4.104`'s per-producer schema split would, and this is where it bites;
 * - **text inside a comment.** Collapsing whitespace makes a docblock
 *   indistinguishable from code to a regex, so a comment that quoted one of
 *   these declaration lines would satisfy the scan on its own. Neither file's
 *   docblocks do today;
 * - **a third level of nesting**, or a chain call carrying nested parentheses
 *   before `.max()` — those do not read as a cap of `null`, they stop the field
 *   matching at all, and the non-vacuity guard reports a missing *declaration*.
 *   Repair the parser when that happens; the message says so.
 *
 * What it does catch is the failure it exists for: one copy bounded and the
 * other not, or the two bounded by different constants. That drift typechecks,
 * passes both package suites, and is invisible until a client rejects a
 * response the server was happy to send.
 */
function capsIn(source: string): Map<string, string | null> {
  const collapsed = source.replace(/\s+/g, " ");
  const found = new Map<string, string | null>();

  for (const match of collapsed.matchAll(
    /\b(rtus|pointKeys|assets|assetPoints)\s*:\s*z\s*\.\s*array\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)((?:\s*\.\s*\w+\((?:[^()]|\([^()]*\))*\))*)/g,
  )) {
    const field = match[1] as string;
    const chain = match[2] ?? "";
    const cap = /\.\s*max\(\s*([A-Za-z0-9_]+)\s*\)/.exec(chain);
    found.set(field, cap === null ? null : (cap[1] as string));
  }

  return found;
}

/**
 * Non-vacuity. An empty or partial match set would compare `{}` against `{}`
 * below and the gate would pass having read nothing — the exact shape of a
 * guard that goes green while checking nothing (AGENTS.md §4.4). If the
 * declarations are reshaped, fix the parser; do not delete the assertion.
 */
function assertAllFourFound(caps: Map<string, string | null>, label: string): void {
  if (caps.size < FIELDS.length) {
    throw new Error(
      `only found ${caps.size} of ${FIELDS.length} draft array declarations in ${label} ` +
        `(${[...caps.keys()].join(", ") || "none"}). The four arrays are two declarations of ` +
        "one bound — repair this parser rather than the assertion.",
    );
  }
}

function declaredCaps(rel: string): Map<string, string | null> {
  const caps = capsIn(read(rel));
  assertAllFourFound(caps, rel);
  return caps;
}

/**
 * `F4.103` — the draft count caps, in both copies of the draft schema.
 *
 * There are two `onboardingDraftSchema` declarations and both are live.
 * `apps/api/src/admin/onboarding/onboarding.schema.ts` is the write path:
 * `patchDraftBodySchema` parses `PATCH :id/draft` bodies through it and
 * `OnboardingValidateService` re-parses the stored draft through it.
 * `packages/shared/src/contracts/onboarding.ts` is the response contract ADR
 * 0030 makes every DTO `z.infer` of, embedded in `onboardingSessionDtoSchema`
 * and `onboardingValidateResponseDtoSchema` and parsed at runtime by
 * `apps/web/src/api/admin/onboarding.ts`.
 *
 * Bounding one and not the other is a green build with an incoherent contract.
 */
describe("F4.103 — both copies of the onboarding draft schema carry the same count caps", () => {
  it("caps all four arrays in the API copy", () => {
    const caps = declaredCaps(API_REL);
    for (const field of FIELDS) {
      expect(caps.get(field), `${API_REL}: \`${field}\` must declare a .max(...)`).toBe(
        EXPECTED_CAPS[field],
      );
    }
  });

  it("caps all four arrays in the shared contract copy", () => {
    const caps = declaredCaps(SHARED_REL);
    for (const field of FIELDS) {
      expect(caps.get(field), `${SHARED_REL}: \`${field}\` must declare a .max(...)`).toBe(
        EXPECTED_CAPS[field],
      );
    }
  });

  it("names the same constant for the same array in both files", () => {
    const api = declaredCaps(API_REL);
    const shared = declaredCaps(SHARED_REL);

    // Compared as a pair of objects rather than field by field, so a field
    // present in one file and absent from the other is a diff and not a
    // silently skipped iteration.
    const asObject = (caps: Map<string, string | null>): Record<string, string | null> =>
      Object.fromEntries(FIELDS.map((field) => [field, caps.get(field) ?? null]));

    expect(asObject(api), "the two draft schemas must name the same cap constants").toEqual(
      asObject(shared),
    );
  });

  it("still reads all four caps when the declarations are wrapped into the chain form", () => {
    const original = read(API_REL);
    // The repository's own wrap, applied by hand where a line grows past the
    // print width: `field: z` / `.array(…)` / `.max(…)` / `.optional()`.
    const wrapped = original
      .replace(/: z\.array\(/g, ":\n      z\n        .array(")
      .replace(/\)\.max\(/g, ")\n        .max(")
      .replace(/\)\.optional\(\)/g, ")\n        .optional()");

    // The transform has to fire. If it silently matched nothing, this case
    // would re-scan the file in its shipped shape and be green having checked
    // nothing at all — the failure mode the non-vacuity guard exists for, one
    // level up.
    expect(wrapped, "the reformat must change the source").not.toBe(original);
    expect(
      /\bz\s*\n\s*\.array\(/.test(wrapped),
      "the reformat must produce the split `z` / `.array(` form this case is about",
    ).toBe(true);

    const caps = capsIn(wrapped);
    assertAllFourFound(caps, "the API copy, reformatted into the wrapped chain form");
    expect(caps.size, "every field is read, none skipped").toBe(FIELDS.length);
    for (const field of FIELDS) {
      expect(caps.get(field), `wrapped \`${field}\` must still read its cap`).toBe(
        EXPECTED_CAPS[field],
      );
    }
  });

  it("reads the cap through a nested z.object(...) inside the array", () => {
    // `[^)]*` stopped at the inner `)` and read this as an uncapped array. No
    // declaration is written this way today; one that is must not read as a
    // silent `null`.
    const nested =
      "assetPoints: z.array(z.object({ assetIndex: z.number() }))" +
      ".max(MAX_ONBOARDING_ASSET_POINTS).optional(),";
    expect(capsIn(nested).get("assetPoints")).toBe("MAX_ONBOARDING_ASSET_POINTS");
  });

  it("declares each cap constant exactly once, in the shared contract", () => {
    const shared = read(SHARED_REL);
    const api = read(API_REL);

    for (const name of Object.values(EXPECTED_CAPS)) {
      expect(
        new RegExp(`export const ${name}\\s*=`).test(shared),
        `${SHARED_REL} must export ${name} — it is the single declaration of this bound`,
      ).toBe(true);
      expect(
        new RegExp(`export const ${name}\\s*=`).test(api),
        `${API_REL} must IMPORT ${name} from @bms/shared, never re-declare it — a second ` +
          "declaration is the drift this file exists to prevent",
      ).toBe(false);
    }

    expect(
      /from "@bms\/shared"/.test(api),
      `${API_REL} must import the caps from the @bms/shared root entry, not the ` +
        "`/contracts` subpath — apps/api compiles with moduleResolution \"node\" and ignores " +
        "the exports map (ADR 0030 Amendment 2)",
    ).toBe(true);
  });
});
