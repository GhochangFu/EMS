import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR 0096 Amendment 2 — a deploy that CI starts ships only `main`'s newest commit.
 *
 * CI runs finish out of order: a code commit's full CI can end after a later
 * docs-only commit's short one. On 2026-11-16 the run for `6e26cb27` finished
 * last, and its deploy put that commit back on the AWS demo in place of
 * `61af5280` (E1.4 demo checks). The `gate` job now compares the commit with
 * `main`'s tip and skips the build and the deploy when they differ; the newer
 * commit's own run deploys it. "Run workflow" (a rollback by hand) is exempt.
 *
 * The workflow is YAML that CI never runs here, so its shape is held by text.
 * Assertions inline (§4.6, top-level `tests/`).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(repoRoot, ".github/workflows/deploy-aws.yml"), "utf8");

/** One top-level job's block: from `  <name>:` to the next two-space job key. */
function job(source: string, name: string): string {
  const start = source.search(new RegExp(`^  ${name}:\\n`, "m"));
  if (start < 0) return "";
  const rest = source.slice(start + name.length + 4);
  const next = rest.search(/^ {2}[a-z][\w-]*:\n/m);
  return next < 0 ? source.slice(start) : source.slice(start, start + name.length + 4 + next);
}

describe("ADR 0096 Amendment 2 — a CI-started deploy ships only main's newest commit", () => {
  it("the job slicer finds a job and stops at the next one (positive control)", () => {
    const sample = "jobs:\n  a:\n    runs-on: x\n  b:\n    runs-on: y\n";
    expect(job(sample, "a")).toBe("  a:\n    runs-on: x\n");
    expect(job(sample, "b")).toBe("  b:\n    runs-on: y\n");
    expect(job(sample, "c")).toBe("");
  });

  it("the gate compares the commit with main's tip for a CI-started run, and lets a dispatch through", () => {
    const gate = job(workflow, "gate");
    expect(gate, "deploy-aws.yml has no gate job").not.toBe("");
    expect(gate).toContain('if [ "$EVENT" != "workflow_run" ]; then');
    expect(gate).toMatch(/tip="\$\(gh api "repos\/\$REPO\/commits\/main" --jq \.sha\)"/);
    expect(gate).toContain('if [ "$tip" = "$SHA" ]; then');
    expect(gate).toContain('echo "deploy=false" >> "$GITHUB_OUTPUT"');
    expect(gate).toContain("deploy: ${{ steps.tip.outputs.deploy }}");
    // An unreadable tip fails the run rather than deploying blind.
    expect(gate).toMatch(/\[\[ "\$tip" =~ \^\[0-9a-f\]\{40\}\$ \]\] \|\| \{ echo "::error::[^"]*"; exit 1; \}/);
  });

  it("the gate keeps the old condition: CI green on a push to main, or a dispatch", () => {
    expect(job(workflow, "gate")).toContain(
      "github.event_name != 'workflow_run' ||\n" +
        "      (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')",
    );
  });

  it("build runs only on the gate's yes, and deploy still needs build", () => {
    const build = job(workflow, "build");
    expect(build).toMatch(/^ {4}needs: gate$/m);
    expect(build).toMatch(/^ {4}if: needs\.gate\.outputs\.deploy == 'true'$/m);
    expect(job(workflow, "deploy")).toMatch(/^ {4}needs: build$/m);
  });

  it("concurrency stays workflow-wide and never cancels, which the gate's guarantee rests on", () => {
    // No other deploy can land between the gate's check and this run's deploy only
    // while the whole workflow is one queue.
    expect(workflow).toMatch(/^concurrency:\n {2}group: deploy-aws-demo\n {2}cancel-in-progress: false$/m);
  });
});
