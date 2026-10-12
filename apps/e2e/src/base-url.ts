/**
 * ADR 0100 decision 6 — the suite never runs against a shared deployment.
 *
 * Only `127.0.0.1` and `localhost` pass. The check reads the parsed
 * `hostname`, not the string, so `http://127.0.0.1.evil.example` fails; IPv6
 * loopback fails too, because the API's CORS allowlist names only the two
 * hosts above (`apps/api/src/main.ts`).
 *
 * No imports on purpose: `tests/f4.7-e2e-invariants.test.ts` loads this file
 * under Vitest and the non-strict `tsconfig.typecheck-tests.json`.
 */
export class E2eBaseUrlError extends Error {
  override readonly name = "E2eBaseUrlError";
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** Parses `url` and throws `E2eBaseUrlError` unless its host is `127.0.0.1` or `localhost`. */
export function assertLocalBaseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new E2eBaseUrlError(`E2E base URL is not a URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new E2eBaseUrlError(`E2E base URL must be http(s), got ${parsed.protocol} in ${url}`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new E2eBaseUrlError(
      `E2E base URL must be 127.0.0.1 or localhost, got host ${JSON.stringify(parsed.hostname)} in ${url}`,
    );
  }
  return parsed;
}
