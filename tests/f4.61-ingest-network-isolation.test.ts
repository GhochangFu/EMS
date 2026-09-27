import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * `F4.61` / ADR 0016 Amendment 8, Decision 2 — the compose network topology
 * is a repo invariant, held statically because CI never runs
 * `docker compose`.
 *
 * The health endpoint's body is unauthenticated and, since `F1.7`, names
 * every enabled RTU, when each last reported and which are silent — a
 * targeting signal for remote unattended water stations. Before this row the
 * compose file declared no `networks:` at all, so every sibling container on
 * the default bridge could `GET http://ingest:9102/`. After: `ingest` joins a
 * user-defined network `ingest` and nothing else; `postgres` joins `default`
 * and `ingest`, so the ingest host can still reach it; every other service
 * stays on `default` alone.
 *
 * Helpers `withoutComments` and `serviceBlock` are copied from
 * `tests/f3.3-object-storage-invariants.test.ts` (file-local there, not
 * imported); the compose-reader shape follows `tests/f1.10-ingest-buffer-volume.test.ts`.
 * Comments are stripped before any parse so a comment that merely mentions
 * `ingest:` cannot satisfy an assertion.
 */

/** Strip `#` comments so a commented-out line cannot satisfy an assertion. */
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/** One top-level `<name>:` service block: from its heading to the next two-space service key. */
function serviceBlock(composeText: string, name: string): string {
  const start = new RegExp(`^ {2}${name}:\\s*$`, "m").exec(composeText);
  expect(start, `docker-compose.yml must declare a \`${name}\` service`).not.toBeNull();
  const after = composeText.slice(start?.index ?? 0);
  const next = /\n {2}[A-Za-z_][\w-]*:\s*$/m.exec(after.slice(1));
  return next === null ? after : after.slice(0, next.index + 1);
}

/**
 * The text of a top-level `<key>:` block (e.g. `networks:`, `volumes:`,
 * `services:`), from its heading to the next zero-indent key, or `""` when
 * the heading is absent.
 */
function topLevelSection(compose: string, key: string): string {
  const start = new RegExp(`^${key}:\\s*$`, "m").exec(compose);
  if (start === null) return "";
  const after = compose.slice(start.index + start[0].length);
  const next = /\n[A-Za-z_][\w-]*:\s*$/m.exec(after);
  return next === null ? after : after.slice(0, next.index + 1);
}

/**
 * Every service name declared under the top-level `services:` block — the
 * 2-space headings, in document order. Used both to enumerate "every other
 * service" (T5) and, in `runRefusalOrderTests`'s spirit, as its own positive
 * control (T5b) so a walker that reads nothing cannot pass T5 vacuously.
 */
function serviceNames(compose: string): string[] {
  const section = topLevelSection(compose, "services");
  const names: string[] = [];
  const heading = /^ {2}([A-Za-z_][\w-]*):\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = heading.exec(section)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * The network names a service block joins: the trimmed `- item` lines under
 * its 4-space `networks:` key, or the flow form `networks: [a, b]`. `[]`
 * when the service declares no `networks:` at all (compose then puts it on
 * the implicit `default`).
 */
function networksOf(block: string): string[] {
  const flow = /^ {4}networks:\s*\[([^\]]*)\]\s*$/m.exec(block);
  if (flow) {
    return flow[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  const start = /^ {4}networks:\s*$/m.exec(block);
  if (start === null) return [];
  const after = block.slice(start.index + start[0].length);
  const names: string[] = [];
  for (const line of after.split("\n")) {
    if (line.trim() === "") continue;
    const item = /^ {6}-\s*(\S+)\s*$/.exec(line);
    if (item === null) break;
    names.push(item[1]);
  }
  return names;
}

describe("F4.61 — the ingest network topology (ADR 0016 Amendment 8, Decision 2)", () => {
  const compose = withoutComments(readFileSync(composePath, "utf8"));

  it("declares a top-level `ingest` network", () => {
    // T1
    const networks = topLevelSection(compose, "networks");
    expect(networks).toMatch(/^ {2}ingest:/m);
  });

  it("the ingest network is not `internal`", () => {
    // T2 — the host still dials the PHE broker on the internet.
    const networks = topLevelSection(compose, "networks");
    expect(networks).not.toMatch(/internal:\s*true/);
  });

  it("the ingest service joins only the `ingest` network", () => {
    // T3
    expect(networksOf(serviceBlock(compose, "ingest"))).toEqual(["ingest"]);
  });

  it("the postgres service joins `default` and `ingest`", () => {
    // T4 — naming any network drops the implicit `default`, so it must be
    // listed explicitly for postgres to still be reached by every other
    // service that stays on `default` alone.
    const networks = [...networksOf(serviceBlock(compose, "postgres"))].sort();
    expect(networks).toEqual(["default", "ingest"]);
  });

  it("no service other than postgres joins the `ingest` network", () => {
    // T5
    const others = serviceNames(compose).filter((name) => name !== "postgres" && name !== "ingest");
    const sharing = others.filter((name) => networksOf(serviceBlock(compose, name)).includes("ingest"));
    expect(sharing).toEqual([]);
  });

  it("the enumeration of other services is not vacuous", () => {
    // T5b — a `serviceNames` that reads nothing would pass T5 trivially.
    const names = serviceNames(compose);
    for (const expected of [
      "api",
      "web",
      "keycloak",
      "grafana",
      "prometheus",
      "worker",
      "api-replica",
      "sim",
      "redis",
      "minio",
      "migrate",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("no service uses `network_mode`", () => {
    // T6 — `network_mode: host` would bypass the network boundary entirely.
    const withNetworkMode = serviceNames(compose).filter((name) =>
      /^ {4}network_mode:/m.test(serviceBlock(compose, name)),
    );
    expect(withNetworkMode).toEqual([]);
  });

  it("publishes 9102 on loopback only", () => {
    // T7 — the health body carries the unauthenticated RTU roster.
    expect(compose).toMatch(/-\s*"?127\.0\.0\.1:9102:9102"?/);
  });

  it("publishes no non-loopback 9102 mapping", () => {
    // T7 (second half, split so each `it()` holds one `expect`)
    const mappings = compose.match(/-\s*"?[\w.:[\]]*9102:9102"?/g) ?? [];
    const nonLoopback = mappings.filter((mapping) => !mapping.includes("127.0.0.1:9102:9102"));
    expect(nonLoopback).toEqual([]);
  });
});
