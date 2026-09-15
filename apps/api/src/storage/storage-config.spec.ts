import { readStorageConfig, StorageConfigError } from "./storage-config";

/**
 * F3.3 (ADR 0066 decisions 3, 8) — the object storage configuration reader.
 *
 * Assertions live here; `storage-config.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per rule; the refusal rows are a
 * table the wrapper runs through `it.each`, so one failing input cannot hide
 * the rest.
 *
 * `captureThrow`'s "expected to throw" sentinel lives **outside** the `try`
 * (the `queue-config.spec.ts` lesson): a sentinel inside the `try` is caught
 * by the same `catch`, and a guard reduced to nothing stays green. Errors
 * are matched on `err.name`, never `instanceof` — the class identity does
 * not survive a duplicated module graph, the name does.
 *
 * Every refusal row carries a **neighbour-negative**: the message must name
 * its own variable and must not name the next guard's. One error class
 * serves nine guards, so without the negative a test cannot tell which one
 * fired.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Captures a throw. A call that returns fails here, with this message, never inside a `catch`. */
function captureThrow(run: () => unknown): unknown {
  let threw = false;
  let caught: unknown;
  try {
    run();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert(threw, "expected the call to throw, and it returned");
  return caught;
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

function errorMessage(err: unknown): string {
  return typeof err === "object" && err !== null
    ? String((err as { message?: unknown }).message)
    : String(err);
}

/** A complete `https://` configuration; each refusal row removes or corrupts one variable. */
const COMPLETE_HTTPS = {
  OBJECT_STORAGE_ENDPOINT: "https://s3.example.test",
  OBJECT_STORAGE_BUCKET: "bms-asset-images",
  OBJECT_STORAGE_ACCESS_KEY: "AKIAEXAMPLE",
  OBJECT_STORAGE_SECRET_KEY: "s3cr3tvalue",
} as const;

export function assertUnsetEndpointIsUnconfigured(): void {
  const config = readStorageConfig({});
  assert(
    config.kind === "unconfigured",
    `an absent OBJECT_STORAGE_ENDPOINT must read as unconfigured, got kind "${config.kind}"`,
  );
}

export function assertBlankEndpointIsUnconfigured(): void {
  const config = readStorageConfig({
    OBJECT_STORAGE_ENDPOINT: "   ",
    OBJECT_STORAGE_BUCKET: "b",
  });
  assert(
    config.kind === "unconfigured",
    `a whitespace-only OBJECT_STORAGE_ENDPOINT must read as unconfigured even with a bucket set, got kind "${config.kind}"`,
  );
}

export function assertMinimalHttpsConfigParsesWithDefaults(): void {
  const config = readStorageConfig(COMPLETE_HTTPS);
  assert(config.kind === "configured", `expected kind "configured", got "${config.kind}"`);
  if (config.kind !== "configured") {
    return;
  }
  assert(
    config.endpoint instanceof URL && config.endpoint.href === "https://s3.example.test/",
    `expected the endpoint as a URL with href "https://s3.example.test/", got ${String(config.endpoint)}`,
  );
  assert(config.bucket === "bms-asset-images", `expected bucket "bms-asset-images", got "${config.bucket}"`);
  assert(config.accessKeyId === "AKIAEXAMPLE", `expected accessKeyId "AKIAEXAMPLE", got "${config.accessKeyId}"`);
  assert(config.secretAccessKey === "s3cr3tvalue", "expected the secret to be carried verbatim");
  assert(config.region === "us-east-1", `expected the default region "us-east-1", got "${config.region}"`);
  assert(config.forcePathStyle === true, `expected forcePathStyle to default to true, got ${config.forcePathStyle}`);
}

export function assertExplicitRegionIsCarried(): void {
  const config = readStorageConfig({ ...COMPLETE_HTTPS, OBJECT_STORAGE_REGION: " eu-west-1 " });
  assert(
    config.kind === "configured" && config.region === "eu-west-1",
    `expected the trimmed explicit region "eu-west-1", got ${JSON.stringify(config)}`,
  );
}

export function assertForcePathStyleFalseFlipsPathStyle(): void {
  const config = readStorageConfig({ ...COMPLETE_HTTPS, OBJECT_STORAGE_FORCE_PATH_STYLE: "false" });
  assert(
    config.kind === "configured" && config.forcePathStyle === false,
    `expected OBJECT_STORAGE_FORCE_PATH_STYLE=false to read as forcePathStyle: false, got ${JSON.stringify(config)}`,
  );
}

export function assertForcePathStyleTrueAndBlankReadTrue(): void {
  for (const raw of ["true", "", "  "]) {
    const config = readStorageConfig({ ...COMPLETE_HTTPS, OBJECT_STORAGE_FORCE_PATH_STYLE: raw });
    assert(
      config.kind === "configured" && config.forcePathStyle === true,
      `expected OBJECT_STORAGE_FORCE_PATH_STYLE=${JSON.stringify(raw)} to read as forcePathStyle: true, got ${JSON.stringify(config)}`,
    );
  }
}

/** Positive control for the decision-8 guard: `http://` with the exact flag is accepted. */
export function assertHttpWithAllowInsecureTrueIsAccepted(): void {
  const config = readStorageConfig({
    ...COMPLETE_HTTPS,
    OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
    OBJECT_STORAGE_ALLOW_INSECURE: "true",
  });
  assert(
    config.kind === "configured" && config.endpoint.protocol === "http:",
    `expected an http:// endpoint with OBJECT_STORAGE_ALLOW_INSECURE=true to be accepted, got ${JSON.stringify(config)}`,
  );
}

export type RefusalRow = {
  readonly label: string;
  readonly env: Record<string, string | undefined>;
  readonly message: string;
  /** Variables the *next* guards own — none may appear in this guard's message. */
  readonly mustNotName: readonly string[];
};

const HTTP_MESSAGE =
  "OBJECT_STORAGE_ENDPOINT uses plain http; set OBJECT_STORAGE_ALLOW_INSECURE=true to accept it (ADR 0066 decision 8)";

/**
 * One row per guard in `readStorageConfig`, in guard order, plus the
 * near-miss values of `OBJECT_STORAGE_ALLOW_INSECURE` (`TRUE`, `1`, `yes`)
 * that a lenient comparison would accept. Every row is a complete
 * configuration apart from the one variable under test, so the guard under
 * test is the only one that can fire.
 */
export const REFUSAL_ROWS: readonly RefusalRow[] = [
  {
    label: "not a URL",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_ENDPOINT: "not a url" },
    message: "OBJECT_STORAGE_ENDPOINT is not a valid URL",
    mustNotName: ["scheme", "OBJECT_STORAGE_BUCKET"],
  },
  {
    label: "ftp scheme",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_ENDPOINT: "ftp://s3.example.test" },
    message: "OBJECT_STORAGE_ENDPOINT must use the http or https scheme",
    mustNotName: ["OBJECT_STORAGE_ALLOW_INSECURE", "OBJECT_STORAGE_BUCKET"],
  },
  {
    label: "http without OBJECT_STORAGE_ALLOW_INSECURE",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000" },
    message: HTTP_MESSAGE,
    mustNotName: ["OBJECT_STORAGE_BUCKET"],
  },
  {
    label: "http with OBJECT_STORAGE_ALLOW_INSECURE=TRUE (case is exact)",
    env: {
      ...COMPLETE_HTTPS,
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_ALLOW_INSECURE: "TRUE",
    },
    message: HTTP_MESSAGE,
    mustNotName: ["OBJECT_STORAGE_BUCKET"],
  },
  {
    label: "http with OBJECT_STORAGE_ALLOW_INSECURE=1",
    env: {
      ...COMPLETE_HTTPS,
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_ALLOW_INSECURE: "1",
    },
    message: HTTP_MESSAGE,
    mustNotName: ["OBJECT_STORAGE_BUCKET"],
  },
  {
    label: "missing OBJECT_STORAGE_BUCKET",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_BUCKET: undefined },
    message: "OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_ENDPOINT is set",
    mustNotName: ["OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY"],
  },
  {
    label: "whitespace-only OBJECT_STORAGE_BUCKET",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_BUCKET: "  " },
    message: "OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_ENDPOINT is set",
    mustNotName: ["OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY"],
  },
  {
    label: "missing OBJECT_STORAGE_ACCESS_KEY",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_ACCESS_KEY: undefined },
    message: "OBJECT_STORAGE_ACCESS_KEY is required when OBJECT_STORAGE_ENDPOINT is set",
    mustNotName: ["OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_SECRET_KEY"],
  },
  {
    label: "missing OBJECT_STORAGE_SECRET_KEY",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_SECRET_KEY: undefined },
    message: "OBJECT_STORAGE_SECRET_KEY is required when OBJECT_STORAGE_ENDPOINT is set",
    mustNotName: ["OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY"],
  },
  {
    label: "OBJECT_STORAGE_FORCE_PATH_STYLE=yes",
    env: { ...COMPLETE_HTTPS, OBJECT_STORAGE_FORCE_PATH_STYLE: "yes" },
    message: "OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false",
    mustNotName: ["OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_REGION"],
  },
];

export function assertRefusalRowThrowsItsOwnMessageAndNotTheNeighbours(row: RefusalRow): void {
  const err = captureThrow(() => readStorageConfig(row.env));
  assert(
    errorName(err) === "StorageConfigError",
    `expected err.name === "StorageConfigError" for "${row.label}", got "${errorName(err)}"`,
  );
  assert(
    errorMessage(err) === row.message,
    `expected the guard's own message ${JSON.stringify(row.message)} for "${row.label}", got ${JSON.stringify(errorMessage(err))}`,
  );
  for (const neighbour of row.mustNotName) {
    assert(
      !errorMessage(err).includes(neighbour),
      `the "${row.label}" refusal must not name the neighbour guard's "${neighbour}" — got "${errorMessage(err)}"`,
    );
  }
}

/**
 * Guard order (decision 8 before decision 3): an `http://` endpoint with no
 * bucket is refused for the scheme, not the bucket. A reader that checked
 * the bucket first would still pass every single-fault row above.
 */
export function assertHttpRefusalFiresBeforeMissingBucket(): void {
  const err = captureThrow(() =>
    readStorageConfig({ OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000" }),
  );
  assert(
    errorMessage(err) === HTTP_MESSAGE,
    `expected the http refusal to fire before the bucket guard, got "${errorMessage(err)}"`,
  );
}

/**
 * §9.6: no refusal carries the endpoint or the secret. The endpoint host
 * and the secret are distinctive strings; the positive control proves the
 * message was read at all (an absence check needs an adjacent positive).
 */
export function assertNoRefusalEchoesTheEndpointOrSecret(): void {
  const err = captureThrow(() =>
    readStorageConfig({
      OBJECT_STORAGE_ENDPOINT: "https://s3cret-host.example",
      OBJECT_STORAGE_ACCESS_KEY: "AKIAEXAMPLE",
      OBJECT_STORAGE_SECRET_KEY: "s3cr3tvalue",
    }),
  );
  const message = errorMessage(err);
  assert(
    message.includes("OBJECT_STORAGE_BUCKET"),
    `positive control: expected the missing-bucket refusal to name OBJECT_STORAGE_BUCKET, got "${message}"`,
  );
  assert(
    !message.includes("s3cret-host.example"),
    `the refusal must not echo the endpoint host — got "${message}"`,
  );
  assert(!message.includes("s3cr3tvalue"), `the refusal must not echo the secret — got "${message}"`);
  assert(!message.includes("AKIAEXAMPLE"), `the refusal must not echo the access key — got "${message}"`);
}

/** The scheme refusal is the one that reads the URL; it must not echo it either. */
export function assertSchemeRefusalDoesNotEchoTheEndpoint(): void {
  const err = captureThrow(() =>
    readStorageConfig({ ...COMPLETE_HTTPS, OBJECT_STORAGE_ENDPOINT: "ftp://s3cret-host.example" }),
  );
  assert(
    !errorMessage(err).includes("s3cret-host"),
    `the scheme refusal must not echo the endpoint — got "${errorMessage(err)}"`,
  );
}

/** Exercised so the exported class is referenced from a test (dead-import guard). */
export function assertStorageConfigErrorNameIsStable(): void {
  const err = new StorageConfigError("x");
  assert(err.name === "StorageConfigError", `expected name "StorageConfigError", got "${err.name}"`);
}
