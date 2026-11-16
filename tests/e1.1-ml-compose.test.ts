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
 * Both compose files carry the service (the AWS one since plan PR 5, pulled
 * from GHCR instead of built), and `bms-ctl` and the two AWS workflows agree on
 * the optional services. (The ssh forced command needs no list of its own: it
 * hands words to `bms-ctl`, which validates them.) The reader helpers are copied from
 * `tests/f4.61-ingest-network-isolation.test.ts` (file-local there); there is no
 * YAML parser in the repo, so a form the reader cannot read throws.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

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

const FILES = [
  { file: "docker-compose.yml", fleetUrl: /^postgres:\/\/bms_fleet:[^@]+@postgres:5432\/bms$/ },
  {
    file: "deploy/aws/docker-compose.yml",
    fleetUrl: /^postgres:\/\/bms_fleet:\$\{BMS_FLEET_PASSWORD:\?\}@postgres:5432\/bms$/,
  },
];

describe("E1.1 the local `ml` service builds the image", () => {
  const compose = withoutComments(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8"));
  const ml = serviceBlock(compose, "ml");

  it("the environment reader reads (positive control)", () => {
    expect(Object.keys(environmentOf(serviceBlock(compose, "worker")))).toContain("DATABASE_URL_FLEET");
  });

  it("builds the runtime stage of apps/ml/Dockerfile from the repo root", () => {
    expect(ml).toMatch(/^ {6}context: \.\s*$/m);
    expect(ml).toMatch(/^ {6}dockerfile: apps\/ml\/Dockerfile\s*$/m);
    expect(ml).toMatch(/^ {6}target: runtime\s*$/m);
  });
});

describe("E1.1 the AWS `ml` service pulls the image the deploy built", () => {
  const compose = withoutComments(readFileSync(join(repoRoot, "deploy/aws/docker-compose.yml"), "utf8"));
  const ml = serviceBlock(compose, "ml");

  it("pulls ems-ml at the deployed SHA and builds nothing", () => {
    expect(ml).toMatch(/^ {4}image: ghcr\.io\/\$\{IMAGE_OWNER:\?\}\/ems-ml:\$\{IMAGE_TAG:\?\}\s*$/m);
    expect(ml).not.toMatch(/^ {4}build:/m);
  });

  it("restarts unless stopped, like every AWS service", () => {
    expect(ml).toMatch(/^ {4}restart: unless-stopped\s*$/m);
  });
});

describe.each(FILES)("E1.1 the `ml` compose service ($file)", ({ file, fleetUrl }) => {
  const compose = withoutComments(readFileSync(join(repoRoot, file), "utf8"));
  const ml = serviceBlock(compose, "ml");

  it("the readers read (positive control)", () => {
    expect(serviceNames(compose)).toEqual(expect.arrayContaining(["postgres", "api", "ingest", "ml"]));
    expect(networksOf(serviceBlock(compose, "ingest")).length).toBeGreaterThan(0);
  });

  it("runs only under its own opt-in profile", () => {
    expect(ml).toMatch(/^ {4}profiles: \["ml"\]\s*$/m);
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
    expect(env.DATABASE_URL_FLEET).toMatch(fleetUrl);
    for (const forbidden of ["DATABASE_URL", "DATABASE_URL_SUPERUSER", "DATABASE_URL_TENANT", "DATABASE_URL_AUTH", "HF_TOKEN"]) {
      expect(env, forbidden).not.toHaveProperty(forbidden);
    }
    expect(ml).not.toMatch(/HF_TOKEN|HUGGING_FACE_HUB_TOKEN/);
  });

  it("has a memory limit with no swap beyond it, a process limit and a CPU limit", () => {
    const mem = /^ {4}mem_limit: (\S+)/m.exec(ml)?.[1];
    expect(mem).toBeDefined();
    expect(/^ {4}memswap_limit: (\S+)/m.exec(ml)?.[1]).toBe(mem);
    expect(ml).toMatch(/^ {4}pids_limit: \d+/m);
    expect(ml).toMatch(/^ {4}cpus: \S+/m);
  });

  it("is hardened: read-only root, no capabilities, no privilege gain", () => {
    expect(ml).toMatch(/^ {4}read_only: true\s*$/m);
    expect(ml).toMatch(/^ {4}cap_drop:\s*\n {6}- ALL\s*$/m);
    expect(ml).toMatch(/^ {4}security_opt:\s*\n {6}- no-new-privileges:true\s*$/m);
  });

  it("gives torch exactly the CPU limit as its thread count", () => {
    const cpus = /^ {4}cpus: (\S+)/m.exec(ml)?.[1];
    expect(environmentOf(ml).ML_TORCH_THREADS).toBe(String(Math.max(1, Math.floor(Number(cpus)))));
  });
});

describe("E1.1 bms-ctl and the AWS workflows know the ml service", () => {
  const ctl = read("deploy/aws/bms-ctl.sh");
  const services = read(".github/workflows/aws-services.yml");
  const deploy = read(".github/workflows/deploy-aws.yml");
  const words = (text: string, name: string): string[] =>
    (new RegExp(`^${name}="([^"]*)"`, "m").exec(text)?.[1] ?? "").split(/\s+/).filter(Boolean);

  it("lists ml as an optional service, and the workflow offers exactly the optional services", () => {
    const optional = words(ctl, "OPTIONAL");
    expect(optional).toContain("ml");
    expect(words(ctl, "SERVICES")).toEqual(expect.arrayContaining(optional));
    const offered = /options: \[(sim[^\]]*)\]/.exec(services)?.[1]?.split(",").map((s) => s.trim());
    expect(offered?.sort()).toEqual([...optional].sort());
  });

  it("dispatches `ml start|stop|status` and names ml in the usage", () => {
    expect(ctl).toMatch(/^ {2}sim\|ingest\|ml\) /m);
    expect(ctl).toMatch(/unknown command '\$1' \(deploy, rollback, sim, ingest, ml, status, logs\)/);
  });

  it("keeps and prunes the ems-ml image like the other optional images", () => {
    expect(ctl).toMatch(/ems-\(api\|web\|sim\|ingest\|ml\)/);
    expect(ctl).toMatch(/"\$STATE\/ml-enabled"/);
  });

  it("pulls ems-ml (2.8 GB) only while ml is enabled: compose() adds that profile, the pull lines never name it", () => {
    const pulls = ctl.split("\n").filter((line) => /\bpull --quiet\b/.test(line));
    expect(pulls.length).toBe(2);
    for (const line of pulls) expect(line).not.toMatch(/--profile ml\b/);
    expect(ctl).toMatch(/for opt in \$OPTIONAL; do\n\s+\[ -f "\$STATE\/\$opt-enabled" \] && profiles\+=\(--profile "\$opt"\)/);
  });

  it("`ml start` without the image records the choice and leaves the pull to the next deploy", () => {
    expect(ctl).toMatch(/if \[ "\$svc" = ml \] && ! docker image inspect "ghcr\.io\/\$IMAGE_OWNER\/ems-ml:\$sha"/);
  });

  it("builds ems-ml in the arm64 build job, and its failure never blocks the deploy", () => {
    const build = deploy.slice(deploy.indexOf("\n  build:\n"), deploy.indexOf("\n  deploy:\n"));
    expect(build).toMatch(/runs-on: ubuntu-24\.04-arm/);
    expect(build).toMatch(/- image: ml\n\s+dockerfile: apps\/ml\/Dockerfile\n/);
    expect(build).toMatch(/continue-on-error: \$\{\{ matrix\.image == 'ml' \}\}/);
    // A rollback dispatch to a SHA before the image existed builds nothing for it.
    expect(build).toMatch(/if: hashFiles\(matrix\.dockerfile\) != ''/);
  });
});
