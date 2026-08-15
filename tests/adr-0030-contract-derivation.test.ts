import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sharedSrc = join(repoRoot, "packages", "shared", "src");
const contractsDir = join(sharedSrc, "contracts");

/**
 * ADR 0030 (`F4.23`) — the contract package stays single-source.
 *
 * ## Why these two rules and not the equality assertions
 *
 * The migration was proved by 81 type-level assertions that each schema was
 * *strictly identical* to the hand-written type it replaced. Those assertions
 * are **deliberately not in the repository**: once `index.ts` derives its types
 * with `z.infer`, `Strict<z.infer<S>, z.infer<S>>` is trivially `true` and
 * every one of them becomes a tautology. AGENTS.md §4.4 is a running list of
 * guards that passed while checking nothing; 79 vacuous assertions would have
 * been the next entry, and the fact that they were *once* meaningful is exactly
 * what would have made them hard to spot.
 *
 * What is left is the pair of properties that can still break, and that
 * nothing else would notice.
 */
describe("ADR 0030 — contracts stay single-source", () => {
  const contractFiles = () =>
    readdirSync(contractsDir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "equality.ts")
      .map((f) => join(contractsDir, f));

  it("declares no response type by hand beside its schema", () => {
    // ADR 0030 decision 2, and ADR 0029 decision 1's thesis on the response
    // side: the type is derived from the schema that enforces the shape. A
    // hand-written `export type Foo = { … }` in `index.ts` is a SECOND
    // description — it compiles, it looks right, and nothing tells you when it
    // stops matching the schema beside it.
    //
    // The carve-outs are named rather than pattern-matched, because "which
    // types are allowed to be hand-written" is a decision, not a shape.
    const source = readFileSync(join(sharedSrc, "index.ts"), "utf8");
    const declarations = [...source.matchAll(/^export type (\w+)\s*=\s*([\s\S]*?);$/gm)];

    expect(
      declarations.length,
      "no `export type X = …` found in index.ts — this scan is broken and passing means nothing",
    ).toBeGreaterThan(40);

    const offenders = declarations
      .filter(([, , body]) => !/\bz\.infer</.test(body ?? ""))
      .map(([, name]) => name as string);

    expect(
      offenders,
      `these types in packages/shared/src/index.ts are written by hand rather than derived:\n` +
        `${offenders.join(", ")}\n\n` +
        "Every response contract must be `z.infer<typeof someSchema>` over a schema in " +
        "`./contracts` (ADR 0030 decision 2). A hand-written type beside a schema is the " +
        "second description ADR 0029 decision 1 rejected: it is believed, and nothing " +
        "reports it drifting. If this type genuinely has no runtime — a point-key union " +
        "derived from an `as const` array, say — it belongs in `constants.ts`, not here.",
    ).toEqual([]);
  });

  it("never encodes an intersection with a flattening combinator", () => {
    // ADR 0030 Amendment 1, rules 1 and 2 — measured, not styled.
    //
    // `.merge()` and `.omit().extend()` FLATTEN `A & B` into a single object
    // type. The result is mutually assignable with the exported type, so the
    // assignability bar passes and every runtime test passes; only strict
    // type identity separates them. That is why this is a source rule: the
    // property it protects is invisible to every other kind of check, and the
    // migration proof that would have caught it is gone by design.
    const offenders: string[] = [];
    let scanned = 0;

    for (const file of contractFiles()) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      scanned += 1;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // prose about the rule is not the rule
          if (/\.merge\s*\(/.test(line) || /\.omit\s*\([^)]*\)\s*\.extend\s*\(/.test(line)) {
            offenders.push(`${rel}:${i + 1} — ${line.trim().slice(0, 80)}`);
          }
        });
    }

    expect(
      scanned,
      "no contract modules were scanned — the directory walk is broken",
    ).toBeGreaterThan(2);

    expect(
      offenders,
      `these lines flatten an intersection:\n${offenders.join("\n")}\n\n` +
        "Use `z.intersection(a, b)`. `.merge()` and `.omit().extend()` produce a single " +
        "flattened object type, which is mutually assignable with `A & B` but is NOT the " +
        "same type — so `z.infer` stops reproducing the exported type exactly, silently " +
        "(ADR 0030 Amendment 1, measured on LocationDashboardDto and " +
        "AdminAssetTemplateSummaryDto).",
    ).toEqual([]);
  });
});
