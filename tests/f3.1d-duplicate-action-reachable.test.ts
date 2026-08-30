import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.1d` — the duplicate action ADR 0047 Amendment 2 ruling 3 owes this row must be
 * **reachable**, not merely written.
 *
 * **Why this rule exists, from the failure that produced it.** `F3.1d` Unit 9 shipped
 * `duplicate-dashboard-dialog.tsx` and five jsdom assertions covering it — the bindings
 * warning, the scope gating, the slug prefill, the id-dropping happy path, the non-atomic
 * failure — and **no page imported or rendered it**. Every one of those assertions mounts the
 * component directly, which is exactly what a reachability defect looks like from inside a
 * component spec: the suite was green and the feature did not exist. A component spec cannot
 * see that a *different* file fails to import it, so no amount of testing the dialog closes
 * this.
 *
 * **Why it is worth a rule rather than a one-off fix.** Amendment 2 ruling 2 reserved the
 * organization-wide dashboard to `admin` and `organization_admin`, which removed the route by
 * which a site admin shared a good dashboard with the other plants. Ruling 3 named copy as the
 * replacement **so the gap would not be closed later by widening the permission instead**. An
 * unreachable copy leaves that gap open with the paperwork done, which is the worse of the two
 * failures — the ADR reads as satisfied and the operator has nothing.
 *
 * **This lives in `tests/` and not beside the component on purpose.** `apps/web`'s tsconfig
 * carries no node types, so `node:fs` does not compile there; `pnpm typecheck` exits 2 on a
 * spec that reads the filesystem. `tests/` is where this repository puts static source rules
 * (`tests/f3.1c-widget-series-mapping.test.ts`, `tests/repo-invariants.test.ts`), and it is
 * typechecked by `typecheck:tests`, which lists this file by hand.
 */

const PAGES_ROOT = join(repoRoot, "apps/web/src/pages");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

/** The component, and the module it lives in. Both must appear for a page to count as a host: an import alone is not a render. */
const DIALOG_MODULE = "duplicate-dashboard-dialog";
const DIALOG_ELEMENT = "<DuplicateDashboardDialog";

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.(spec|test)\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Review finding — the positive control below used to RE-TYPE this expression by hand against
 * synthetic strings instead of calling this predicate. Weaken the check to a module-only test
 * (`src.includes(DIALOG_MODULE)` alone) and the hand-typed control stayed green — and so did the
 * main assertion, because the edit page genuinely does import the module — while the RULE this
 * file exists to enforce (a render, not merely an import) silently stopped being checked.
 * Exported so the control feeds the same two synthetic strings through the real predicate.
 */
export function isHostSource(src: string): boolean {
  return src.includes(DIALOG_MODULE) && src.includes(DIALOG_ELEMENT);
}

function hostPages(): string[] {
  return walk(PAGES_ROOT).filter((file) => isHostSource(readFileSync(file, "utf8")));
}

describe("F3.1d: the duplicate action is reachable from a page", () => {
  it("scanned a non-trivial number of pages (a broken walk would pass vacuously)", () => {
    // Over twenty page components exist under apps/web/src/pages at F3.1d HEAD. A walk that
    // silently returns nothing — a renamed root, a throw swallowed by the try/catch — would
    // make the rule below unfalsifiable, so it fails here first.
    expect(walk(PAGES_ROOT).length).toBeGreaterThan(10);
  });

  it("a page imports and renders DuplicateDashboardDialog", () => {
    expect(
      hostPages().map((f) => relative(repoRoot, f).replace(/\\/g, "/")),
      "some page under apps/web/src/pages must both import the duplicate-dashboard-dialog module " +
        "and render <DuplicateDashboardDialog>. ADR 0047 Amendment 2 ruling 3 owes F3.1d a " +
        "duplicate action, and a component nothing mounts is not one. Its own jsdom spec cannot " +
        "catch this: every assertion there renders the dialog directly and stays green with no " +
        "caller anywhere — which is how it shipped unreachable the first time.",
    ).not.toHaveLength(0);
  });

  it("the check requires a render and not merely an import", () => {
    // The positive control, synthetic rather than repo-derived so it cannot rot as the tree
    // changes: a page that imports the module but never mounts the component is the exact
    // half-wired state a bare `includes(module)` check would call a pass. Review finding: this
    // MUST call `isHostSource` — the same predicate `hostPages` uses — rather than re-typing the
    // expression, or a weakening of the real predicate leaves this control unable to see it.
    const importedOnly = 'import { DuplicateDashboardDialog } from "../components/dashboards/duplicate-dashboard-dialog";';
    expect(isHostSource(importedOnly)).toBe(false);

    const rendered = `${importedOnly}\n  return duplicating ? <DuplicateDashboardDialog onClose={close} /> : null;`;
    expect(isHostSource(rendered)).toBe(true);
  });
});
