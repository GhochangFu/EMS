import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E7.2` PR 4 — the public route to the cloud uplink receiver (ADR 0123
 * decision 4 and Q3b; ADR 0016 Amendment 9 (b)). CI never runs nginx or
 * `docker compose`, so the AWS deployment's route is held statically: the
 * compose network membership and the one `location /edge/` block.
 *
 * Reads text only (no YAML or nginx parser in the repo; adding one is a §9.4
 * dependency), and throws on a network form it cannot read rather than
 * passing over it. The compose helpers follow `f4.61-ingest-network-isolation`.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** The port `deploy/aws/nginx.conf` forwards to, documented as the value an operator sets. */
const DOCUMENTED_UPLINK_PORT = "9103";

function withoutYamlComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

function serviceBlock(composeText: string, name: string): string {
  const start = new RegExp(`^ {2}${name}:\\s*$`, "m").exec(composeText);
  expect(start, `compose must declare a \`${name}\` service`).not.toBeNull();
  const after = composeText.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

function serviceNames(compose: string): string[] {
  const start = /^services:\s*$/m.exec(compose);
  const after = compose.slice((start?.index ?? 0) + 9);
  const end = /\n[A-Za-z_][\w-]*:\s*$/m.exec(after);
  const section = end === null ? after : after.slice(0, end.index + 1);
  return [...section.matchAll(/^ {2}([A-Za-z_][\w-]*):\s*$/gm)].map((m) => m[1]);
}

function networksOf(block: string): string[] {
  const key = /^ {4}networks:(.*)$/m.exec(block);
  if (key === null) return [];
  if (key[1].trim() !== "") throw new Error(`networksOf cannot read "networks:${key[1]}"`);
  const names: string[] = [];
  for (const line of block.slice(key.index + key[0].length).split("\n")) {
    if (line.trim() === "") continue;
    const item = /^ {6}-\s*([A-Za-z_][\w-]*)\s*$/.exec(line);
    if (item !== null) {
      names.push(item[1]);
      continue;
    }
    if (/^ {0,4}[A-Za-z_]/.test(line)) break;
    throw new Error(`networksOf cannot read the line ${JSON.stringify(line)}`);
  }
  if (names.length === 0) throw new Error("networksOf found a `networks:` key with no items");
  return names;
}

/** The body of `location <match> { … }`, braces balanced; comments stripped first. */
function locationBlocks(conf: string): string[] {
  const text = conf.replace(/#[^\n]*/g, "");
  const blocks: string[] = [];
  const header = /location\s+\/edge\/\s*\{/g;
  let found: RegExpExecArray | null;
  while ((found = header.exec(text)) !== null) {
    let depth = 1;
    let i = found.index + found[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth += 1;
      if (text[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(text.slice(start, i - 1));
  }
  return blocks;
}

describe("E7.2 PR 4 — the AWS compose networks for the uplink route (ADR 0123 Q3b)", () => {
  const compose = withoutYamlComments(read("deploy/aws/docker-compose.yml"));

  it("web joins its existing `default` network and `edge-uplink`", () => {
    expect([...networksOf(serviceBlock(compose, "web"))].sort()).toEqual(["default", "edge-uplink"]);
  });

  it("ingest joins `ingest` and `edge-uplink`, not `default`", () => {
    expect([...networksOf(serviceBlock(compose, "ingest"))].sort()).toEqual(["edge-uplink", "ingest"]);
  });

  it("postgres does not join `edge-uplink`", () => {
    expect(networksOf(serviceBlock(compose, "postgres"))).not.toContain("edge-uplink");
  });

  it("no service other than web and ingest joins `edge-uplink`", () => {
    const names = serviceNames(compose);
    expect(names).toEqual(expect.arrayContaining(["web", "ingest", "postgres", "api"]));
    const members = names.filter((name) => networksOf(serviceBlock(compose, name)).includes("edge-uplink"));
    expect(members.sort()).toEqual(["ingest", "web"]);
  });

  it("declares the `edge-uplink` network and publishes no port from ingest", () => {
    expect(compose).toMatch(/^networks:\n(?: {2}[\w-]+: \{\}\n)* {2}edge-uplink: \{\}/m);
    expect(serviceBlock(compose, "ingest")).not.toMatch(/^ {4}ports:/m);
  });

  it("passes INGEST_UPLINK_PORT through unset: the receiver stays off unless the operator sets it", () => {
    expect(serviceBlock(compose, "ingest")).toMatch(/^ {6}INGEST_UPLINK_PORT: \$\{INGEST_UPLINK_PORT:-\}\s*$/m);
  });

  it("the root compose file does not turn the receiver on", () => {
    const root = withoutYamlComments(read("docker-compose.yml"));
    expect(serviceBlock(root, "ingest")).not.toMatch(/INGEST_UPLINK_PORT: *[0-9]/);
  });
});

describe("E7.2 PR 4 — deploy/aws/nginx.conf `location /edge/` (ADR 0123 decision 4)", () => {
  const raw = read("deploy/aws/nginx.conf");
  const conf = raw.replace(/#[^\n]*/g, "");
  const blocks = locationBlocks(raw);
  const block = blocks[0] ?? "";

  it("has exactly one `location /edge/` block", () => {
    expect(blocks).toHaveLength(1);
  });

  it("proxies through a variable upstream resolved at request time", () => {
    // Variable form: nginx starts while `ingest` is off and answers 502.
    const pass = /proxy_pass\s+(\$[a-z_]+)\s*;/.exec(block);
    expect(pass, "proxy_pass must name a variable").not.toBeNull();
    const variable = (pass?.[1] ?? "").replace("$", "\\$");
    expect(conf).toMatch(new RegExp(`set\\s+${variable}\\s+http://ingest:\\d+;`));
    expect(conf).toMatch(/resolver\s+127\.0\.0\.11\b/);
    // Never a literal host, which would make nginx refuse to start.
    expect(block).not.toMatch(/proxy_pass\s+http/);
  });

  it("caps the body at 300k or less inside the block", () => {
    const cap = /client_max_body_size\s+(\d+)([kKmM]?)\s*;/.exec(block);
    expect(cap, "client_max_body_size must be set in the block").not.toBeNull();
    const bytes = Number(cap?.[1]) * ({ "": 1, k: 1024, m: 1024 * 1024 }[(cap?.[2] ?? "").toLowerCase()] ?? 0);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(300 * 1024);
  });

  it("forwards to the port the compose file documents for INGEST_UPLINK_PORT", () => {
    const set = /set\s+\$edge_uplink_upstream\s+http:\/\/ingest:(\d+);/.exec(conf);
    expect(set?.[1]).toBe(DOCUMENTED_UPLINK_PORT);
    const aws = read("deploy/aws/docker-compose.yml");
    expect(serviceBlock(aws, "ingest")).toContain(`INGEST_UPLINK_PORT=${DOCUMENTED_UPLINK_PORT}`);
    expect(DOCUMENTED_UPLINK_PORT).not.toBe("9102"); // the compose health port
  });

  it("buffers the request body, so a slow upload never holds the receiver's in-flight slot", () => {
    expect(block).toMatch(/proxy_request_buffering\s+on\s*;/);
  });

  it("limits requests per source address, with 429", () => {
    const zone = /limit_req_zone\s+\$binary_remote_addr\s+zone=([a-z_]+):\d+[km]\s+rate=\d+r\/s\s*;/.exec(conf);
    expect(zone, "a limit_req_zone keyed on $binary_remote_addr").not.toBeNull();
    // Defined at http level (outside every server/location brace), where the
    // image's conf.d include puts this file's top level.
    const before = conf.slice(0, zone?.index ?? 0);
    expect(before.split("{").length - before.split("}").length).toBe(0);
    expect(block).toMatch(new RegExp(`limit_req\\s+zone=${zone?.[1]}\\b[^;]*;`));
    expect(block).toMatch(/limit_req_status\s+429\s*;/);
  });

  it("does not pass a URI to proxy_pass, so /edge/v1/batches arrives unchanged", () => {
    // `set $v http://ingest:9103;` has no URI part, and with a variable nginx
    // then sends the original request URI. A path or `rewrite` would change it.
    expect(conf).not.toMatch(/set\s+\$edge_uplink_upstream\s+http:\/\/[^;\s/]+\/[^;]*;/);
    expect(block).not.toMatch(/\brewrite\b/);
  });

  it("no other location forwards to the uplink upstream", () => {
    const withUpstream = [...conf.matchAll(/location\s+([^{]+?)\s*\{[^}]*\$edge_uplink_upstream[^}]*\}/g)];
    expect(withUpstream.map((m) => m[1])).toEqual(["/edge/"]);
  });

  it("keeps HTTP/1.0 to the upstream: no proxy_http_version 1.1 and no Connection override", () => {
    // Each batch is one short request; nginx's default upstream HTTP/1.0 sends
    // `Connection: close`, matching the receiver's refusals.
    expect(block).not.toMatch(/proxy_http_version/);
    expect(block).not.toMatch(/proxy_set_header\s+Connection/i);
  });

  it("does not repeat or drop proxy_set_header lines (the server-level ones are inherited)", () => {
    expect(block).not.toMatch(/proxy_set_header/);
  });
});
