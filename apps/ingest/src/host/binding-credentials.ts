/**
 * The credential helpers of the binding plan (ADR 0016 §4, ADR 0062): moved
 * unchanged from `bindings.ts`, which sat at the 1000-line cap (`F1.2`).
 */

/**
 * Keeps only string-valued entries.
 *
 * `decryptCredentials` ends in `JSON.parse`, so the plaintext can hold anything
 * the API wrote. `AdapterContext.credentials` is `Record<string, string>`, and
 * a number leaking through as a `string` at the type level is the kind of lie
 * that surfaces as an unreadable protocol error three layers down. Dropped keys
 * are reported by name; **values never appear anywhere** (AGENTS.md §9.6).
 */
export function narrowCredentials(raw: Record<string, unknown>): {
  credentials: Record<string, string>;
  droppedKeys: string[];
} {
  const credentials: Record<string, string> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      credentials[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  return { credentials, droppedKeys };
}

/**
 * The one credential-failure cause worth naming to an operator: the row was
 * encrypted under a key this process does not hold (ADR 0062 decision 4).
 *
 * **A constant, never `err.message`.** §9.6 keeps crypto text out of the skip
 * report because it can carry key material or ciphertext framing, and the
 * report is served on the health endpoint. A fixed token also keeps the
 * vocabulary closed, so an operator can grep for it. Every other failure — a
 * wrong-length IV, a bad tag, a truncated ciphertext — carries no detail at
 * all, which is why this returns an empty object rather than a second string.
 *
 * Matched on `name` rather than `instanceof`: vitest can load two module
 * instances of `@bms/shared` (`F4.108`), and the ingest host loads the built
 * `dist` while a spec may load the source.
 */
export function keyVersionDetail(error: unknown): { detail?: string } {
  const name =
    typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "CredentialKeyVersionError" ? { detail: "key-version-not-loaded" } : {};
}
