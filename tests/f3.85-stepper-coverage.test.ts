import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** `@bms/shared/copilot` through `createRequire` (it reads `packages/shared/dist`; rebuild it after a catalog edit). */
const require_ = createRequire(import.meta.url);
const { CANVAS_ENTRY_IDS, COPILOT_CATALOG } = require_("@bms/shared/copilot") as {
  CANVAS_ENTRY_IDS: readonly string[];
  COPILOT_CATALOG: readonly { id: string }[];
};

/**
 * `F3.85` PR 9 / ADR 0099 decision 6 (plan §11.0, owner ruling Q6) — the stepper coverage gate:
 * every catalog entry is the `entry` of a `WizardShell` somewhere in the web app. A new catalog
 * entry (release 2, `F3.86`) ships with its wizard or this gate fails.
 *
 * **What counts as wired** (the pattern the pages follow):
 *
 * - The file is a non-spec, non-test `.tsx` under `apps/web/src` — pages AND components, because
 *   the KPI tab lives in `components/asset-templates`.
 * - It renders `<WizardShell` on a non-comment line.
 * - The id is a string literal in a call on the `entry` prop, on one non-comment line:
 *   `entry={catalogEntry("dashboard.create")!}`. Any function name and an optional `!` are
 *   accepted; an entry held in a variable (`entry={createEntry}`) is NOT detected — write the
 *   literal call on the prop.
 *
 * **The walk reads code only**: every block comment (slash-star to star-slash, a JSX one in
 * braces included) is blanked first, across as many lines as it spans, and then every line that starts with `//` is dropped.
 * A commented-out wizard — on one line or on several — is not a wiring. The negative control
 * below holds both shapes. The blanking keeps the newlines, so the line split is unchanged.
 *
 * `F3.87` PR 5 / owner ruling Q1(a): a **canvas entry** (`CANVAS_ENTRY_IDS`) has no steps — its
 * form is the layout editor's canvas. It counts as wired when it is a row of {@link CANVAS_ENTRIES}
 * whose page exists and calls the row's write on a non-comment line (the same blanking as
 * `wizardEntryIds`). The rows equal `CANVAS_ENTRY_IDS`, so the two lists cannot drift.
 *
 * The `NOT_YET` list PRs 9–11 kept while the wizards landed in parallel was emptied by PR 10b
 * (#815) and deleted with the closure (PR 12).
 *
 * Assertions inline (§4.6 carves out `tests/`).
 */

const WEB_SRC = "apps/web/src";
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\//;
const SHELL = /<WizardShell\b/;
const ENTRY = /\bentry=\{\s*[A-Za-z_$][\w$]*\(\s*["']([A-Za-z][\w.]*)["']\s*\)\s*!?\s*\}/g;

/** `source` with every block comment blanked to its newlines, so a multi-line one counts for nothing. */
function withoutBlockComments(source: string): string {
  return source.replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, ""));
}

/** The catalog ids one source file wires as a `WizardShell` entry (the pattern in the docblock). */
export function wizardEntryIds(source: string): string[] {
  const lines = withoutBlockComments(source)
    .split(/\r?\n/)
    .filter((line) => !LINE_COMMENT.test(line));
  if (!lines.some((line) => SHELL.test(line))) return [];
  return lines.flatMap((line) => [...line.matchAll(ENTRY)].map((match) => match[1]!));
}

/** Every non-spec, non-test `.tsx` under `apps/web/src`, as repo-relative paths (a manual walk:
 * no reliance on `readdirSync`'s `recursive` option). */
function webSources(dir = WEB_SRC): string[] {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((dirent) => {
    const rel = `${dir}/${dirent.name}`;
    if (dirent.isDirectory()) return webSources(rel);
    const name = dirent.name;
    return name.endsWith(".tsx") && !name.endsWith(".spec.tsx") && !name.endsWith(".test.tsx") ? [rel] : [];
  });
}

/** id → the files that wire it. */
function wired(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of webSources()) {
    for (const id of wizardEntryIds(read(file))) {
      out.set(id, [...(out.get(id) ?? []), file]);
    }
  }
  return out;
}

const CATALOG_IDS = COPILOT_CATALOG.map((entry) => entry.id);

/** `F3.87` PR 5 / ruling Q1(a): each canvas entry, the editor page that is its form, and the write that page calls. */
const CANVAS_ENTRIES: readonly { id: string; page: string; write: string }[] = [
  { id: "mimicLayout.create", page: "apps/web/src/pages/admin/mimic-layout-editor-page.tsx", write: "createMimicLayout(" },
  { id: "mimicLayout.replace", page: "apps/web/src/pages/admin/mimic-layout-editor-page.tsx", write: "replaceMimicLayout(" },
];

/** The row's page holds the row's write call on a non-comment line; `false` when the page does not exist. */
export function canvasRowResolves(row: { page: string; write: string }, readSource: (rel: string) => string = read): boolean {
  let source: string;
  try {
    source = readSource(row.page);
  } catch {
    return false;
  }
  return withoutBlockComments(source)
    .split(/\r?\n/)
    .filter((line) => !LINE_COMMENT.test(line))
    .some((line) => line.includes(row.write));
}

describe("F3.85 stepper coverage — every catalog entry has a WizardShell (plan §11.0)", () => {
  it("positive control: the scan finds PR 9's dashboard.create wiring on the create page", () => {
    expect(wired().get("dashboard.create")).toContain("apps/web/src/pages/admin/dashboard-builder-page.tsx");
  });

  it("negative control: a commented-out WizardShell line is not counted", () => {
    const fixture = [
      "// <WizardShell entry={catalogEntry(\"dashboard.create\")!} />",
      "{/* <WizardShell entry={catalogEntry(\"dashboard.update\")!} /> */}",
    ].join("\n");
    expect(wizardEntryIds(fixture)).toEqual([]);
  });

  it("negative control: a WizardShell inside a multi-line JSX block comment is not counted", () => {
    const fixture = [
      "{/*",
      "<WizardShell",
      "  entry={catalogEntry(\"dashboard.create\")!}",
      "/>",
      "*/}",
    ].join("\n");
    expect(wizardEntryIds(fixture)).toEqual([]);
  });

  it("the same lines uncommented are counted (the negative control's positive half)", () => {
    const fixture = [
      "<WizardShell",
      "  entry={catalogEntry(\"dashboard.create\")!}",
      "/>",
    ].join("\n");
    expect(wizardEntryIds(fixture)).toEqual(["dashboard.create"]);
  });

  it("the catalog read from packages/shared/dist is not empty", () => {
    expect(CATALOG_IDS.length).toBeGreaterThan(0);
  });

  it("every catalog id is wired as a WizardShell entry, or is a canvas row whose page calls its write", () => {
    const found = wired();
    const canvas = new Set(CANVAS_ENTRIES.filter((row) => canvasRowResolves(row)).map((row) => row.id));
    const missing = CATALOG_IDS.filter((id) => !found.has(id) && !canvas.has(id));
    expect(missing).toEqual([]);
  });

  it("F3.87 PR 5: the canvas rows are exactly CANVAS_ENTRY_IDS from packages/shared/dist", () => {
    expect(CANVAS_ENTRIES.map((row) => row.id).sort()).toEqual([...CANVAS_ENTRY_IDS].sort());
  });

  it("F3.87 PR 5 positive control: both canvas rows resolve against the real editor page", () => {
    expect(CANVAS_ENTRIES.map((row) => [row.id, canvasRowResolves(row)])).toEqual([
      ["mimicLayout.create", true],
      ["mimicLayout.replace", true],
    ]);
  });

  it("F3.87 PR 5 negative control: a row naming a write the page does not call fails, as does a missing page", () => {
    expect(canvasRowResolves({ page: CANVAS_ENTRIES[0]!.page, write: "deleteMimicLayout(" })).toBe(false);
    expect(canvasRowResolves({ page: "apps/web/src/pages/admin/no-such-page.tsx", write: "createMimicLayout(" })).toBe(false);
    const commented = ["// createMimicLayout(body)", "/* replaceMimicLayout(id, body) */"].join("\n");
    expect(canvasRowResolves({ page: "fixture", write: "createMimicLayout(" }, () => commented)).toBe(false);
    expect(canvasRowResolves({ page: "fixture", write: "replaceMimicLayout(" }, () => commented)).toBe(false);
    expect(canvasRowResolves({ page: "fixture", write: "createMimicLayout(" }, () => "createMimicLayout(body);")).toBe(true);
  });

  it("every wired id is a catalog id (a typo in a page fails here, not at render)", () => {
    const unknown = [...wired().keys()].filter((id) => !CATALOG_IDS.includes(id));
    expect(unknown).toEqual([]);
  });
});
