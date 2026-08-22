import { QueryClient } from "@tanstack/react-query";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";

import { shouldRetryQuery } from "../lib/query-retry";
import { useAuthStore } from "../stores/auth-store";
import { adminFetch } from "./admin/client";

/**
 * `F4.63` — how many requests a refusal actually costs.
 *
 * ## Why this exists when `lib/query-retry.spec.ts` already passes
 *
 * That spec calls the predicate directly and asserts what it returns. This one
 * asserts the thing the row was written about: **the number of HTTP requests a
 * 403 produces**. Nothing in the predicate's own spec would notice if
 * `adminFetch` stopped attaching a status, if `ApiError` stopped being what it
 * throws, or if TanStack drove the predicate differently than assumed — and
 * that last one is not hypothetical, the sibling spec's helper modelled
 * `failureCount` off by one before `retryer.js` was read to settle it.
 *
 * Here the real `QueryClient` drives the real `adminFetch` through the real
 * predicate, and `fetch` is counted. The `403` body is the envelope the running
 * stack actually returned to `phe-admin@bms.local`, character for character.
 *
 * ## Why the request is stubbed rather than made against the API
 *
 * The claim is entirely client-side: given a 403, how many times does this app
 * ask again. The API's part — that it answers 403 at all — is covered by
 * `asset-templates.*.integration.spec.ts` against a real database. Reaching the
 * running API from here would need a Keycloak token, and the stack runs
 * `AUTH_MODE: oidc` with direct access grants disabled, so minting one means
 * changing the identity provider's configuration to make a test convenient.
 * Counting `fetch` measures the claim without doing that.
 *
 * ## Both directions, in one file
 *
 * The old behaviour is reconstructed rather than described: the same client
 * with `retry: 3`, the library default `main.tsx` used to take. If the "was 4"
 * half ever stops producing 4, the "is 1" half has lost its meaning.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The 403 body the running stack returned, character for character. */
const FORBIDDEN_BODY =
  '{"message":"Template is outside your access scope","error":"Forbidden","statusCode":403}';

type Attempt = { calls: number; error: unknown; ms: number };

/**
 * Runs one query to exhaustion against a stubbed `fetch` and counts the calls.
 *
 * `retryDelay: 0` removes the exponential backoff. The backoff is why the
 * defect was *felt* — the row measured roughly 40 seconds — but the assertion
 * here is the call count, and making a test wait to prove a number it can
 * already read would only make the suite slow.
 */
async function attempt(status: number, body: string, retry: unknown): Promise<Attempt> {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(body, { status });
  }) as typeof fetch;

  const client = new QueryClient({
    defaultOptions: { queries: { retry: retry as never, retryDelay: 0 } },
  });
  const started = Date.now();
  let error: unknown = null;
  try {
    await client.fetchQuery({
      queryKey: ["f4.63", status, String(retry)],
      queryFn: () => adminFetch("/admin/asset-templates/x", adminAssetTemplateDtoSchema),
    });
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.fetch = realFetch;
    client.clear();
  }
  return { calls, error, ms: Date.now() - started };
}

/**
 * A session, so `withAuth` attaches a header and the call is a real one.
 *
 * Modelled on `phe-admin@bms.local`, the account the browser measurement used.
 * An `organization_admin` carries `kind: "location"` — the scope resolves to
 * their organization's locations, which is what the header renders. The lists
 * are empty because nothing here reads them: what is measured is how many times
 * the client asks, not who it is.
 */
function signIn(): void {
  useAuthStore.getState().setSession(
    "token-abc",
    { id: "u1", email: "phe-admin@bms.local", displayName: "PHE Admin", role: "organization_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
  );
}

/**
 * The measurement, both directions.
 *
 * This is the counter-measurement to the row: an out-of-scope template read
 * cost **four** requests, and now costs **one**.
 */
export async function runForbiddenRequestCountTests(): Promise<void> {
  signIn();

  const now = await attempt(403, FORBIDDEN_BODY, shouldRetryQuery);
  assert(
    now.calls === 1,
    `a 403 must cost exactly one request, got ${now.calls}. This is the F4.63 defect: ` +
      `main.tsx is no longer passing shouldRetryQuery, or adminFetch is no longer ` +
      `throwing an ApiError that carries the status.`,
  );

  // The defect itself, reconstructed with the library default main.tsx used to
  // take. Without this the "1" above proves nothing — a client that never
  // retried anything would satisfy it just as well.
  const before = await attempt(403, FORBIDDEN_BODY, 3);
  assert(
    before.calls === 4,
    `the old retry: 3 default must still produce four requests, got ${before.calls}. ` +
      `If this changed, the "one request" assertion above is measuring against a ` +
      `baseline that no longer exists.`,
  );

  // The refusal must still reach the caller as its sentence, not as a timeout
  // or a swallowed error — one request is only an improvement if the message
  // arrives.
  assert(
    now.error instanceof Error && now.error.message === FORBIDDEN_BODY,
    `the 403 body must reach the caller unchanged, got ${String(now.error)}`,
  );
}

/** A 5xx must still spend the full budget — the change is narrow on purpose. */
export async function runRetryableRequestCountTests(): Promise<void> {
  signIn();

  const server = await attempt(503, "upstream is unavailable", shouldRetryQuery);
  assert(
    server.calls === 4,
    `a 503 must still cost four requests, got ${server.calls}. F4.63 narrowed which ` +
      `failures retry, not how many times — a 5xx may well be transient.`,
  );

  const throttled = await attempt(429, "slow down", shouldRetryQuery);
  assert(
    throttled.calls === 4,
    `a 429 must still be retried, got ${throttled.calls} requests. It means "not now", ` +
      `not "no".`,
  );

  const notFound = await attempt(404, '{"message":"Not Found","statusCode":404}', shouldRetryQuery);
  assert(
    notFound.calls === 1,
    `a 404 must cost one request, got ${notFound.calls}. The row is about refusals in ` +
      `general, not the 403 that happened to be measured.`,
  );
}
