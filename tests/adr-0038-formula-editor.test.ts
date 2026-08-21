import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
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

/**
 * ADR 0038 decision 7 with Amendment 2: `formula-editor.tsx` is the only module
 * allowed to import CodeMirror. Everything else goes through
 * `formula-editor-lazy.tsx`, whose `import()` is what makes Rollup emit the
 * library as its own chunk instead of folding it into the entry bundle every
 * page downloads.
 *
 * **Amendment 2 made this load-bearing.** Decision 7 originally declared one
 * dependency line, so `@codemirror/lint` and friends were unresolvable from
 * anywhere and the resolver enforced the rule for free. Five declared packages
 * are five names any component can now import without the resolver objecting.
 * This test is what replaced that accident.
 *
 * Verified against a real build before it was written: a probe entry importing
 * the lazy wrapper split into a 145 kB entry with **zero** CodeMirror in it and
 * a 418 kB `formula-editor` chunk. Unit 10 measures the shipped bundle; this is
 * the cheap check that runs on every commit in between.
 */
describe("ADR 0038 — only the lazy editor module imports CodeMirror", () => {
  const webSrc = join(repoRoot, "apps/web/src");
  const allowed = "components/asset-templates/formula-editor.tsx";

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(full);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  const files = walk(webSrc).map(
    (full) => [relative(webSrc, full).split("\\").join("/"), readFileSync(full, "utf8")] as const,
  );

  it("found the web sources, so the scan below is not silently empty", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(([rel]) => rel)).toContain(allowed);
  });

  it("no module outside the lazy editor imports codemirror or @codemirror/*", () => {
    const offenders = files
      .filter(([rel]) => rel !== allowed)
      .filter(([, text]) => /\bfrom\s+["'](codemirror|@codemirror\/[^"']+)["']/.test(text))
      .map(([rel]) => rel);
    expect(
      offenders,
      "Import the editor through components/asset-templates/formula-editor-lazy.tsx. " +
        "A direct import puts CodeMirror in the entry chunk that every page downloads.",
    ).toEqual([]);
  });

  it("the lazy wrapper reaches the editor only through a dynamic import", () => {
    const wrapper = readFileSync(
      join(webSrc, "components/asset-templates/formula-editor-lazy.tsx"),
      "utf8",
    );
    expect(wrapper).toContain('import("./formula-editor")');
    // A value import of the editor would evaluate it eagerly and defeat the
    // split. `import type` is erased at compile time and is the only form
    // allowed here.
    expect(wrapper).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+["']\.\/formula-editor["']/m);
  });

  it("the editor never imports basicSetup or @codemirror/search (Amendment 1)", () => {
    const editor = readFileSync(join(webSrc, allowed), "utf8");
    // Import statements only, never the whole file. The rule is "do not import
    // basicSetup", and the module's docblock has to be free to say why — a scan
    // that failed on the explanation would push the reasoning out of the file
    // that needs it most.
    // Anchored at line start with the `m` flag. An unanchored `import` also
    // matches the word inside the docblock and then runs on to the first real
    // `from`, which drags the prose back into the scan.
    const importStatements = [...editor.matchAll(/^import[\s\S]*?from\s+["'][^"']+["']/gm)]
      .map((match) => match[0])
      .join("\n");
    expect(importStatements).toContain("@codemirror/view");
    expect(importStatements).toContain("minimalSetup");
    expect(importStatements).not.toContain("basicSetup");
    expect(importStatements).not.toContain("@codemirror/search");
  });
});
