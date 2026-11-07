import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.326` / ADR 0114 decisions 1 and 7 — the static half of plain MQTT.
 *
 * Three processes read one variable, `MQTT_PLAINTEXT_HOSTS`: `api` and `worker`
 * (the validator and discovery) and `ingest` (the connection). A host on the
 * ingest list but not the API list makes the validator refuse an RTU ingest
 * would serve, and the reverse lets a draft commit that ingest skips. So:
 *
 * 1. Both compose files pass the variable to exactly those three services, as
 *    the empty-default pass-through `${MQTT_PLAINTEXT_HOSTS:-}` — never `:?`
 *    (a missing value must not break `up`) and never a literal.
 * 2. No compose file, `.env.example` or workflow sets a non-empty value, and the
 *    BCPL broker's name appears in none of them: the AWS value is the owner's,
 *    set in `$BMS_HOME/.env` through `bms-ctl` (plan §1, ruling 11).
 * 3. In `apps/ingest`, only `host/config.ts` — the host's one environment
 *    reader — names the variable, and no adapter does (ADR 0016 §4).
 *
 * Comment-stripped reads, so a commented-out line cannot satisfy a claim; each
 * absence claim has a positive control that the scan read something.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const VAR = "MQTT_PLAINTEXT_HOSTS";
const PASS_THROUGH = "${MQTT_PLAINTEXT_HOSTS:-}";
const COMPOSE_FILES = ["docker-compose.yml", "deploy/aws/docker-compose.yml"];

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** Strip `#` comments so a commented-out line cannot satisfy an assertion. */
function withoutYamlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/** Block comments and `//` tails, for TypeScript sources. */
function withoutTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** `service name → its block text`, for every top-level service of a compose file. */
function services(composeText: string): Map<string, string> {
  const body = composeText.slice(composeText.indexOf("\nservices:"));
  const blocks = new Map<string, string>();
  const heading = /^ {2}([A-Za-z_][\w-]*):\s*$/gm;
  const found = [...body.matchAll(heading)];
  found.forEach((match, i) => {
    const end = i + 1 < found.length ? found[i + 1].index : body.length;
    const block = body.slice(match.index, end);
    // Stop at the next top-level key (`networks:`, `volumes:`).
    const top = /\n\S/.exec(block.slice(1));
    blocks.set(match[1], top === null ? block : block.slice(0, top.index + 1));
  });
  return blocks;
}

/** Every `KEY: value` / `KEY=value` assignment of the variable in `text`. */
function assignments(text: string): string[] {
  return [...text.matchAll(new RegExp(`\\b${VAR}\\s*[:=][ \\t]*(.*)$`, "gm"))].map((m) =>
    m[1].trim().replace(/^"(.*)"$/, "$1"),
  );
}

function filesUnder(rel: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (keep(entry.name)) {
        out.push(relative(repoRoot, full).split(sep).join("/"));
      }
    }
  };
  walk(join(repoRoot, rel));
  return out.sort();
}

describe("ADR 0114 — MQTT_PLAINTEXT_HOSTS invariants (F4.326)", () => {
  for (const file of COMPOSE_FILES) {
    it(`${file} passes the variable to exactly api, worker and ingest`, () => {
      const blocks = services(withoutYamlComments(read(file)));
      expect(blocks.size, `${file}: the service scan found nothing`).toBeGreaterThan(3);
      const carriers = [...blocks].filter(([, text]) => text.includes(`${VAR}:`)).map(([name]) => name);
      expect(carriers.sort()).toEqual(["api", "ingest", "worker"]);
    });

    it(`${file} passes it through with the empty default, never a literal or :?`, () => {
      const values = assignments(withoutYamlComments(read(file)));
      expect(values).toEqual([PASS_THROUGH, PASS_THROUGH, PASS_THROUGH]);
    });
  }

  it("no compose file, .env.example or workflow sets a non-empty literal", () => {
    const files = [
      ...COMPOSE_FILES,
      ".env.example",
      ...filesUnder(".github/workflows", (n) => n.endsWith(".yml") || n.endsWith(".yaml")),
    ];
    expect(files.length, "the workflow scan found nothing").toBeGreaterThan(COMPOSE_FILES.length + 1);
    const literals = files.flatMap((file) =>
      assignments(withoutYamlComments(read(file)))
        .filter((value) => value !== "" && value !== PASS_THROUGH)
        .map((value) => `${file}: ${value}`),
    );
    expect(literals).toEqual([]);
  });

  it("the BCPL broker is named in no compose file, .env.example or workflow", () => {
    const files = [
      ...COMPOSE_FILES,
      ".env.example",
      ...filesUnder(".github/workflows", (n) => n.endsWith(".yml") || n.endsWith(".yaml")),
    ];
    // Positive control: the scan reads the pilot broker the compose files do name.
    expect(read("deploy/aws/docker-compose.yml")).toContain("phe.thinkiot.co.in");
    expect(files.filter((file) => read(file).includes("shapoorji"))).toEqual([]);
  });

  it("in apps/ingest only host/config.ts names the variable, and no adapter does", () => {
    const sources = filesUnder("apps/ingest/src", (n) => n.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(n));
    expect(sources, "positive control: the scan read config.ts").toContain("apps/ingest/src/host/config.ts");
    expect(
      sources.filter((rel) => rel.includes("/adapters/")).length,
      "positive control: the scan read the adapters",
    ).toBeGreaterThan(0);
    const readers = sources.filter((rel) => withoutTsComments(read(rel)).includes(VAR));
    expect(readers).toEqual(["apps/ingest/src/host/config.ts"]);
    const adapterEnv = sources.filter(
      (rel) => rel.includes("/adapters/") && withoutTsComments(read(rel)).includes("process.env"),
    );
    expect(adapterEnv).toEqual([]);
  });
});
