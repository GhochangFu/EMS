import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.3` / ADR 0066 decisions 4, 8, 9, 10 and Amendment 1 — the static half
 * of the object-storage row, held against the committed text of
 * `docker-compose.yml`, `.github/workflows/ci.yml` and `apps/api/src`.
 *
 * Four claims live here, and each is a claim no unit test can make:
 *
 * 1. **MinIO is pinned and on loopback** (decisions 8, 9). The image tag is a
 *    `RELEASE.<stamp>` on `quay.io` — never `latest`, and never Docker Hub,
 *    which no longer hosts the repository (Amendment 1, registry) — and both
 *    published ports bind `127.0.0.1` only, because the bucket carries
 *    unencrypted tenant bytes over plain http.
 * 2. **CI runs the engine compose runs** (decision 10, Q-D). The tag strings
 *    are extracted from both files and compared to each other rather than to
 *    a literal in this file: a third copy would be a third thing to drift.
 * 3. **One key authority** (decision 4). Exactly one `function
 *    buildObjectKey(` exists, no other file builds or matches a key from the
 *    `org/` literal, no controller takes a `key`/`objectKey` parameter — a
 *    key is derived from the row, never accepted from a client — and
 *    `OBJECT_KEY_PREFIX` (exported for the leak assertions) is imported by
 *    `*.spec.ts` files only, closing the gap `F4.145` named against the two
 *    rows above (F3.4 Unit 6).
 * 4. **The worker gets no storage** (decision 9). `worker.module.ts` reaches
 *    nothing under `./storage/`, the two files in the worker's import
 *    closure pull in neither the module nor the SDK, and
 *    `HealthController.getHealth` guards the `@Optional()` service before it
 *    calls it — the worker resolves `undefined` there, so an unguarded call
 *    is a crash on `/health` at `WORKER_PORT` rather than a missing key.
 *
 * **Comment-stripping is load-bearing in four places**: the `buildObjectKey`
 * count and the key-literal scan (`object-key.ts`'s own docblock names
 * both), the import-absence claims (`storage-health.service.ts`'s docblock
 * names `./storage.module` and `./aws-s3-ops` to say it does not import
 * them), and the compose/CI reads (a commented-out line must not satisfy an
 * assertion).
 *
 * Every absence claim below is paired with a positive control that the scan
 * opened the file it is about — a walker that reads nothing passes an
 * absence claim vacuously.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps", "api", "src");

// ---------------------------------------------------------------------------
// Readers (the `tests/f4.24-worker-imports-no-api-loop.test.ts` rule-5 shape:
// hold the committed text statically, never the running stack; the helpers
// are file-local there, so they are copied rather than imported).
// ---------------------------------------------------------------------------

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
 * The text from a heading line to the end of `block`, or `""` when the
 * heading is absent — so each `it()` below holds exactly one `expect`, and a
 * missing heading fails the `it()` that names it rather than a shared setup.
 */
function sectionAfter(block: string, heading: RegExp): string {
  const found = heading.exec(block);
  return found === null ? "" : block.slice(found.index);
}

/** Block comments and `//` tails, for TypeScript sources. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

type SourceFile = { readonly rel: string; readonly code: string };

/** Every `.ts`/`.tsx` file under `apps/api/src`, comments stripped, posix-relative. */
function apiSources(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(next, rel);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      out.push({ rel, code: stripTsComments(readFileSync(next, "utf8")) });
    }
  };
  walk(apiSrc, "");
  return out;
}

const compose = withoutComments(readFileSync(join(repoRoot, "docker-compose.yml"), "utf8"));
const ci = withoutComments(readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"));
const sources = apiSources();

/**
 * The service blocks are read **lazily**, one call per `it()`. Reading them
 * at module scope would make a missing service throw during collection, and
 * a file that collected no tests reports one failure for the whole suite
 * rather than one red row per claim — and the per-claim red run is the
 * evidence that these assertions are not vacuous.
 */
const minioBlock = (): string => serviceBlock(compose, "minio");
const apiBlock = (): string => serviceBlock(compose, "api");
const apiReplicaBlock = (): string => serviceBlock(compose, "api-replica");
const workerBlock = (): string => serviceBlock(compose, "worker");

function source(rel: string): string {
  const found = sources.find((f) => f.rel === rel);
  expect(found, `apps/api/src/${rel} must exist`).toBeDefined();
  return found?.code ?? "";
}

/** The six variables the API reads (ADR 0066 decision 3). */
const OBJECT_STORAGE_VARS = [
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_FORCE_PATH_STYLE",
] as const;

function missingVars(text: string): string[] {
  return OBJECT_STORAGE_VARS.filter((name) => !new RegExp(`^\\s*${name}:`, "m").test(text));
}

/**
 * The pinned image line, in the one shape Amendment 1 allows: MinIO's own
 * registry and a dated `RELEASE.` stamp. `latest` cannot match it.
 */
const IMAGE_LINE =
  /^\s*image:\s*quay\.io\/minio\/minio:RELEASE\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\s*$/m;

/** The tag alone, so the CI match stops before ` server /data`. */
const TAG = /quay\.io\/minio\/minio:RELEASE\.[0-9TZ-]+/;

/** A string literal that STARTS with the key prefix — not `org/` mid-sentence in a test name. */
const KEY_LITERAL = /["'`]org\//;

/** A named import of `OBJECT_KEY_PREFIX` from an `object-key` module (F4.145). */
const OBJECT_KEY_PREFIX_IMPORT =
  /import\s*\{[^}]*\bOBJECT_KEY_PREFIX\b[^}]*\}\s*from\s*["'][^"']*object-key["']/;

describe("F3.3 — object storage in compose and CI (ADR 0066 decisions 4, 8, 9, 10)", () => {
  describe("the minio service (decision 9, Amendment 1 Q-C and the registry note)", () => {
    it("docker-compose.yml declares a minio service", () => {
      expect(compose).toMatch(/^ {2}minio:\s*$/m);
    });

    it("pins quay.io/minio/minio to a dated RELEASE tag, never latest", () => {
      expect(minioBlock()).toMatch(IMAGE_LINE);
    });

    it("carries the profiles core, pilot, phe and realtime-smoke (Q-C: api-replica depends on it)", () => {
      const profilesLine = /^\s*profiles:\s*\[([^\]]*)\]\s*$/m.exec(minioBlock());
      expect(profilesLine, "the minio service must declare a profiles: [...] line").not.toBeNull();
      const profiles = (profilesLine?.[1] ?? "").split(",").map((p) => p.trim().replace(/"/g, ""));
      expect(profiles).toEqual(["core", "pilot", "phe", "realtime-smoke"]);
    });

    it("runs server /data with the console on :9001 (the image's entrypoint needs a command)", () => {
      expect(minioBlock()).toMatch(
        /command:\s*\["server",\s*"\/data",\s*"--console-address",\s*":9001"\]/,
      );
    });

    it("publishes the S3 API on 127.0.0.1:9000 only (decision 8: plaintext, so loopback)", () => {
      expect(minioBlock()).toMatch(/^\s*-\s*"127\.0\.0\.1:9000:9000"\s*$/m);
    });

    it("does not publish 9000 on every interface (the negative of the row above)", () => {
      expect(minioBlock()).not.toMatch(/^\s*-\s*["']?9000:9000["']?\s*$/m);
    });

    it("publishes the console on 127.0.0.1:9001 only", () => {
      expect(minioBlock()).toMatch(/^\s*-\s*"127\.0\.0\.1:9001:9001"\s*$/m);
    });

    it("does not publish 9001 on every interface (the negative of the row above)", () => {
      expect(minioBlock()).not.toMatch(/^\s*-\s*["']?9001:9001["']?\s*$/m);
    });

    it("mounts the named volume bms-minio-data at /data", () => {
      expect(minioBlock()).toMatch(/^\s*-\s*bms-minio-data:\/data\s*$/m);
    });

    it("bms-minio-data is declared under the top-level volumes: block", () => {
      expect(sectionAfter(compose, /^volumes:\s*$/m)).toMatch(/^ {2}bms-minio-data:\s*$/m);
    });

    it("declares a healthcheck on /minio/health/live (api waits for service_healthy)", () => {
      expect(sectionAfter(minioBlock(), /^\s*healthcheck:\s*$/m)).toMatch(/\/minio\/health\/live/);
    });
  });

  describe("the api and api-replica services (decision 9)", () => {
    it("api sets OBJECT_STORAGE_ENDPOINT", () => {
      expect(apiBlock()).toMatch(/^\s*OBJECT_STORAGE_ENDPOINT:\s*\S+/m);
    });

    it("api sets all six OBJECT_STORAGE_ variables", () => {
      const missing = missingVars(apiBlock());
      expect(missing, `variables the api service does not set: ${missing.join(", ")}`).toEqual([]);
    });

    it("api's depends_on names minio", () => {
      expect(sectionAfter(apiBlock(), /^\s*depends_on:\s*$/m)).toMatch(/^\s*minio:\s*$/m);
    });

    it("api-replica sets OBJECT_STORAGE_ENDPOINT", () => {
      expect(apiReplicaBlock()).toMatch(/^\s*OBJECT_STORAGE_ENDPOINT:\s*\S+/m);
    });

    it("api-replica sets all six OBJECT_STORAGE_ variables", () => {
      const missing = missingVars(apiReplicaBlock());
      expect(missing, `variables api-replica does not set: ${missing.join(", ")}`).toEqual([]);
    });

    it("api-replica's depends_on names minio (Q-C: why minio carries realtime-smoke)", () => {
      expect(sectionAfter(apiReplicaBlock(), /^\s*depends_on:\s*$/m)).toMatch(/^\s*minio:\s*$/m);
    });

    it("the worker service sets no OBJECT_STORAGE_ variable at all (decision 9)", () => {
      expect(workerBlock()).not.toMatch(/OBJECT_STORAGE_/);
    });

    // Review finding E (2026-09-15): a pilot points the same compose file at
    // an `https://` endpoint and leaves the insecure flag unset in its
    // `.env`, so both lines must be `${VAR:-default}` — a bare literal
    // cannot be overridden without editing the committed file.
    it.each(["api", "api-replica"])("%s reads OBJECT_STORAGE_ENDPOINT as ${OBJECT_STORAGE_ENDPOINT:-…}", (name) => {
      expect(serviceBlock(compose, name)).toMatch(
        /^\s*OBJECT_STORAGE_ENDPOINT:\s*"?\$\{OBJECT_STORAGE_ENDPOINT:-http:\/\/minio:9000\}"?\s*$/m,
      );
    });

    // Post-merge sweep, security M-1 (2026-09-15): `${…:-true}` defaulted
    // the flag OPEN whenever a deployer left it unset — which is exactly
    // what `encryption-at-rest.md` §9 tells a deployer to do. The default
    // is now EMPTY (the ADR 0041 `${CREDENTIAL_ENCRYPTION_KEY:-}` shape):
    // an `http://` endpoint with the flag unset refuses the boot with the
    // decision-8 message, and only a dev `.env` sets it to `true`. The plan's
    // recorded refusal proof used a compose override that bypassed this
    // interpolation, so it proved the code guard and not the deployer path;
    // this row proves the path.
    it.each(["api", "api-replica"])("%s reads OBJECT_STORAGE_ALLOW_INSECURE as ${OBJECT_STORAGE_ALLOW_INSECURE:-} — an EMPTY default", (name) => {
      expect(serviceBlock(compose, name)).toMatch(
        /^\s*OBJECT_STORAGE_ALLOW_INSECURE:\s*"?\$\{OBJECT_STORAGE_ALLOW_INSECURE:-\}"?\s*$/m,
      );
    });

    it("the root .env.example carries an uncommented OBJECT_STORAGE_ALLOW_INSECURE=true (the dev value)", () => {
      const envExample = readFileSync(join(repoRoot, ".env.example"), "utf8");
      expect(envExample).toMatch(/^OBJECT_STORAGE_ALLOW_INSECURE=true\s*$/m);
    });
  });

  describe("CI runs the engine compose runs (decision 10, Amendment 1 Q-D)", () => {
    it("ci.yml names the same minio image tag as docker-compose.yml, byte for byte", () => {
      const inCompose = TAG.exec(minioBlock())?.[0];
      const inCi = TAG.exec(ci)?.[0];
      expect(
        inCompose,
        "docker-compose.yml must carry a quay.io/minio/minio:RELEASE. tag",
      ).toBeDefined();
      expect(inCi, "ci.yml must carry a quay.io/minio/minio:RELEASE. tag").toBeDefined();
      expect(inCi).toBe(inCompose);
    });

    it("ci.yml sets OBJECT_STORAGE_ENDPOINT (the storage gate refuses to skip under CI)", () => {
      expect(ci).toMatch(/^\s*OBJECT_STORAGE_ENDPOINT:\s*\S+/m);
    });

    it("ci.yml sets all six OBJECT_STORAGE_ variables", () => {
      const missing = missingVars(ci);
      expect(missing, `variables the CI job does not set: ${missing.join(", ")}`).toEqual([]);
    });

    it("ci.yml's MinIO readiness loop is a step that precedes the Run tests step", () => {
      // The order, not the mere presence: the readiness loop lives inside the
      // "Start MinIO" step, and that step must come before "Run tests" so the
      // storage spec never races the container.
      const startAt = ci.indexOf("- name: Start MinIO");
      const liveAt = ci.indexOf("/minio/health/live");
      const testsAt = ci.indexOf("- name: Run tests");
      expect(
        { startAt, liveAt, testsAt },
        "ci.yml must have a Start MinIO step, a /minio/health/live readiness loop inside it, and a Run tests step, in that order",
      ).toSatisfy(
        ({ startAt: s, liveAt: l, testsAt: t }: { startAt: number; liveAt: number; testsAt: number }) =>
          s > -1 && l > s && t > l,
      );
    });
  });

  describe("one key authority (decision 4)", () => {
    it("exactly one function buildObjectKey( exists under apps/api/src", () => {
      const definers = sources
        .filter((f) => f.code.includes("function buildObjectKey("))
        .map((f) => f.rel);
      expect(
        definers,
        "a second builder is a second key format; ADR 0066 decision 4 allows one",
      ).toEqual(["storage/object-key.ts"]);
    });

    it("positive control: the scan reads object-key.ts and sees the key literal in it", () => {
      expect(source("storage/object-key.ts")).toMatch(KEY_LITERAL);
    });

    it("no file but object-key.ts and its spec carries a string literal starting org/", () => {
      // `object-key.spec.ts` is the second allowlisted file ON PURPOSE: its
      // expected key is a hand-written literal, and that literal is the gate
      // on the builder's output. A spec that derived the expectation from
      // `buildObjectKey` would assert the function equals itself. Every other
      // reader goes through `buildObjectKey` or `OBJECT_KEY_PREFIX`.
      const allowed = ["storage/object-key.ts", "storage/object-key.spec.ts"];
      const offenders = sources
        .filter((f) => !allowed.includes(f.rel))
        .filter((f) => KEY_LITERAL.test(f.code))
        .map((f) => f.rel);
      expect(
        offenders,
        "these files build or match an object key from the literal rather than through " +
          "buildObjectKey/OBJECT_KEY_PREFIX:\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });

    it("no controller takes a key or objectKey parameter from the request", () => {
      const offenders = sources
        .filter((f) => f.rel.endsWith(".controller.ts"))
        .filter((f) => /@(?:Param|Query|Body)\(\s*["'](?:key|objectKey)["']\s*\)/.test(f.code))
        .map((f) => f.rel);
      expect(
        offenders,
        "a client-supplied key would reach the bucket past the uuid guard (decision 4):\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });

    it("positive control: the controller scan opened asset-images.controller.ts", () => {
      const controllers = sources.filter((f) => f.rel.endsWith(".controller.ts")).map((f) => f.rel);
      expect(controllers).toContain("assets/asset-images.controller.ts");
    });

    it("OBJECT_KEY_PREFIX is imported by *.spec.ts files only (F4.145)", () => {
      const offenders = sources
        .filter((f) => OBJECT_KEY_PREFIX_IMPORT.test(f.code))
        .filter((f) => !f.rel.endsWith(".spec.ts"))
        .map((f) => f.rel);
      expect(
        offenders,
        "a production module that imports the prefix and concatenates its own key carries neither " +
          "`function buildObjectKey(` nor the `org/` literal, so the two rows above cannot see it " +
          "(F4.145):\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });

    it("positive control: asset-images.service.spec.ts imports OBJECT_KEY_PREFIX", () => {
      const importers = sources
        .filter((f) => OBJECT_KEY_PREFIX_IMPORT.test(f.code))
        .map((f) => f.rel);
      expect(importers.length, "the scan must see at least one importer, or the row above is vacuous").toBeGreaterThan(0);
      expect(
        importers.every((rel) => rel.endsWith(".spec.ts")),
        `every importer must be a *.spec.ts file: ${importers.join(", ")}`,
      ).toBe(true);
      expect(importers).toContain("assets/asset-images.service.spec.ts");
    });
  });

  describe("the worker gets no storage (decision 9, plan Q-A)", () => {
    it("worker.module.ts reaches nothing under ./storage/", () => {
      expect(source("worker.module.ts")).not.toMatch(/\.\/storage\//);
    });

    it("storage-health.service.ts imports neither storage.module, aws-s3-ops nor @aws-sdk", () => {
      expect(source("storage/storage-health.service.ts")).not.toMatch(
        /storage\.module|aws-s3-ops|@aws-sdk/,
      );
    });

    it("health.controller.ts imports neither storage.module, aws-s3-ops nor @aws-sdk", () => {
      expect(source("health/health.controller.ts")).not.toMatch(
        /storage\.module|aws-s3-ops|@aws-sdk/,
      );
    });

    // Post-merge sweep (2026-09-15): `health.controller.ts` VALUE-imports
    // `withStorageVerdict` from `storage/storage-health.ts`, so the worker
    // loads that file too — the SDK-absence claim was one file short.
    it("storage/storage-health.ts imports neither storage.module, aws-s3-ops nor @aws-sdk", () => {
      expect(source("storage/storage-health.ts")).not.toMatch(
        /storage\.module|aws-s3-ops|@aws-sdk/,
      );
    });

    it("positive control: health.controller.ts does value-import storage/storage-health.ts", () => {
      expect(source("health/health.controller.ts")).toMatch(
        /^import\s*\{[^}]*\}\s*from\s*["']\.\.\/storage\/storage-health["']/m,
      );
    });

    it("positive control: health.controller.ts does import StorageHealthService", () => {
      expect(source("health/health.controller.ts")).toMatch(/storage-health\.service/);
    });

    it("positive control: getHealth calls this.storageHealth.read()", () => {
      expect(source("health/health.controller.ts")).toMatch(/this\.storageHealth\.read\(/);
    });

    it("getHealth guards on !this.storageHealth BEFORE it calls read() (the worker resolves undefined)", () => {
      // Index order, not co-presence: a guard that sits below the call is
      // text a co-presence assertion would accept and the worker would
      // crash on. Unit 5 measured that removing the guard alone reddens no
      // other test in the repository.
      const code = source("health/health.controller.ts");
      const guard = code.indexOf("if (!this.storageHealth)");
      const call = code.indexOf("this.storageHealth.read(");
      expect(
        guard,
        "getHealth must guard the @Optional() service with `if (!this.storageHealth)`",
      ).toBeGreaterThan(-1);
      expect(
        guard < call,
        `the guard must precede the call (guard at ${guard}, call at ${call}); the worker has no ` +
          "StorageModule, so an unguarded read() is a crash on WORKER_PORT /health",
      ).toBe(true);
    });

    it("app.module.ts imports StorageModule from ./storage/storage.module", () => {
      expect(source("app.module.ts")).toMatch(
        /import\s*\{\s*StorageModule\s*\}\s*from\s*["']\.\/storage\/storage\.module["']/,
      );
    });

    it("app.module.ts lists StorageModule in its @Module imports array", () => {
      expect(source("app.module.ts")).toMatch(/imports:\s*\[[^\]]*\bStorageModule\b/);
    });
  });

  describe("dependencies (ADR 0066 decision 2 and its Dependencies section)", () => {
    it("apps/api depends on @aws-sdk/client-s3", () => {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, "apps", "api", "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      expect(manifest.dependencies?.["@aws-sdk/client-s3"]).toBeTruthy();
    });

    it("no workspace manifest adds minio, @aws-sdk/lib-storage or sharp", () => {
      const manifests = [
        "package.json",
        "apps/api/package.json",
        "apps/web/package.json",
        "apps/sim/package.json",
        "apps/ingest/package.json",
        "packages/db/package.json",
        "packages/shared/package.json",
      ];
      const forbidden = ["minio", "@aws-sdk/lib-storage", "sharp"];
      const offenders: string[] = [];
      for (const rel of manifests) {
        const parsed = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const names = [
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
        ];
        for (const name of forbidden) {
          if (names.includes(name)) offenders.push(`${rel} -> ${name}`);
        }
      }
      expect(
        offenders,
        "the ADR's Dependencies section allows one new package; multipart and thumbnails are " +
          "deferred:\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });
  });
});
