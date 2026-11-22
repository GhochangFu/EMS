import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");
const modbusSimPath = join(repoRoot, "apps/sim/src/modbus-sim.js");

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
 * `F1.2` plan PR 8 (ADR 0016 Amendment 10 (b), ruling P5) adds a third
 * network, `modbus-sim`, `internal`, joined by `ingest` and the Modbus
 * simulator alone, so the cloud host can poll the simulator while the
 * simulator still reaches neither `postgres` nor any other service. The
 * simulator's own service runs only under the `modbus` profile, publishes no
 * port, carries no database URL, and its entry file is socket plumbing over
 * the shared `serveModbusFrame` with one listener.
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
    // T2 — the host still dials the PHE broker on the internet. Scoped to the
    // `ingest` entry since ADR 0135 (E1.1): the `ml` network is internal on
    // purpose (tests/e1.1-ml-compose.test.ts).
    const networks = topLevelSection(compose, "networks");
    const ingest = /^ {2}ingest:(.*)$/m.exec(networks);
    expect(ingest, "a top-level `ingest` network").not.toBeNull();
    const entry = networks.slice(ingest?.index ?? 0).split(/\n(?= {2}[A-Za-z_])/)[0] ?? "";
    expect(entry).toMatch(/^ {2}ingest:/);
    expect(entry).not.toMatch(/internal/);
  });

  it("the ingest service joins exactly `ingest`, `edge-uplink` and `modbus-sim`", () => {
    // T3 — ADR 0123 Q3b amends Decision 2: the public nginx container reaches
    // the uplink receiver over `edge-uplink`; the health listener binds to
    // loopback, so that second network cannot reach it. `default` stays out.
    // ADR 0016 Amendment 10 (b) adds `modbus-sim`, for the same reason the
    // health listener stays unreachable on it.
    expect([...networksOf(serviceBlock(compose, "ingest"))].sort()).toEqual(["edge-uplink", "ingest", "modbus-sim"]);
  });

  it("declares a top-level `edge-uplink` network", () => {
    // T3b
    expect(topLevelSection(compose, "networks")).toMatch(/^ {2}edge-uplink:/m);
  });

  it("only `ingest` and `web` join `edge-uplink`, and `postgres` never does", () => {
    // T3c — ADR 0123 Q3b: the network is for the public nginx container and
    // ingest. A third member would be a new path to the uplink listener.
    const members = serviceNames(compose).filter((name) =>
      networksOf(serviceBlock(compose, name)).includes("edge-uplink"),
    );
    expect(members.sort()).toEqual(["ingest", "web"]);
    expect(networksOf(serviceBlock(compose, "postgres"))).not.toContain("edge-uplink");
  });

  it("the web service joins `default` and `edge-uplink`", () => {
    // T3d — naming any network drops the implicit `default`.
    expect([...networksOf(serviceBlock(compose, "web"))].sort()).toEqual(["default", "edge-uplink"]);
  });

  it("declares a top-level `modbus-sim` network, `internal`", () => {
    // T3e — Amendment 10 (b): neither member needs the internet through it;
    // `ingest` keeps its egress on the `ingest` network.
    const networks = topLevelSection(compose, "networks");
    expect(networks).toMatch(/^ {2}modbus-sim:\s*\{\s*internal:\s*true\s*\}\s*$/m);
  });

  it("only `ingest` and `modbus-sim` join `modbus-sim`, and `postgres` never does", () => {
    // T3f — Amendment 10 (b), ruling P5. A third member would share a network
    // with the simulator; `postgres` would put the database one hop from it.
    const members = serviceNames(compose).filter((name) =>
      networksOf(serviceBlock(compose, name)).includes("modbus-sim"),
    );
    expect(members.sort()).toEqual(["ingest", "modbus-sim"]);
    expect(networksOf(serviceBlock(compose, "postgres"))).not.toContain("modbus-sim");
  });

  it("the modbus-sim service joins `modbus-sim` and nothing else", () => {
    // T3g — not `default` (every other service, `postgres` included, is
    // there), not `ingest` (shared with `postgres`).
    expect(networksOf(serviceBlock(compose, "modbus-sim"))).toEqual(["modbus-sim"]);
  });

  it("the postgres service joins `default`, `ingest` and `ml`", () => {
    // T4 — naming any network drops the implicit `default`, so it must be
    // listed explicitly for postgres to still be reached by every other
    // service that stays on `default` alone. `ml` is the batch scorer's
    // internal network (ADR 0135, E1.1).
    const networks = [...networksOf(serviceBlock(compose, "postgres"))].sort();
    expect(networks).toEqual(["default", "ingest", "ml"]);
  });

  it("no service other than ingest, postgres, web, ml and modbus-sim declares `networks:`", () => {
    // T5 — every other service stays on `default` alone, so the key has no use
    // there, and refusing the key itself holds in every YAML form: a map, an
    // alias or a quoted item would each slip past a parse of the list. `ml`
    // joins its internal network alone (tests/e1.1-ml-compose.test.ts);
    // `modbus-sim` its own (T3g).
    const declared = new Set(["postgres", "ingest", "web", "ml", "modbus-sim"]);
    const others = serviceNames(compose).filter((name) => !declared.has(name));
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
        "modbus-sim",
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

  it("the ingest service's MODBUS_TCP_HOSTS defaults to empty (fail closed)", () => {
    // T7b — ADR 0141 decision 22: unset or empty, the cloud host dials no
    // Modbus endpoint. The compose line passes the operator's `.env` value
    // through; it never names `modbus-sim` itself, so a stack without the
    // `modbus` profile allows no Modbus host.
    expect(serviceBlock(compose, "ingest")).toMatch(/^ {6}MODBUS_TCP_HOSTS: \$\{MODBUS_TCP_HOSTS:-\}\s*$/m);
  });

  it("the compose file uses no YAML merge key and no `extends:`", () => {
    // T8 — either can bring `networks:` or `ports:` into a service where no
    // text match above would see it.
    expect(compose).not.toMatch(/^\s*<<\s*:|^ {4}extends:/m);
  });
});

describe("F1.2 — the Modbus simulator service (ADR 0016 Amendment 10 (b), ADR 0141 decision 20)", () => {
  const compose = withoutComments(readFileSync(composePath, "utf8"));
  const block = () => serviceBlock(compose, "modbus-sim");

  it("runs only under the `modbus` compose profile", () => {
    // M1 — `docker compose up` without `--profile modbus` creates no simulator.
    expect(block()).toMatch(/^ {4}profiles:\s*\["modbus"\]\s*$/m);
  });

  it("publishes no port to the host", () => {
    // M2 — the key itself is refused, as for `ingest` (T7).
    expect(block()).not.toMatch(/^ {4}ports:/m);
  });

  it("carries no database URL and reads no env file", () => {
    // M3 — the simulator is socket plumbing; an `env_file:` could bring a
    // `DATABASE_URL` in that no text match here sees.
    expect(block()).not.toMatch(/DATABASE_URL/);
    expect(block()).not.toMatch(/^ {4}env_file:/m);
  });

  it("its command runs `src/modbus-sim.js`", () => {
    // M4 — the sim image's own `CMD` is the database simulator (`src/index.js`).
    expect(block()).toMatch(/^ {4}command:\s*\["node",\s*"src\/modbus-sim\.js"\]\s*$/m);
  });

  it("the entry file serves through the shared `serveModbusFrame`", () => {
    // M5 — one server half for the simulator and the test server (plan C3).
    const source = withoutJsComments(readFileSync(modbusSimPath, "utf8"));
    expect(source).toMatch(/\{[^}]*\bserveModbusFrame\b[^}]*\}\s*=\s*require\("@bms\/shared\/ingest"\)/);
    expect(source).toMatch(/\bserveModbusFrame\(/);
  });

  it("the entry file binds exactly one listener, a TCP one, and opens no database", () => {
    // M6 — no metrics, health or HTTP port beside the Modbus one, and no
    // database client (the service has no URL to give it).
    const source = withoutJsComments(readFileSync(modbusSimPath, "utf8"));
    expect(source.match(/\.listen\(/g) ?? []).toHaveLength(1);
    expect(source.match(/\bcreateServer\(/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/from "node:net"/);
    expect(source).not.toMatch(/["'](?:node:)?(?:http|https|http2|dgram|tls)["']|["'](?:pg|prom-client|dotenv)["']/);
    expect(source).not.toMatch(/DATABASE_URL/);
  });
});

/** Strip `//` line comments and `/* *\/` blocks from a JS file (no string in the entry file holds either). */
function withoutJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}
