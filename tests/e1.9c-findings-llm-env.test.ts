import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 4 (owner, 2026-11-17: "yes, add the
 * OpenRouter setting as recommended") — `ML_FINDINGS_LLM_PROVIDER` and
 * `ML_FINDINGS_LLM_MODEL` are documented, empty, and reach every api container,
 * and `LlmResolver` is the only reader. The behaviour of each branch is
 * `llm-resolver.spec.ts`'s. Modelled on `tests/f4.267-vision-model-migration.test.ts`.
 * Assertions inline (§4.6, top-level `tests/`).
 */
const VARS = ["ML_FINDINGS_LLM_PROVIDER", "ML_FINDINGS_LLM_MODEL"] as const;

/** One service block of a compose file, from its header to the next service or top-level key. */
const serviceBlock = (compose: string, service: string): string => {
  const header = `\n  ${service}:\n`;
  const start = compose.indexOf(header);
  if (start < 0) throw new Error(`no "${service}" service`);
  const next = compose.slice(start + header.length).search(/\n {2}[a-z][\w-]*:\n|\n[a-z]/);
  return next < 0 ? compose.slice(start) : compose.slice(start, start + header.length + next);
};

const sourcesUnder = (dir: string): string[] =>
  readdirSync(join(repoRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) return sourcesUnder(rel);
    return /\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name) ? [rel] : [];
  });

describe("E1.9c — the findings model variables", () => {
  it("the block helper slices one service only (positive control)", () => {
    const compose = "services:\n  api:\n    environment:\n      A: 1\n  web:\n    environment:\n      B: 2\n";
    expect(serviceBlock(compose, "api")).toContain("A: 1");
    expect(serviceBlock(compose, "api")).not.toContain("B: 2");
  });

  it(".env.example lists both, empty, right after the LLM block", () => {
    expect(read(".env.example")).toMatch(/\nLLM_VISION_MODEL=\n(?:#[^\n]*\n)+ML_FINDINGS_LLM_PROVIDER=\nML_FINDINGS_LLM_MODEL=\n/);
  });

  it("the root compose passes both to api and api-replica, and to no other service", () => {
    const compose = read("docker-compose.yml");
    for (const service of ["api", "api-replica"]) {
      for (const name of VARS) expect(serviceBlock(compose, service), `${service} ${name}`).toContain(`${name}: \${${name}:-}`);
    }
    for (const name of VARS) expect(compose.split(`${name}: \${${name}:-}`).length - 1, name).toBe(2);
  });

  it("the AWS demo compose passes both to api only, and its .env template lists them", () => {
    const compose = read("deploy/aws/docker-compose.yml");
    for (const name of VARS) {
      expect(serviceBlock(compose, "api"), name).toContain(`${name}: \${${name}:-}`);
      expect(compose.split(`${name}: \${${name}:-}`).length - 1, name).toBe(1);
    }
    expect(read("deploy/aws/setup-server.sh")).toMatch(/\nML_FINDINGS_LLM_PROVIDER=\nML_FINDINGS_LLM_MODEL=\n/);
  });

  it("LlmResolver is the only source under apps/api that names either variable", () => {
    const readers = sourcesUnder("apps/api/src").filter((rel) => VARS.some((name) => read(rel).includes(name)));
    expect(readers).toEqual(["apps/api/src/llm/llm-resolver.ts"]);
  });
});
