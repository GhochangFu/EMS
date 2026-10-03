import "../../load-env";

import pg from "pg";

import { mapKeycloakFailure } from "../identity-admin.client";
import { buildIdentityAdminConfig, type IdentityAdminConfig } from "../identity-admin.config";
import {
  ADMIN_CLIENT_ID,
  SERVICE_ACCOUNT_ROLES,
  desiredAdminClient,
  desiredRealmSettings,
  desiredUserProfile,
  unlinkedUnverifiedReport,
  type RealmUserSummary,
  type UserProfileConfig,
  type UserRowSummary,
} from "./provision-plan";

/**
 * `F3.78` U4 (ADR 0089 decisions 4–6) — `pnpm --filter api keycloak:provision`,
 * the one-shot step that makes realm `bms` ready for user administration, on
 * a new realm and an existing one alike:
 *
 * 1. logs into realm `master` on `admin-cli` as `KEYCLOAK_ADMIN`, retrying the
 *    first request for up to 120 s while Keycloak starts;
 * 2. `PUT`s the realm settings — the password policy and brute force;
 * 3. creates or updates the `bms-api-admin` client, then sets its secret from
 *    `KEYCLOAK_ADMIN_CLIENT_SECRET` (an empty one is refused before any call);
 * 4. leaves the service account with exactly `manage-users` and `view-users`;
 * 5. reads the user profile and writes it back with only
 *    `email.permissions.edit` changed to `["admin"]` and the `required` block
 *    removed from `firstName` and `lastName` (owner ruling Q-D);
 * 6. reads `bms.users (email, oidc_subject)` on `DATABASE_URL_AUTH` and lists
 *    every realm user that is unverified **and** unlinked, by email. Exit 2
 *    when that list is not empty, 1 on any failure, 0 otherwise.
 *
 * **The logging rule is the client's.** A failure is reported by step and
 * status ({@link mapKeycloakFailure}); its body is cancelled unread. No
 * request or response body is printed — `GET /clients` returns the secret —
 * and neither is `error_description`, a network error's message, or
 * `KEYCLOAK_ADMIN_PASSWORD`. The URL, realm, client id and secret are read
 * through `buildIdentityAdminConfig`, so the step obeys decision 5's
 * `https://`-or-`http://keycloak:8080` rule like the API does.
 *
 * `process.stdout.write`, not `console.log` — `scripts/checks/style-hygiene.mjs`.
 */

export type ProvisionDeps = {
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: typeof globalThis.fetch;
  readonly readUserRows: () => Promise<UserRowSummary[]>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
};

/** How long the first request waits for Keycloak to answer. */
const FIRST_REQUEST_WINDOW_MS = 120_000;
const RETRY_INTERVAL_MS = 2_000;
const PAGE_SIZE = 100;

const PREFIX = "keycloak:provision";

/** A failure the runner reports by step and status — never by body or message. */
class ProvisionError extends Error {
  override readonly name = "ProvisionError";

  constructor(
    readonly step: string,
    readonly status: number | null,
  ) {
    super(
      status === null
        ? `${step} failed: no response (unavailable)`
        : `${step} failed: HTTP ${status} (${mapKeycloakFailure(status)})`,
    );
  }
}

/** A refusal before any request: names a variable, never a value. */
class ProvisionRefusal extends Error {
  override readonly name = "ProvisionRefusal";
}

type Role = { id: string; name: string };

class Provisioner {
  private readonly fetch: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private token = "";

  constructor(
    private readonly deps: ProvisionDeps,
    private readonly config: IdentityAdminConfig,
    private readonly admin: { username: string; password: string },
  ) {
    this.fetch = deps.fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? Date.now;
  }

  async run(): Promise<number> {
    await this.logIn();
    const { out } = this.deps;

    await this.call("realm settings", "PUT", "", desiredRealmSettings());
    out(`${PREFIX}: realm ${this.config.realm} settings applied (password policy, brute force)`);

    const clientUuid = await this.ensureClient();
    await this.call("client secret", "PUT", `/clients/${enc(clientUuid)}`, {
      clientId: ADMIN_CLIENT_ID,
      secret: this.config.clientSecret,
    });
    out(`${PREFIX}: client ${ADMIN_CLIENT_ID} secret set from KEYCLOAK_ADMIN_CLIENT_SECRET`);

    await this.ensureServiceAccountRoles(clientUuid);

    const profile = await this.json<UserProfileConfig>("user profile", "GET", "/users/profile");
    await this.call("user profile", "PUT", "/users/profile", desiredUserProfile(profile));
    out(`${PREFIX}: user profile applied (email editable by an admin only; first and last name optional)`);

    const report = unlinkedUnverifiedReport(await this.realmUsers(), await this.deps.readUserRows());
    if (report.length === 0) {
      out(`${PREFIX}: no realm user is both unverified and unlinked`);
      return 0;
    }
    out(
      `${PREFIX}: ${report.length} realm user(s) are unverified and unlinked, so they cannot sign in to link — ` +
        "see docs/runbooks/keycloak-user-administration.md:",
    );
    for (const email of report) {
      out(`  ${email}`);
    }
    return 2;
  }

  /** The master-realm token, retried while Keycloak is not answering yet. */
  private async logIn(): Promise<void> {
    const deadline = this.now() + FIRST_REQUEST_WINDOW_MS;
    for (;;) {
      let res: Response | null = null;
      try {
        res = await this.fetch(`${this.config.url}/realms/master/protocol/openid-connect/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "password",
            client_id: "admin-cli",
            username: this.admin.username,
            password: this.admin.password,
          }).toString(),
          redirect: "manual",
        });
      } catch {
        res = null;
      }
      const retryable = res === null || res.status >= 500;
      if (!retryable && res !== null) {
        if (!res.ok) {
          discard(res);
          throw new ProvisionError("master login", res.status);
        }
        const body = (await safeJson(res)) as { access_token?: unknown } | null;
        if (typeof body?.access_token !== "string" || body.access_token === "") {
          throw new ProvisionError("master login", res.status);
        }
        this.token = body.access_token;
        return;
      }
      if (res !== null) {
        discard(res);
      }
      if (this.now() >= deadline) {
        throw new ProvisionError("master login", res === null ? null : res.status);
      }
      await this.sleep(RETRY_INTERVAL_MS);
    }
  }

  private async ensureClient(): Promise<string> {
    const query = `/clients?clientId=${enc(ADMIN_CLIENT_ID)}`;
    const found = await this.json<{ id?: unknown }[]>("client lookup", "GET", query);
    const existing = Array.isArray(found) ? found[0] : undefined;
    if (existing && typeof existing.id === "string") {
      await this.call("client update", "PUT", `/clients/${enc(existing.id)}`, desiredAdminClient());
      this.deps.out(`${PREFIX}: client ${ADMIN_CLIENT_ID} updated (${existing.id})`);
      return existing.id;
    }
    const res = await this.call("client create", "POST", "/clients", desiredAdminClient());
    const id = lastSegment(res.headers.get("location"));
    if (id === null) {
      throw new ProvisionError("client create", res.status);
    }
    this.deps.out(`${PREFIX}: client ${ADMIN_CLIENT_ID} created (${id})`);
    return id;
  }

  private async ensureServiceAccountRoles(clientUuid: string): Promise<void> {
    const sa = await this.json<{ id?: unknown }>(
      "service account",
      "GET",
      `/clients/${enc(clientUuid)}/service-account-user`,
    );
    const rm = await this.json<{ id?: unknown }[]>(
      "realm-management lookup",
      "GET",
      "/clients?clientId=realm-management",
    );
    const saId = typeof sa?.id === "string" ? sa.id : null;
    const rmId = Array.isArray(rm) && typeof rm[0]?.id === "string" ? rm[0].id : null;
    if (saId === null || rmId === null) {
      throw new ProvisionError("service account roles", null);
    }

    const path = `/users/${enc(saId)}/role-mappings/clients/${enc(rmId)}`;
    const mapped = roles(await this.json<unknown>("service account roles", "GET", path));
    const available = roles(await this.json<unknown>("service account roles", "GET", `${path}/available`));
    const wanted: readonly string[] = SERVICE_ACCOUNT_ROLES;

    const toRemove = mapped.filter((r) => !wanted.includes(r.name));
    const toAdd: Role[] = [];
    for (const name of wanted) {
      if (mapped.some((r) => r.name === name)) continue;
      const role = available.find((r) => r.name === name);
      if (role === undefined) {
        throw new ProvisionError(`service account role ${name}`, null);
      }
      toAdd.push(role);
    }
    if (toRemove.length > 0) {
      await this.call("service account roles", "DELETE", path, toRemove);
    }
    if (toAdd.length > 0) {
      await this.call("service account roles", "POST", path, toAdd);
    }
    this.deps.out(
      `${PREFIX}: service account holds realm-management ${wanted.join(", ")}` +
        (toRemove.length > 0 ? ` (removed ${toRemove.map((r) => r.name).join(", ")})` : ""),
    );
  }

  private async realmUsers(): Promise<RealmUserSummary[]> {
    const users: RealmUserSummary[] = [];
    for (let first = 0; ; first += PAGE_SIZE) {
      const page = await this.json<unknown>(
        "realm users",
        "GET",
        `/users?briefRepresentation=true&first=${first}&max=${PAGE_SIZE}`,
      );
      if (!Array.isArray(page)) {
        throw new ProvisionError("realm users", null);
      }
      for (const u of page as { id?: unknown; email?: unknown; emailVerified?: unknown }[]) {
        if (typeof u?.id !== "string") continue;
        users.push({
          id: u.id,
          email: typeof u.email === "string" ? u.email : undefined,
          emailVerified: u.emailVerified === true ? true : u.emailVerified === false ? false : undefined,
        });
      }
      if (page.length < PAGE_SIZE) {
        return users;
      }
    }
  }

  // --- transport -----------------------------------------------------------

  private async json<T>(step: string, method: string, path: string): Promise<T> {
    const res = await this.call(step, method, path);
    return (await safeJson(res)) as T;
  }

  /** One admin REST call under realm `config.realm`. Resolves on 2xx; otherwise throws by status. */
  private async call(step: string, method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.config.url}/admin/realms/${enc(this.config.realm)}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
    } catch {
      throw new ProvisionError(step, null);
    }
    if (!res.ok) {
      discard(res);
      throw new ProvisionError(step, res.status);
    }
    return res;
  }
}

/**
 * Runs the step and returns the exit code. Never throws, and never prints a
 * caught error's own message unless the error is one of the two types above,
 * whose messages carry a step, a status and variable names only.
 */
export async function runProvision(deps: ProvisionDeps): Promise<number> {
  try {
    const refusals: string[] = [];
    const config = buildIdentityAdminConfig(deps.env, (message) => refusals.push(message));
    if (config === null) {
      throw new ProvisionRefusal(refusals.join(" "));
    }
    const username = deps.env.KEYCLOAK_ADMIN?.trim();
    const password = deps.env.KEYCLOAK_ADMIN_PASSWORD;
    if (!username || !password) {
      throw new ProvisionRefusal("KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD (the master-realm admin) must be set.");
    }
    return await new Provisioner(deps, config, { username, password }).run();
  } catch (err) {
    if (err instanceof ProvisionError || err instanceof ProvisionRefusal) {
      deps.err(`${PREFIX}: ${err.message}`);
    } else {
      // An unexpected error's message may quote what it failed on — a body,
      // a URL, a connection string. Its type is enough to start from.
      deps.err(`${PREFIX}: failed (${err instanceof Error ? err.name : typeof err})`);
    }
    return 1;
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

function roles(body: unknown): Role[] {
  if (!Array.isArray(body)) {
    return [];
  }
  return body
    .filter(
      (r): r is Role =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { id?: unknown }).id === "string" &&
        typeof (r as { name?: unknown }).name === "string",
    )
    .map(({ id, name }) => ({ id, name }));
}

function lastSegment(location: string | null): string | null {
  if (!location) {
    return null;
  }
  try {
    const last = new URL(location, "http://placeholder.invalid").pathname.split("/").filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/** Parses a 2xx body, or `null`; the parse error (which quotes its input) is swallowed whole. */
async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Releases a failure body without reading it. */
function discard(res: Response): void {
  res.body?.cancel().catch(() => undefined);
}

/** `bms.users (email, oidc_subject)` on `bms_auth` — `auth_bootstrap_read` is `USING (true)`. */
async function readUserRowsFrom(url: string): Promise<UserRowSummary[]> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const result = await pool.query<{ email: string; oidc_subject: string | null }>(
      "SELECT email, oidc_subject FROM bms.users",
    );
    return result.rows.map((row) => ({ email: row.email, subject: row.oidc_subject }));
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const authUrl = process.env.DATABASE_URL_AUTH?.trim();
  process.exitCode = await runProvision({
    env: process.env,
    fetch: globalThis.fetch.bind(globalThis),
    readUserRows: async () => {
      if (!authUrl) {
        throw new ProvisionRefusal("DATABASE_URL_AUTH must be set to read bms.users.");
      }
      try {
        return await readUserRowsFrom(authUrl);
      } catch {
        // pg's message can quote the connection string's host and user.
        throw new ProvisionRefusal("reading bms.users on DATABASE_URL_AUTH failed.");
      }
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}

if (require.main === module) {
  void main();
}
