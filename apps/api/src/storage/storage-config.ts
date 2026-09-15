/**
 * The object storage configuration reader (ADR 0066 decisions 3, 8).
 *
 * `readStorageConfig` mirrors `queue/queue-config.ts`'s rule for
 * `REDIS_URL`: an unset or whitespace-only `OBJECT_STORAGE_ENDPOINT` reads
 * as **unconfigured**, not an error, so a native-dev machine without MinIO
 * still boots the API with `storage.configured: false` and the asset image
 * routes answering 503. A **set** endpoint is a claim that a store exists:
 * from there every guard is a boot refusal (`StorageConfigError`), so a
 * half-configured deployment never runs as "unconfigured" (decision 3).
 *
 * Guard order, one message per guard, none carrying a value:
 *
 *  1. endpoint unset/blank → unconfigured
 *  2. endpoint is not a URL
 *  3. scheme is not `http:`/`https:`
 *  4. `http:` without `OBJECT_STORAGE_ALLOW_INSECURE=true` — exact `"true"`,
 *     no case folding and no `1`/`yes` (decision 8: a production deployment
 *     that forgets TLS fails at boot instead of shipping plaintext)
 *  5. bucket blank  6. access key blank  7. secret key blank
 *  8. region blank → `us-east-1`
 *  9. `OBJECT_STORAGE_FORCE_PATH_STYLE` blank/`true` → true, `false` →
 *     false, anything else refused
 *
 * **No thrown message ever contains the endpoint, the access key or the
 * secret** (AGENTS.md §9.6). The message says which rule failed and the
 * operator reads the value from their own environment.
 */

export class StorageConfigError extends Error {
  override readonly name = "StorageConfigError";
}

export type StorageConfig =
  | { readonly kind: "unconfigured" }
  | {
      readonly kind: "configured";
      readonly endpoint: URL;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly region: string;
      readonly forcePathStyle: boolean;
    };

const DEFAULT_REGION = "us-east-1";

function trimmed(raw: string | undefined): string {
  return raw === undefined ? "" : raw.trim();
}

/** Guards 5–7 share one shape: a set endpoint makes the variable mandatory. */
function requireWithEndpoint(name: string, raw: string | undefined): string {
  const value = trimmed(raw);
  if (value === "") {
    throw new StorageConfigError(`${name} is required when OBJECT_STORAGE_ENDPOINT is set`);
  }
  return value;
}

function readForcePathStyle(raw: string | undefined): boolean {
  const value = trimmed(raw);
  if (value === "" || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new StorageConfigError("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false");
}

/** Reads the six `OBJECT_STORAGE_*` variables from `env`; see the file docblock for the guard order. */
export function readStorageConfig(env: Record<string, string | undefined>): StorageConfig {
  const rawEndpoint = trimmed(env.OBJECT_STORAGE_ENDPOINT);
  if (rawEndpoint === "") {
    return { kind: "unconfigured" };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new StorageConfigError("OBJECT_STORAGE_ENDPOINT is not a valid URL");
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new StorageConfigError("OBJECT_STORAGE_ENDPOINT must use the http or https scheme");
  }

  if (endpoint.protocol === "http:" && env.OBJECT_STORAGE_ALLOW_INSECURE !== "true") {
    throw new StorageConfigError(
      "OBJECT_STORAGE_ENDPOINT uses plain http; set OBJECT_STORAGE_ALLOW_INSECURE=true to accept it (ADR 0066 decision 8)",
    );
  }

  const bucket = requireWithEndpoint("OBJECT_STORAGE_BUCKET", env.OBJECT_STORAGE_BUCKET);
  const accessKeyId = requireWithEndpoint("OBJECT_STORAGE_ACCESS_KEY", env.OBJECT_STORAGE_ACCESS_KEY);
  const secretAccessKey = requireWithEndpoint("OBJECT_STORAGE_SECRET_KEY", env.OBJECT_STORAGE_SECRET_KEY);

  const region = trimmed(env.OBJECT_STORAGE_REGION) || DEFAULT_REGION;
  const forcePathStyle = readForcePathStyle(env.OBJECT_STORAGE_FORCE_PATH_STYLE);

  return {
    kind: "configured",
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
  };
}
