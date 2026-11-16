import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * E1.1 (ADR 0135 decisions 6 and 7, plan T4.1/T4.3): the apps/ml image is CPU
 * only, its model weights are pinned to an exact Hugging Face revision and
 * baked in at build time, and a running scorer makes no outbound call.
 *
 * - The lock holds no CUDA wheel (`nvidia-*`) and no `triton`: decision 6.
 * - torch comes from the PyTorch CPU index, and nothing else does; E1.2's
 *   scikit-learn, scipy, joblib and threadpoolctl come from PyPI.
 * - `ML_MODEL_REVISION` defaults to a 40-hex commit, never `main`: decision 7.
 * - The runtime stage sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, so a
 *   missing file fails loudly instead of being fetched.
 * - No `HF_TOKEN` anywhere: both models are ungated (checked at build time,
 *   2026-11-15), so no token is ever needed, and one in a layer would leak.
 * - The runtime user is not root; every `FROM` names a version, never `latest`.
 *
 * Repo-wide invariant: assertions inline (AGENTS.md §4.6 carve-out for tests/).
 */

const repoRoot = join(__dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const lock = read("apps/ml/uv.lock");
const dockerfile = read("apps/ml/Dockerfile");

/** `[[package]]` blocks of uv.lock as { name, source } pairs. */
function lockPackages(text: string): { name: string; source: string }[] {
  return text
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((block) => ({
      name: /^name = "([^"]+)"/m.exec(block)?.[1] ?? "",
      source: /^source = (.+)$/m.exec(block)?.[1] ?? "",
    }));
}

/** Dockerfile instructions with comments dropped and `\` continuations joined. */
function instructions(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const steps = instructions(dockerfile);

/** Stages in order: { name, base, steps }. */
const stages = steps.reduce<{ name: string; base: string; steps: string[] }[]>((acc, step) => {
  const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(step);
  if (from) acc.push({ name: from[2] ?? "", base: from[1] ?? "", steps: [] });
  else acc.at(-1)?.steps.push(step);
  return acc;
}, []);

/** The final stage's steps, with every stage it is built FROM before them. */
function chain(index: number): string[] {
  const stage = stages[index];
  if (!stage) return [];
  const parent = stages.findIndex((s, i) => i < index && s.name === stage.base);
  return [...(parent >= 0 ? chain(parent) : []), ...stage.steps];
}
const runtime = chain(stages.length - 1);

describe("E1.1 the apps/ml image: CPU only, pinned weights, offline at run time", () => {
  it("reads the lock (positive control: torch and numpy are there)", () => {
    const names = lockPackages(lock).map((p) => p.name);
    expect(names).toContain("torch");
    expect(names).toContain("numpy");
    expect(lockPackages("[[package]]\nname = \"nvidia-cublas-cu12\"\nsource = { registry = \"x\" }\n")).toEqual([
      { name: "nvidia-cublas-cu12", source: '{ registry = "x" }' },
    ]);
  });

  it("locks no CUDA wheel and no triton (decision 6)", () => {
    const gpu = lockPackages(lock)
      .map((p) => p.name)
      .filter((name) => name.startsWith("nvidia-") || name === "triton" || name.startsWith("cuda-"));
    expect(gpu).toEqual([]);
  });

  it("takes torch, and only torch, from the PyTorch CPU index", () => {
    const fromCpuIndex = lockPackages(lock)
      .filter((p) => p.source.includes("download.pytorch.org/whl/cpu"))
      .map((p) => p.name);
    // Two torch entries are expected: 2.15.0+cpu (Linux, Windows) and 2.15.0 (macOS).
    expect([...new Set(fromCpuIndex)]).toEqual(["torch"]);
  });

  it("locks scikit-learn and what it pulls in from PyPI (E1.2, ADR 0135 Amendment 5 A-g)", () => {
    const packages = lockPackages(lock);
    for (const name of ["scikit-learn", "scipy", "joblib", "threadpoolctl", "cloudpickle", "narwhals"]) {
      const sources = packages.filter((p) => p.name === name).map((p) => p.source);
      expect(sources, name).toEqual(['{ registry = "https://pypi.org/simple" }']);
    }
  });

  it("pins the model to a 40-hex revision of an Apache-2.0 Chronos repo, never a branch", () => {
    const revision = /^ARG ML_MODEL_REVISION=(\S+)$/m.exec(steps.join("\n"))?.[1];
    const repo = /^ARG ML_MODEL_REPO=(\S+)$/m.exec(steps.join("\n"))?.[1];
    expect(revision).toMatch(/^[0-9a-f]{40}$/);
    expect(["amazon/chronos-2", "amazon/chronos-bolt-small"]).toContain(repo);
  });

  it("pins the weights' content: a 64-hex ML_MODEL_SHA256, checked after the download", () => {
    expect(/^ARG ML_MODEL_SHA256=(\S+)$/m.exec(steps.join("\n"))?.[1]).toMatch(/^[0-9a-f]{64}$/);
    const run = steps.find((s) => /^RUN .*snapshot_download/.test(s)) ?? "";
    expect(run).toMatch(/hashlib\.sha256/);
    expect(run).toMatch(/digest == sha or sys\.exit/);
  });

  it("refuses at build time a revision that is not 40 hex, with a full match", () => {
    // A shell `grep` tests each line, so a value with a newline would pass it.
    expect(steps.some((s) => /^RUN .*ML_MODEL_REVISION.*re\.fullmatch\(r'\[0-9a-f\]\{40\}'/.test(s))).toBe(true);
  });

  it("runs offline: HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1 in the runtime stage", () => {
    const env = runtime.filter((s) => /^ENV\s/i.test(s)).join(" ");
    expect(env).toMatch(/\bHF_HUB_OFFLINE=1\b/);
    expect(env).toMatch(/\bTRANSFORMERS_OFFLINE=1\b/);
  });

  it("runs as a user that is not root", () => {
    const user = runtime.filter((s) => /^USER\s/i.test(s)).pop();
    expect(user, "the runtime stage has no USER line").toBeDefined();
    expect(user).not.toMatch(/^USER\s+(root|0)(:|\s|$)/i);
  });

  it("names a version on every FROM, never latest", () => {
    const froms = steps.filter((s) => /^FROM\s/i.test(s)).map((s) => s.split(/\s+/)[1] ?? "");
    expect(froms.length).toBeGreaterThanOrEqual(3);
    const stages = new Set(steps.map((s) => /^FROM\s+\S+\s+AS\s+(\S+)/i.exec(s)?.[1]).filter(Boolean));
    for (const image of froms.filter((f) => !stages.has(f))) {
      expect(image, image).toMatch(/:[^:/]+$/);
      expect(image, image).not.toMatch(/:latest$/);
    }
  });

  it("copies only the manifest, the lock, the README and the sources of apps/ml (tests in model-test only)", () => {
    const contextCopies = (list: string[]) =>
      list.filter((s) => /^COPY\s/i.test(s) && !/--from=/i.test(s)).flatMap((s) => s.split(/\s+/).slice(1, -1));
    expect(new Set(contextCopies(steps))).toEqual(
      new Set(["apps/ml/pyproject.toml", "apps/ml/uv.lock", "apps/ml/src", "apps/ml/README.md", "apps/ml/tests"]),
    );
    // The image that runs never carries the tests or the uv binary.
    expect(contextCopies(runtime)).toEqual([]);
    expect(runtime.some((s) => /COPY\s+--from=uv\b/i.test(s))).toBe(false);
    expect(stages.at(-1)?.name).toBe("runtime");
  });

  it("ships the runtime as the final stage, with a model-test stage built from the same base", () => {
    const names = stages.map((s) => s.name);
    expect(names).toContain("model-test");
    const runtimeStage = stages.at(-1);
    const testStage = stages.find((s) => s.name === "model-test");
    expect(testStage?.base).toBe(runtimeStage?.base);
  });

  it("carries no HF_TOKEN anywhere a build or a deployment reads", () => {
    const skip = new Set([".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "node_modules"]);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        if (skip.has(entry)) return [];
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const files = [
      ...walk(join(repoRoot, "apps/ml")),
      ...["docker-compose.yml", "deploy/aws/docker-compose.yml", ".github/workflows/ci.yml", ".github/workflows/deploy-aws.yml"]
        .map((p) => join(repoRoot, p))
        .filter(existsSync),
    ];
    const offenders = files.filter((f) => !f.endsWith("uv.lock") && readFileSync(f, "utf8").includes("HF_TOKEN"));
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });
});
