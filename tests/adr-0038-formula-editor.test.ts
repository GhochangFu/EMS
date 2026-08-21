import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * ADR 0038 decision 5: the formula preview is a **pure** function of the sample
 * values the author types. It does not fetch live telemetry, because a formula
 * being authored belongs to a template, and a template has no asset until
 * `F2.2` instantiates it — there is no live reading to read.
 *
 * That is the one promise a behavioural test cannot show. A preview that grew a
 * `fetch` would still return the right number for every input this suite passes
 * it; only a source scan sees the import.
 *
 * **Why here and not beside the module.** `apps/web` is a browser project — its
 * `tsconfig` carries no `node` types, so `node:fs` does not typecheck there, and
 * its Vitest project runs `src/**\/*.test.ts` only. The repo already keeps
 * source scans in `tests/` for the same reason; see
 * `tests/adr-0036-calc-dsl-no-eval.test.ts`, which this follows including its
 * guard against a scan that silently read nothing.
 *
 * Unit 8 extends this file with the other half of ADR 0038's static promise:
 * that `formula-editor.tsx` is the only module in the repository allowed to
 * import CodeMirror, which is what keeps the lazy chunk lazy.
 */
describe("ADR 0038 — the formula preview never reaches the network", () => {
  const rel = "apps/web/src/lib/calc-preview.ts";
  const source = readFileSync(join(repoRoot, rel), "utf8");

  it("read the module under test, so the scan below is not silently empty", () => {
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("export function previewFormula");
  });

  // `navigator.` and `window.` are listed alongside the obvious transports
  // because the cheapest way to smuggle a reading in is not `fetch` — it is
  // reading something the page already holds.
  for (const forbidden of [
    "fetch(",
    "adminFetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "sendBeacon",
    "navigator.",
    "window.",
    "useQuery",
    "socket.io",
    "axios",
  ]) {
    it(`does not reference ${forbidden}`, () => {
      expect(source).not.toContain(forbidden);
    });
  }

  it("imports only the calc DSL from @bms/shared, and nothing that fetches", () => {
    // Matched across the whole source, not line by line: the module's import is
    // a multi-line brace list, so its specifier sits on the closing `} from`
    // line. A per-line scan would find nothing and pass while proving nothing.
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual(["@bms/shared"]);
  });
});
