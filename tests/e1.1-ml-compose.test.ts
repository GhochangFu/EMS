import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * E1.1 (ADR 0135 decisions 3 and 7, plan R14 and T4.5): the local `ml` compose
 * service, held statically because CI never runs `docker compose`.
 *
 * - An opt-in profile of its own, `ml`: the image is large and a developer
 *   database holds no real data, so `core` never starts it.
 * - "A running scorer makes no outbound call" is topology: `ml` joins one
 *   network, `ml`, which is `internal: true` and shared with `postgres` alone,
 *   and it publishes no port (its health listener binds loopback inside).
 * - It connects as `bms_fleet` and is given no other database URL, and never a
 *   Hugging Face token.
 *
 * The AWS compose file gains the same service in plan PR 5, which extends this
 * file to it. The reader helpers are copied from
 * `tests/f4.61-ingest-network-isolation.test.ts` (file-local there); there is no
 * YAML parser in the repo, so a form the reader cannot read throws.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

function topLevelSection(compose: string, key: string): string {
  const start = new RegExp(`^${key}:\\s*$`, "m").exec(compose);
  if (start === null) return "";
  const after = compose.slice(start.index + start[0].length);
  const next = /\n[A-Za-z_][\w-]*:\s*$/m.exec(after);
  return next === null ? after : after.slice(0, next.index + 1);
}

function serviceBlock(compose: string, name: string): string {
  const start = new RegExp(`^ {2}${name}:\\s*$`, "m").exec(compose);
  expect(start, `docker-compose.yml must declare a \`${name}\` service`).not.toBeNull();
  const after = compose.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

function serviceNames(compose: string): string[] {
  const section = topLevelSection(compose, "services");
  return [...section.matchAll(/^ {2}([A-Za-z_][\w-]*):\s*$/gm)].map((m) => m[1] ?? "");
}

/** `- name` items under a 4-space `networks:` key, or the flow form; [] when absent; throws otherwise. */
function networksOf(block: string): string[] {
  const key = /^ {4}networks:(.*)$/m.exec(block);
  if (key === null) return [];
  const rest = (key[1] ?? "").trim();
  if (rest !== "") {
    const flow = /^\[([^\]]*)\]$/.exec(rest);
    if (flow === null) throw new Error(`cannot read "networks: ${rest}"`);
    return (flow[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  const names: string[] = [];
  for (const line of block.slice(key.index + key[0].length).split("\n")) {
    if (line.trim() === "") continue;
    const item = /^ {6}-\s*([A-Za-z_][\w-]*)\s*$/.exec(line);
    if (item) {
      names.push(item[1] ?? "");
      continue;
    }
    if (/^ {0,4}[A-Za-z_]/.test(line)) break;
    throw new Error(`cannot read the line ${JSON.stringify(line)}`);
  }
  return names;
}

/** The 4-space `environment:` map of a block as { KEY: value }. */
function environmentOf(block: string): Record<string, string> {
  const key = /^ {4}environment:\s*$/m.exec(block);
  if (key === null) return {};
  const env: Record<string, string> = {};
  for (const line of block.slice(key.index + key[0].length).split("\n")) {
    if (line.trim() === "") continue;
    const entry = /^ {6}([A-Z_][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (entry) {
      env[entry[1] ?? ""] = (entry[2] ?? "").replace(/^"(.*)"$/, "$1");
      continue;
    }
    if (/^ {0,4}[A-Za-z_]/.test(line)) break;
    throw new Error(`cannot read the environment line ${JSON.stringify(line)}`);
  }
  return env;
}

describe("E1.1 the local `ml` compose service (docker-compose.yml)", () => {
  const compose = withoutComments(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8"));
  const ml = serviceBlock(compose, "ml");

  it("the readers read (positive control)", () => {
    expect(serviceNames(compose)).toEqual(expect.arrayContaining(["postgres", "api", "ingest", "ml"]));
    expect(networksOf(serviceBlock(compose, "ingest")).length).toBeGreaterThan(0);
    expect(Object.keys(environmentOf(serviceBlock(compose, "worker")))).toContain("DATABASE_URL_FLEET");
  });

  it("runs only under its own opt-in profile", () => {
    expect(ml).toMatch(/^ {4}profiles: \["ml"\]\s*$/m);
  });

  it("builds the runtime stage of apps/ml/Dockerfile from the repo root", () => {
    expect(ml).toMatch(/^ {6}context: \.\s*$/m);
    expect(ml).toMatch(/^ {6}dockerfile: apps\/ml\/Dockerfile\s*$/m);
    expect(ml).toMatch(/^ {6}target: runtime\s*$/m);
  });

  it("joins exactly the `ml` network, which is internal", () => {
    expect(networksOf(ml)).toEqual(["ml"]);
    const networks = topLevelSection(compose, "networks");
    const mlNetwork = /^ {2}ml:(.*)$/m.exec(networks);
    expect(mlNetwork, "a top-level `ml` network").not.toBeNull();
    expect(mlNetwork?.[1]?.trim()).toBe("{ internal: true }");
  });

  it("shares the `ml` network with postgres alone", () => {
    const members = serviceNames(compose).filter((name) => networksOf(serviceBlock(compose, name)).includes("ml"));
    expect(members.sort()).toEqual(["ml", "postgres"]);
  });

  it("publishes no port and uses no network_mode", () => {
    expect(ml).not.toMatch(/^ {4}(ports|network_mode|expose):/m);
  });

  it("connects as bms_fleet and is given no other database URL and no Hugging Face token", () => {
    const env = environmentOf(ml);
    expect(env.DATABASE_URL_FLEET).toMatch(/^postgres:\/\/bms_fleet:[^@]+@postgres:5432\/bms$/);
    for (const forbidden of ["DATABASE_URL", "DATABASE_URL_SUPERUSER", "DATABASE_URL_TENANT", "DATABASE_URL_AUTH", "HF_TOKEN"]) {
      expect(env, forbidden).not.toHaveProperty(forbidden);
    }
    expect(ml).not.toMatch(/HF_TOKEN|HUGGING_FACE_HUB_TOKEN/);
  });

  it("has a memory and a CPU limit", () => {
    expect(ml).toMatch(/^ {4}mem_limit: \S+/m);
    expect(ml).toMatch(/^ {4}cpus: \S+/m);
  });
});
