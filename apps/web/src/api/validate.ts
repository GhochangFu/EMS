import type { Contract, ContractSchema } from "@bms/shared/contracts";

/**
 * Response validation at the client boundary — ADR 0030 decision 5 (`F4.23`).
 *
 * Every read in `apps/web/src/api/` used to end `return res.json() as
 * Promise<T>`: an assertion, not a check. The type said what the payload was
 * and nothing confirmed it, so a field that changed type or disappeared was
 * discovered by a component rendering `undefined` — somewhere else, later, with
 * no trace back to the endpoint that lied.
 *
 * ## It validates. It does not transform.
 *
 * `checkResponse` returns **the original payload**, never `result.data`.
 *
 * That is deliberate and it is the single most important line here. Zod strips
 * unknown keys from objects by default, so returning the parsed value would
 * silently DELETE any field the server sends that a schema has not caught up
 * with — turning this from a safety net into the most efficient way yet
 * invented to lose data. A server that adds a field is doing the normal thing;
 * a client that drops it because its schema is a version behind is not.
 *
 * So the parse result is used only for its verdict, and success is a complete
 * no-op on the value. On the measured surface this changes nothing at all:
 * `F4.23`'s spike found **zero drift across 99 declared paths**, so today every
 * call succeeds and returns exactly what it always did.
 *
 * ## Throw in dev and test, log and pass in production
 *
 * ADR 0030 decision 5, settled by the spike. The reasoning is the asymmetry of
 * the two failure directions, the same one that settled `API_DOCS_ENABLED` in
 * ADR 0029 Amendment 2: for a monitoring product, a **blank Control Room page
 * during an incident is worse than a page rendering with one drifted field**.
 * Loud where a developer sees it; forgiving where an operator does.
 *
 * The spike measured drift at zero, which is what makes throwing affordable in
 * development — but it measured only 4 of 93 routes. Log-and-pass in production
 * is the cheap insurance for the other 89.
 *
 * ## What gets logged, and what deliberately does not
 *
 * **Only `path` and `code` from each Zod issue.** Never `message`, never
 * `received`, never the payload.
 *
 * This is not caution for its own sake — AGENTS.md §9.6 forbids logging
 * secrets and PII, and Zod issues carry values. `invalid_literal` and
 * `invalid_enum_value` both put the **actual received value** in `received`,
 * and their `message` embeds it too ("Invalid enum value. Expected 'a' | 'b',
 * received '…'"). Logging `error.issues` verbatim would therefore publish
 * whatever the server sent — an asset name, an operator's email, a telemetry
 * reading — into the browser console of a shared operations workstation.
 *
 * `path` plus `code` says which field broke and how, which is what a developer
 * needs to go and look.
 */

/**
 * Measured, not assumed: under vitest this repo reports
 * `{ DEV: true, MODE: "test", PROD: false }`, so `DEV` alone already covers
 * the test run and the `MODE` clause is belt-and-braces for a future config
 * that stops setting it.
 *
 * Written as "throw in these two" rather than "log-and-pass in production"
 * on purpose. **An environment nobody anticipated falls through to
 * log-and-pass**, which is the forgiving direction — the same asymmetry ADR
 * 0029 Amendment 2 applied when unrecognised `API_DOCS_ENABLED` values fall
 * through to the default rather than to "on".
 */
function shouldThrowOnDrift(): boolean {
  const env = import.meta.env;
  return Boolean(env.DEV) || env.MODE === "test";
}

/**
 * Zod issue reduced to its non-sensitive parts. See the note above.
 *
 * The error is typed STRUCTURALLY rather than as `z.ZodError` — same reason
 * `ContractSchema` exists: holding a zod type here would make zod a direct
 * dependency of apps/web and open a §9.4 gate ADR 0030 does not cover.
 */
type ZodIssueBearer = { issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; code: string }> };

type SafeIssue = { path: string; code: string };

function safeIssues(error: ZodIssueBearer): SafeIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : "(root)",
    code: issue.code,
  }));
}

export class ResponseContractError extends Error {
  readonly endpoint: string;
  readonly issues: SafeIssue[];

  constructor(endpoint: string, issues: SafeIssue[]) {
    super(
      `Response from ${endpoint} does not match its contract: ` +
        issues.map((i) => `${i.path} (${i.code})`).join(", ") +
        ". The API and @bms/shared/contracts disagree — fix whichever is wrong " +
        "rather than loosening the schema to make this pass.",
    );
    this.name = "ResponseContractError";
    this.endpoint = endpoint;
    this.issues = issues;
  }
}

/**
 * Checks `payload` against `schema` and returns it **unchanged**.
 *
 * @param endpoint a stable label for the route, used in the error and the log
 *                 line. Not the URL — a URL can carry ids, and these strings
 *                 end up in console output.
 */
export function checkResponse<S extends ContractSchema>(
  schema: S,
  payload: unknown,
  endpoint: string,
): Contract<S> {
  const result = schema.safeParse(payload);

  if (!result.success) {
    const issues = safeIssues(result.error);
    if (shouldThrowOnDrift()) {
      throw new ResponseContractError(endpoint, issues);
    }
    // Production: the page keeps rendering. `console.error` rather than `warn`
    // so it survives a console filtered to errors, which is how an operator's
    // browser is usually left.
    console.error("[contract] response drift", { endpoint, issues });
  }

  // The original value either way — see "It validates. It does not transform."
  return payload as Contract<S>;
}

/**
 * `res.json()` followed by `checkResponse`, which is every call site's shape.
 *
 * **Strictly post-guard: call this only after the site's own `!res.ok` block.**
 * Every reader in this directory clears the session on an auth failure before
 * touching the body (`clearSessionOnAuthFailure`), and an error body is not a
 * response contract. Handing a 401 to this function would contract-check the
 * error envelope instead of clearing the session — an auth regression that no
 * schema test would ever catch, because the schema would simply report drift
 * and the log-and-pass branch would swallow it in production.
 *
 * That ordering is not left to reviewers to notice: the assertion below fails
 * loudly the first time anyone gets it wrong.
 */
export async function readJson<S extends ContractSchema>(
  res: Response,
  schema: S,
  endpoint: string,
): Promise<Contract<S>> {
  if (!res.ok) {
    throw new Error(
      `readJson called on a ${res.status} response from ${endpoint}. ` +
        "Handle `!res.ok` first — an error body is not a response contract, and " +
        "checking it here skips clearSessionOnAuthFailure.",
    );
  }
  return checkResponse(schema, await res.json(), endpoint);
}
