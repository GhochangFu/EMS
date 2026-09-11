import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `F2.22` T9 — the wording gate. Six sentences the editor mirrors from the
 * server, each copied by hand because `apps/web` cannot import `apps/api`
 * (design decision 6). A copy that drifts is worse than no copy: the editor
 * clears the author's problem and the save still fails, with different words.
 *
 * `node:fs` only — no `createRequire`, no `@bms/shared` import (plan
 * correction 43 does not apply here: nothing below reads a runtime symbol,
 * only source text).
 *
 * Every extraction is anchored on a code construct — a fixed substring that
 * appears next to the `message:`/`problems.push(` string literal or the
 * exported/local `const` — never on free-standing prose, and every extractor
 * asserts it found **exactly one** match per file before comparing anything
 * (anti-vacuity: a regex that finds zero or two matches fails the test by
 * itself, before any wording is even read).
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const FILES = {
  templateSchema: "apps/api/src/admin/asset-templates/asset-templates.schema.ts",
  templateContentSchema: "apps/api/src/admin/asset-templates/asset-templates-content.schema.ts",
  overrideSchema: "apps/api/src/admin/asset-points/asset-point-calc-override.schema.ts",
  overrideService: "apps/api/src/admin/asset-points/asset-point-calc-override.service.ts",
  templateCalcConfig: "apps/web/src/lib/template-calc-config.ts",
  overrideLib: "apps/web/src/lib/asset-point-calc-override.ts",
  formulaValidation: "apps/web/src/lib/template-formula-validation.ts",
  calcCycles: "apps/web/src/lib/template-calc-cycles.ts",
} as const;

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

const source = Object.fromEntries(
  Object.entries(FILES).map(([key, rel]) => [key, read(rel)]),
) as Record<keyof typeof FILES, string>;

/**
 * A JS string-literal concatenation (`` `a` + "b" ``) reduced to its content:
 * every delimiter-then-`+`-then-delimiter transition is a token boundary, not
 * text, so it is removed; any delimiter left at the very start or end of the
 * matched span (the anchor landed exactly on one) is stripped the same way;
 * whitespace across a line break collapses to one space, the same as it would
 * read as a single sentence.
 */
function joinConcatenatedLiteral(raw: string): string {
  return raw
    .replace(/[`"]\s*\+\s*\n?\s*[`"]/g, "")
    .replace(/^[`"]/, "")
    .replace(/[`"]$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds every match of `re` in `text` and requires there be exactly one — the
 * anti-vacuity condition every pair below relies on. Returns the one match's
 * full text (group 0) so a caller can run it through `joinConcatenatedLiteral`.
 */
function extractExactlyOne(text: string, re: RegExp, label: string): string {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const matches = [...text.matchAll(global)];
  expect(matches.length, `${label}: expected exactly one match, found ${matches.length}`).toBe(1);
  return matches[0][0];
}

/** Strips one trailing period — the only difference a mid-sentence copy (one
 * more clause follows in the source) and an end-of-sentence copy may have. */
function dropTrailingPeriod(sentence: string): string {
  return sentence.replace(/\.$/, "");
}

describe("F2.22 T9 — the editor's six copies of server wording, gated against drift", () => {
  // --- pair (a) — ADR 0055 decision 10's streaming-refusal sentence --------
  //
  // Four copies: the template save path, the override save path (both API),
  // and their two editor mirrors. Anchored on the fixed text that opens the
  // sentence (`A "${CALC_DIALECT_V2}" point`) through the fixed text that
  // closes it (`single reading`) — a code construct each of the four
  // `message:`/`problems.push(` literals is built from, never prose.
  it("pair (a) — the streaming-refusal sentence is identical across all four copies", () => {
    const RE = /A "\$\{CALC_DIALECT_V2\}" point[\s\S]*?single reading\.?/;
    const server1 = dropTrailingPeriod(
      joinConcatenatedLiteral(extractExactlyOne(source.templateSchema, RE, "asset-templates.schema.ts")),
    );
    const server2 = dropTrailingPeriod(
      joinConcatenatedLiteral(
        extractExactlyOne(source.overrideSchema, RE, "asset-point-calc-override.schema.ts"),
      ),
    );
    const web1 = dropTrailingPeriod(
      joinConcatenatedLiteral(extractExactlyOne(source.templateCalcConfig, RE, "template-calc-config.ts")),
    );
    const web2 = dropTrailingPeriod(
      joinConcatenatedLiteral(extractExactlyOne(source.overrideLib, RE, "asset-point-calc-override.ts")),
    );

    expect(server1).toBe(
      'A "${CALC_DIALECT_V2}" point requires calcTrigger: "scheduled" — a cross-asset formula ' +
        "resolves its members once per sweep and cannot run on a single reading",
    );
    expect(server2).toBe(server1);
    expect(web1).toBe(server1);
    expect(web2).toBe(server1);
  });

  // --- pair (b) — the two derived-reference sentences -----------------------
  //
  // `asset-templates.schema.ts:304-307`'s ternary versus
  // `template-formula-validation.ts`'s two consts, copied since `F2.5` and
  // gated by nothing until this task. Anchored on the fixed opening clause of
  // each branch (self vs. sibling) and on the const name, respectively.
  it("pair (b) — the self-reference sentence matches DERIVED_SELF_REFERENCE_MESSAGE", () => {
    const SERVER_RE = /"This point's formula references itself[\s\S]*?measured points"/;
    const WEB_RE = /DERIVED_SELF_REFERENCE_MESSAGE\s*=\s*\n?\s*"([^"]*)"/;

    const serverRaw = extractExactlyOne(source.templateSchema, SERVER_RE, "asset-templates.schema.ts (self)");
    const server = joinConcatenatedLiteral(serverRaw);

    const webGlobal = new RegExp(WEB_RE.source, "g");
    const webMatches = [...source.formulaValidation.matchAll(webGlobal)];
    expect(webMatches.length, "template-formula-validation.ts: DERIVED_SELF_REFERENCE_MESSAGE").toBe(1);
    const web = webMatches[0][1];

    expect(server).toBe(
      "This point's formula references itself — a derived formula may only reference measured points",
    );
    expect(web).toBe(server);
  });

  it("pair (b) — the sibling-reference sentence matches DERIVED_SIBLING_REFERENCE_MESSAGE", () => {
    const SERVER_RE = /"This point's formula references another derived point[\s\S]*?measured points"/;
    const WEB_RE = /DERIVED_SIBLING_REFERENCE_MESSAGE\s*=\s*\n?\s*"([^"]*)"/;

    const serverRaw = extractExactlyOne(
      source.templateSchema,
      SERVER_RE,
      "asset-templates.schema.ts (sibling)",
    );
    const server = joinConcatenatedLiteral(serverRaw);

    const webGlobal = new RegExp(WEB_RE.source, "g");
    const webMatches = [...source.formulaValidation.matchAll(webGlobal)];
    expect(webMatches.length, "template-formula-validation.ts: DERIVED_SIBLING_REFERENCE_MESSAGE").toBe(1);
    const web = webMatches[0][1];

    expect(server).toBe(
      "This point's formula references another derived point — a derived formula may only " +
        "reference measured points",
    );
    expect(web).toBe(server);
  });

  // --- pair (c) — the cycle sentence's fixed parts ---------------------------
  //
  // `asset-templates.schema.ts:341-347` versus `template-calc-cycles.ts` (T4).
  // The member list is data (`cycle.members.join(", ")` vs. `members.join(",
  // ")`), so both `${...}` interpolations are normalised to one placeholder
  // before the fixed prefix and suffix around it are compared.
  it("pair (c) — the cycle sentence's fixed prefix and suffix match, member list excepted", () => {
    const RE = /lies on a dependency cycle[\s\S]*?instantiated beside other assets\./;
    const serverRaw = extractExactlyOne(source.templateSchema, RE, "asset-templates.schema.ts (cycle)");
    const webRaw = extractExactlyOne(source.calcCycles, RE, "template-calc-cycles.ts (cycle)");

    const normalize = (raw: string): string =>
      joinConcatenatedLiteral(raw).replace(/\$\{[^}]*\}/g, "<members>");

    const server = normalize(serverRaw);
    const web = normalize(webRaw);

    expect(server).toBe(
      "lies on a dependency cycle. The points on it are: <members>. None of them can ever " +
        "compute — each waits on another, so all of them stay unwritten. Only this template's " +
        "own points are in view when it saves: @site resolves to the keys declared here, and " +
        "@domain, @group and {CODE.key} resolve to nothing until assets exist. This check " +
        "therefore reports the cycle it found and cannot rule out one that appears once the " +
        "template is instantiated beside other assets.",
    );
    expect(web).toBe(server);
  });

  // --- pair (d) — the ratio-placement sentence -------------------------------
  //
  // `asset-templates.schema.ts:195-196` versus `template-calc-config.ts`,
  // which cites the server's line number in a comment and copies the sentence
  // verbatim.
  it("pair (d) — the ratio-placement sentence matches template-calc-config.ts", () => {
    const RE =
      /minCoverageRatio applies only to a derived point in the "\$\{CALC_DIALECT_V2\}"[\s\S]*?must be fresh/;
    const server = joinConcatenatedLiteral(
      extractExactlyOne(source.templateSchema, RE, "asset-templates.schema.ts (ratio)"),
    );
    const web = joinConcatenatedLiteral(
      extractExactlyOne(source.templateCalcConfig, RE, "template-calc-config.ts (ratio)"),
    );

    expect(server).toBe(
      'minCoverageRatio applies only to a derived point in the "${CALC_DIALECT_V2}" dialect — ' +
        "it is the fraction of an aggregate's declared members that must be fresh",
    );
    expect(web).toBe(server);
  });

  // --- pair (e) — the unused-pointKeys sentence ------------------------------
  //
  // `asset-templates-content.schema.ts` (~line 349, `templateKpiSchema`'s
  // `superRefine`) versus `template-formula-validation.ts`'s
  // `UNUSED_POINT_KEYS_MESSAGE`. Gated by nothing until this task.
  it("pair (e) — the unused-pointKeys sentence matches UNUSED_POINT_KEYS_MESSAGE", () => {
    const SERVER_RE = /message:\s*[`"]Every entry in pointKeys[\s\S]*?at least once[`"]/;
    const WEB_RE = /UNUSED_POINT_KEYS_MESSAGE\s*=\s*\n?\s*"([^"]*)"/;

    const serverRaw = extractExactlyOne(
      source.templateContentSchema,
      SERVER_RE,
      "asset-templates-content.schema.ts (unused pointKeys)",
    );
    const server = joinConcatenatedLiteral(
      serverRaw.replace(/^message:\s*/, ""),
    );

    const webGlobal = new RegExp(WEB_RE.source, "g");
    const webMatches = [...source.formulaValidation.matchAll(webGlobal)];
    expect(webMatches.length, "template-formula-validation.ts: UNUSED_POINT_KEYS_MESSAGE").toBe(1);
    const web = webMatches[0][1];

    expect(server).toBe("Every entry in pointKeys must be referenced by expression at least once");
    expect(web).toBe(server);
  });

  // --- pair (f) — the override save path's own cycle sentence ---------------
  //
  // `asset-point-calc-override.service.ts` (T12, find by the literal below —
  // the plan's `:227-231` citation predates T11) versus its editor mirror in
  // `asset-point-calc-override.ts`'s `draftProblems` (T12, panel PR 2). The
  // member list is data the server computes from the full cycle
  // (`cycle.map(...).join(" → ")`), and the editor can only ever see a
  // cycle of length one (its own key) — so, like pair (c), only the fixed
  // prefix and suffix around that difference are compared.
  it("pair (f) — the override save path's cycle sentence matches its editor mirror in prefix and suffix", () => {
    const PREFIX_RE = /This formula would form a dependency cycle:/;
    const SUFFIX_RE = /Every point on a cycle waits on another[\s\S]*?points in\.?/;

    const serverPrefix = joinConcatenatedLiteral(
      extractExactlyOne(
        source.overrideService,
        PREFIX_RE,
        "asset-point-calc-override.service.ts (cycle prefix)",
      ),
    );
    const webPrefix = joinConcatenatedLiteral(
      extractExactlyOne(source.overrideLib, PREFIX_RE, "asset-point-calc-override.ts (cycle prefix)"),
    );
    const serverSuffix = dropTrailingPeriod(
      joinConcatenatedLiteral(
        extractExactlyOne(
          source.overrideService,
          SUFFIX_RE,
          "asset-point-calc-override.service.ts (cycle suffix)",
        ),
      ),
    );
    const webSuffix = dropTrailingPeriod(
      joinConcatenatedLiteral(
        extractExactlyOne(source.overrideLib, SUFFIX_RE, "asset-point-calc-override.ts (cycle suffix)"),
      ),
    );

    expect(serverPrefix).toBe("This formula would form a dependency cycle:");
    expect(webPrefix).toBe(serverPrefix);

    expect(serverSuffix).toBe(
      "Every point on a cycle waits on another, so none of them ever computes. Break " +
        "the loop — change this formula, or the aggregate scope that draws the other " +
        "points in",
    );
    expect(webSuffix).toBe(serverSuffix);
  });
});
