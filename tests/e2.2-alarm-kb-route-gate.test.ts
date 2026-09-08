import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const controllerPath = join(repoRoot, "apps/api/src/alarm-kb/alarm-kb.controller.ts");
const appPath = join(repoRoot, "apps/web/src/app.tsx");
const shellPath = join(repoRoot, "apps/web/src/layouts/app-shell.tsx");
/**
 * Comments stripped before matching, and the first draft of this file did not
 * do that — it failed on its own subject. The controller's doc comment
 * *explains* that there is no `assertMasterDataRole` and no `readableAssetIds`
 * here, so a whole-file scan matched the prose and reported a gate that does
 * not exist. An invariant about code must read code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const controller = withoutComments(readFileSync(controllerPath, "utf8"));
const app = withoutComments(readFileSync(appPath, "utf8"));
const shell = withoutComments(readFileSync(shellPath, "utf8"));

/**
 * `E2.2` / ADR 0059 ruling **Q0b** — the KB stays open to `viewer`.
 *
 * The owner ruled that anyone who can see alarms may open the knowledge base,
 * `viewer` included, and explicitly **not** `isMasterDataRole`. That ruling
 * lives in the controller as an *absence*, and an absence is exactly what a
 * normal test cannot hold: adding `assertMasterDataRole` there breaks no
 * assertion anywhere, while quietly closing the surface this row was built to
 * open.
 *
 * The failure mode is also silent from the outside. A tightened gate would
 * either 403 — which reads as "not for me" rather than "a rule changed" — or,
 * if someone reached for the scope-filter route instead, return `{ classes: [] }`
 * and render as "no class carries a philosophy yet". That is the same
 * fail-open-as-empty shape `E7.1d` documents for the notification screens, and
 * it is the reason this file exists beside that one rather than inside
 * `repo-invariants.test.ts`.
 *
 * If a future ADR reverses Q0b, delete this test **in that ADR's PR** and say
 * so in its Consequences. Do not delete it to make a build pass.
 */
describe("E2.2 — the alarm KB route stays readable by viewer (ADR 0059 ruling Q0b)", () => {
  it("guards with JwtAuthGuard, so it is authenticated rather than public", () => {
    expect(controller).toMatch(/@UseGuards\(JwtAuthGuard\)/);
  });

  it("applies no master-data role gate", () => {
    expect(controller).not.toMatch(/assertMasterDataRole/);
    expect(controller).not.toMatch(/isMasterDataRole/);
    expect(controller).not.toMatch(/canManageTemplate/);
  });

  it("applies no operations write-role gate, because it is a read", () => {
    expect(controller).not.toMatch(/assertOperationsWriteRole/);
  });

  it("scopes by organization rather than by asset", () => {
    // `readableAssetIds` would be the wrong axis and would silently empty the
    // list for a viewer whose scope is a location: a template is org-scoped
    // master data and has no assets of its own.
    expect(controller).toMatch(/readableOrganizationIds/);
    expect(controller).not.toMatch(/readableAssetIds/);
  });
});

/**
 * The web half of ruling **Q0b**, which the post-merge review found had no gate
 * at all.
 *
 * `apps/web/src/pages/alarm-kb-page.spec.tsx` renders `<AlarmKbPage />`
 * directly, and that component contains no role branch — so its
 * `rendersForAViewer` assertion is invariant under every change that could
 * break the ruling. Wrap the route in `AdminRoute` and the page spec, its
 * runner, and the API gate above all stay green while a `viewer` is locked out.
 * That is AGENTS.md §4.6's `F4.37` class: a guard that is correct about the
 * component and never runs against the construct it names.
 *
 * These two assertions run against the construct.
 */
describe("E2.2 — the alarm KB is reachable and ungated in the web app", () => {
  it("routes /alarm-kb without AdminRoute", () => {
    const route = app.slice(app.indexOf('path="/alarm-kb"'));
    const element = route.slice(0, route.indexOf("/>") + 2);
    expect(element).toContain("AlarmKbPage");
    expect(element).not.toContain("AdminRoute");
    expect(element).not.toContain("requireNotificationAdmin");
  });

  /**
   * The review's finding 2: the page shipped reachable only by typing its URL,
   * which defeats Q0b end to end — PR 2 exists BECAUSE the operator cannot open
   * the template Alarms tab, and without a nav entry they cannot open its
   * replacement either. The repository already treats reachability as an
   * invariant class; see `tests/f2.14-stock-viewer-reachable.test.ts` and
   * `tests/f3.36-template-surface-reachable.test.ts`.
   */
  it("offers /alarm-kb in the app shell navigation", () => {
    expect(shell).toContain('path: "/alarm-kb"');
  });
});
