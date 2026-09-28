import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * `F4.61` / ADR 0016 Amendment 8, Decisions 2 and 3 — the compose network
 * topology, and the absence of a host publication, are repo invariants, held
 * statically because CI never runs `docker compose`.
 *
 * The health endpoint's body is unauthenticated and, since `F1.7`, names
 * every enabled RTU, when each last reported and which are silent — a
 * targeting signal for remote unattended water stations. Before this row the
 * compose file declared no `networks:` at all, so every sibling container on
 * the default bridge could `GET http://ingest:9102/`. After: `ingest` joins a
 * user-defined network `ingest` and nothing else; `postgres` joins `default`
 * and `ingest`, so the ingest host can still reach it; every other service
 * stays on `default` alone. And `ingest` publishes no port: on Docker Desktop
 * a port on the host's `127.0.0.1` is reachable from every container through
 * `host.docker.internal`.
 *
 * **There is no YAML parser here** (the repo has none, and adding one is a
 * §9.4 dependency), so the file refuses what it cannot read instead of
 * passing over it: `networksOf` throws on a form it does not parse, any
 * `networks:` key on a service other than `ingest` and `postgres` fails (the
 * ruling is that every other service stays on `default` alone, so the key has
 * no legitimate use there), and a YAML merge key or `extends:` fails, because
 * either can bring a key in that no text match sees.
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
 * 2-space headings, in document order. T5b is its positive control, so a
 * walker that reads nothing cannot pass T5 vacuously.
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

/** A bare network name, or a throw: a quoted or aliased item is a form this file does not read. */
function plainName(item: string): string {
  if (!/^[A-Za-z_][\w-]*$/.test(item)) {
    throw new Error(`networksOf cannot read the item ${JSON.stringify(item)}`);
  }
  return item;
}

/**
 * The network names a service block joins: the `- name` items under its
 * 4-space `networks:` key, or the flow form `networks: [a, b]`. `[]` when the
 * service declares no `networks:` at all (compose then puts it on the
 * implicit `default`). **Any other form throws** — a map (`ingest: {}`), an
 * alias, a quoted item, a compact sequence at 4 spaces — so an assertion over
 * the result fails loudly rather than comparing against an empty list.
 */
function networksOf(block: string): string[] {
  const key = /^ {4}networks:(.*)$/m.exec(block);
  if (key === null) return [];
  const rest = key[1].trim();
  if (rest !== "") {
    const flow = /^\[([^\]]*)\]$/.exec(rest);
    if (flow === null) throw new Error(`networksOf cannot read "networks: ${rest}"`);
    return flow[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map(plainName);
  }
  const names: string[] = [];
  for (const line of block.slice(key.index + key[0].length).split("\n")) {
    if (line.trim() === "") continue;
    const item = /^ {6}-\s*(\S+)\s*$/.exec(line);
    if (item !== null) {
      names.push(plainName(item[1]));
      continue;
    }
    // The next key of this service (4 spaces) or of the file ends the list;
    // anything else — a map entry at 6 spaces, a `-` at 4 — is unread.
    if (/^ {0,4}[A-Za-z_]/.test(line)) break;
    throw new Error(`networksOf cannot read the line ${JSON.stringify(line)}`);
  }
  if (names.length === 0) throw new Error("networksOf found a `networks:` key with no items");
  return names;
}

describe("F4.61 — the ingest network topology (ADR 0016 Amendment 8, Decisions 2 and 3)", () => {
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

  it("no service other than ingest and postgres declares `networks:`", () => {
    // T5 — every other service stays on `default` alone, so the key has no use
    // there, and refusing the key itself holds in every YAML form: a map, an
    // alias or a quoted item would each slip past a parse of the list.
    const others = serviceNames(compose).filter((name) => name !== "postgres" && name !== "ingest");
    const declaring = others.filter((name) => /^ {4}networks:/m.test(serviceBlock(compose, name)));
    expect(declaring).toEqual([]);
  });

  it("the enumeration of other services is not vacuous", () => {
    // T5b — a `serviceNames` that reads nothing would pass T5 trivially.
    expect(serviceNames(compose)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it("no service uses `network_mode`", () => {
    // T6 — `network_mode: host` would bypass the network boundary entirely.
    const withNetworkMode = serviceNames(compose).filter((name) =>
      /^ {4}network_mode:/m.test(serviceBlock(compose, name)),
    );
    expect(withNetworkMode).toEqual([]);
  });

  it("the ingest service publishes no port to the host", () => {
    // T7 — Decision 3. A port on the host's `127.0.0.1` is reachable from
    // every container on Docker Desktop through `host.docker.internal`. The
    // key itself is refused, so no short, long or random-port form survives.
    expect(serviceBlock(compose, "ingest")).not.toMatch(/^ {4}ports:/m);
  });

  it("the compose file uses no YAML merge key and no `extends:`", () => {
    // T8 — either can bring `networks:` or `ports:` into a service where no
    // text match above would see it.
    expect(compose).not.toMatch(/^\s*<<\s*:|^ {4}extends:/m);
  });
});
