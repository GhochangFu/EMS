import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125 decisions 5, 7, 8 and 19 — the limiter's variables in
 * both compose files.
 *
 * 1. Every variable is set on `api` and `api-replica`, **with the same value**:
 *    both processes count against one Redis budget, so a different limit on
 *    one of them would make the budget depend on which process a request hit.
 * 2. The AWS `api` sets every variable too, and its hop default is 2 (Caddy →
 *    web nginx → api); the local default is 0 (the browser reaches the API
 *    directly). Both modes default to `shadow`.
 * 3. No other service sets one: the worker serves no `/api/v1` route.
 *
 * Comment-stripped reads, so a commented-out line cannot satisfy a claim.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const VARS = [
  "RATE_LIMIT_MODE",
  "RATE_LIMIT_READ_PER_MIN",
  "RATE_LIMIT_WRITE_PER_MIN",
  "RATE_LIMIT_HEAVY_PER_MIN",
  "RATE_LIMIT_IP_PER_MIN",
  "RATE_LIMIT_LOGIN_PER_MIN",
  "RATE_LIMIT_WS_HANDSHAKE_PER_MIN",
  "API_TRUST_PROXY_HOPS",
] as const;

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

function withoutYamlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/** `service name → its block text`, for every top-level service. */
function services(composeText: string): Map<string, string> {
  const body = composeText.slice(composeText.indexOf("\nservices:"));
  const blocks = new Map<string, string>();
  const found = [...body.matchAll(/^ {2}([A-Za-z_][\w-]*):\s*$/gm)];
  found.forEach((match, i) => {
    const end = i + 1 < found.length ? found[i + 1].index : body.length;
    const block = body.slice(match.index, end);
    const top = /\n\S/.exec(block.slice(1));
    blocks.set(match[1], top === null ? block : block.slice(0, top.index + 1));
  });
  return blocks;
}

function valueOf(block: string, name: string): string | undefined {
  const match = new RegExp(`^\\s+${name}:[ \\t]*(.*)$`, "m").exec(block);
  return match?.[1]?.trim().replace(/^"(.*)"$/, "$1");
}

const local = services(withoutYamlComments(read("docker-compose.yml")));
const aws = services(withoutYamlComments(read("deploy/aws/docker-compose.yml")));

describe("F4.17 — rate-limit variables in compose (ADR 0125)", () => {
  it("positive control: the services under test were found", () => {
    expect(local.has("api")).toBe(true);
    expect(local.has("api-replica")).toBe(true);
    expect(aws.has("api")).toBe(true);
  });

  it.each(VARS)("%s is set on api and api-replica with the same value", (name) => {
    const api = valueOf(local.get("api") ?? "", name);
    const replica = valueOf(local.get("api-replica") ?? "", name);
    expect(api, `${name} missing on api`).toBeDefined();
    expect(replica, `${name} missing on api-replica`).toBe(api);
  });

  it.each(VARS)("%s is set on the AWS api", (name) => {
    expect(valueOf(aws.get("api") ?? "", name)).toBeDefined();
  });

  it("both default to shadow; local hops default 0, AWS hops default 2", () => {
    expect(valueOf(local.get("api") ?? "", "RATE_LIMIT_MODE")).toBe("${RATE_LIMIT_MODE:-shadow}");
    expect(valueOf(aws.get("api") ?? "", "RATE_LIMIT_MODE")).toBe("${RATE_LIMIT_MODE:-shadow}");
    expect(valueOf(local.get("api") ?? "", "API_TRUST_PROXY_HOPS")).toBe("${API_TRUST_PROXY_HOPS:-0}");
    expect(valueOf(aws.get("api") ?? "", "API_TRUST_PROXY_HOPS")).toBe("${API_TRUST_PROXY_HOPS:-2}");
  });

  it("no other service sets a limiter variable", () => {
    for (const [file, map, allowed] of [
      ["docker-compose.yml", local, ["api", "api-replica"]],
      ["deploy/aws/docker-compose.yml", aws, ["api"]],
    ] as const) {
      for (const [service, block] of map) {
        if ((allowed as readonly string[]).includes(service)) continue;
        for (const name of VARS) {
          expect(valueOf(block, name), `${file} ${service} sets ${name}`).toBeUndefined();
        }
      }
    }
  });
});
