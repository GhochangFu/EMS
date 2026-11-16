import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR 0096 Amendment 2 — a deploy that CI starts ships only `main`'s newest commit.
 *
 * CI runs finish out of order: a code commit's full CI can end after a later
 * docs-only commit's short one. On 2026-11-16 the run for `6e26cb27` finished
 * last, and its deploy put that commit back on the AWS demo in place of
 * `61af5280` (E1.4 demo checks). The `gate` job now chooses the commit: a
 * CI-started run for `main`'s tip deploys it; one for an older commit deploys
 * the tip instead when the tip's CI has passed (its own deploy run may have been
 * replaced in the concurrency queue, PR #1364 code review), else nothing. The
 * build and deploy jobs read the commit from the gate. "Run workflow" (a
 * rollback by hand) deploys its own SHA.
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

/** The gate step's `run: |` script, dedented, as GitHub hands it to bash. */
function gateScript(source: string): string {
  const gate = job(source, "gate");
  const start = gate.indexOf("        run: |\n");
  if (start < 0) return "";
  const lines = gate.slice(start + "        run: |\n".length).split("\n");
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return `${body.join("\n").trimEnd()}\n`;
}

const A = "a".repeat(40);
const B = "b".repeat(40);

/**
 * Runs the gate's own script under bash with a stub `gh` (the tip and the tip's CI
 * conclusion come from the environment) and returns its exit code and outputs.
 */
function runGate(env: { EVENT: string; SHA: string; TIP?: string; TIP_CI?: string }): {
  code: number;
  outputs: Record<string, string>;
} {
  const dir = mkdtempSync(join(tmpdir(), "deploy-gate-"));
  try {
    const gh = join(dir, "gh");
    writeFileSync(
      gh,
      '#!/usr/bin/env bash\ncase "$*" in\n  *commits/main*) printf "%s\\n" "$FAKE_TIP" ;;\n' +
        '  *actions/workflows/ci.yml/runs*) printf "%s\\n" "$FAKE_TIP_CI" ;;\n  *) exit 9 ;;\nesac\n',
    );
    chmodSync(gh, 0o755);
    const script = join(dir, "gate.sh");
    writeFileSync(script, gateScript(workflow));
    const output = join(dir, "out");
    writeFileSync(output, "");
    let code = 0;
    try {
      execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
        env: {
          PATH: `${dir}:${process.env.PATH ?? ""}`,
          EVENT: env.EVENT,
          SHA: env.SHA,
          REPO: "owner/repo",
          GITHUB_OUTPUT: output,
          FAKE_TIP: env.TIP ?? "",
          FAKE_TIP_CI: env.TIP_CI ?? "",
        },
        stdio: "pipe",
      });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    return { code, outputs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")("ADR 0096 Amendment 2 — the gate's script, run under bash", () => {
  it("extracts the gate's script (positive control)", () => {
    expect(gateScript(workflow)).toContain('if [ "$tip" = "$SHA" ]; then');
  });

  it("a dispatch deploys its own SHA without asking GitHub", () => {
    expect(runGate({ EVENT: "workflow_dispatch", SHA: A })).toEqual({ code: 0, outputs: { sha: A, deploy: "true" } });
  });

  it("a CI-started run for main's tip deploys that commit", () => {
    expect(runGate({ EVENT: "workflow_run", SHA: B, TIP: B })).toEqual({ code: 0, outputs: { sha: B, deploy: "true" } });
  });

  it("an older commit deploys the tip instead once the tip's CI has passed", () => {
    expect(runGate({ EVENT: "workflow_run", SHA: A, TIP: B, TIP_CI: "success" })).toEqual({
      code: 0,
      outputs: { sha: B, deploy: "true" },
    });
  });

  it("an older commit deploys nothing while the tip's CI has not passed", () => {
    for (const TIP_CI of ["", "failure", "cancelled"]) {
      expect(runGate({ EVENT: "workflow_run", SHA: A, TIP: B, TIP_CI })).toEqual({
        code: 0,
        outputs: { deploy: "false" },
      });
    }
  });

  it("a malformed SHA or an unreadable tip fails the run", () => {
    expect(runGate({ EVENT: "workflow_dispatch", SHA: "main" }).code).not.toBe(0);
    expect(runGate({ EVENT: "workflow_run", SHA: A, TIP: "" }).code).not.toBe(0);
  });
});

describe("ADR 0096 Amendment 2 — a CI-started deploy ships only main's newest commit", () => {
  it("the job slicer finds a job and stops at the next one (positive control)", () => {
    const sample = "jobs:\n  a:\n    runs-on: x\n  b:\n    runs-on: y\n";
    expect(job(sample, "a")).toBe("  a:\n    runs-on: x\n");
    expect(job(sample, "b")).toBe("  b:\n    runs-on: y\n");
    expect(job(sample, "c")).toBe("");
  });

  it("the gate deploys a dispatch's own SHA, main's tip, or the tip in place of an older commit", () => {
    const gate = job(workflow, "gate");
    expect(gate, "deploy-aws.yml has no gate job").not.toBe("");
    // The SHA is checked first, whatever started the run.
    expect(gate).toMatch(/\[\[ "\$SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\] \|\| \{ echo "::error::[^"]*"; exit 1; \}/);
    expect(gate).toContain('if [ "$EVENT" != "workflow_run" ]; then');
    expect(gate).toMatch(/tip="\$\(gh api "repos\/\$REPO\/commits\/main" --jq \.sha\)"/);
    expect(gate).toContain('if [ "$tip" = "$SHA" ]; then');
    // An older commit: the tip's CI decides between deploying the tip and nothing.
    expect(gate).toContain('gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$tip&event=push&branch=main"');
    expect(gate).toContain('if [ "$tip_ci" = "success" ]; then');
    expect(gate).toContain('echo "sha=$tip" >> "$GITHUB_OUTPUT"');
    expect(gate).toContain('echo "deploy=false" >> "$GITHUB_OUTPUT"');
    expect(gate).toContain("deploy: ${{ steps.tip.outputs.deploy }}");
    expect(gate).toContain("sha: ${{ steps.tip.outputs.sha }}");
    expect(gate).toMatch(/^ {6}actions: read$/m);
    // An unreadable tip fails the run rather than deploying blind.
    expect(gate).toMatch(/\[\[ "\$tip" =~ \^\[0-9a-f\]\{40\}\$ \]\] \|\| \{ echo "::error::[^"]*"; exit 1; \}/);
  });

  it("the gate keeps the old condition: CI green on a push to main, or a dispatch", () => {
    expect(job(workflow, "gate")).toContain(
      "github.event_name != 'workflow_run' ||\n" +
        "      (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')",
    );
  });

  it("build runs only on the gate's yes, and build and deploy both read the gate's commit", () => {
    const build = job(workflow, "build");
    const deploy = job(workflow, "deploy");
    expect(build).toMatch(/^ {4}needs: gate$/m);
    expect(build).toMatch(/^ {4}if: needs\.gate\.outputs\.deploy == 'true'$/m);
    expect(deploy).toMatch(/^ {4}needs: \[gate, build\]$/m);
    for (const block of [build, deploy]) {
      expect(block).toMatch(/^ {4}env:\n {6}SHA: \$\{\{ needs\.gate\.outputs\.sha \}\}$/m);
    }
  });

  it("concurrency stays workflow-wide and never cancels, which the gate's guarantee rests on", () => {
    // No other deploy can land between the gate's check and this run's deploy only
    // while the whole workflow is one queue.
    expect(workflow).toMatch(/^concurrency:\n {2}group: deploy-aws-demo\n {2}cancel-in-progress: false$/m);
  });
});
