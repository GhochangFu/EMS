import { Logger } from "@nestjs/common";
import type { UserRole } from "@bms/shared";

import { KEYCLOAK_REQUEST_TIMEOUT_MS, type IdentityAdminConfig } from "./identity-admin.config";

/**
 * `F3.78` (ADR 0089 decision 5) — the Keycloak admin REST calls the users API
 * makes, over plain `fetch` with a client-credentials token.
 *
 * **The secret is equivalent to global admin**, because `manage-users` can set
 * any realm user's password. So three rules hold in every path below:
 *
 * - **No body is ever read on a failure.** A non-2xx response is mapped by its
 *   status alone ({@link mapKeycloakFailure}) and its body is cancelled
 *   unread: Keycloak's `error_description` echoes request detail, and a body
 *   that is never read cannot reach a message or a log line.
 * - **`IdentityAdminError` carries a closed `reason` and the status, nothing
 *   else** — no body, no `cause`, no email. U5 matches it by `name`.
 * - **Logging is status codes and Keycloak user ids.** Never a request body
 *   (it holds the password or the secret), never a response body.
 *
 * **`createUser` reads the new id from `Location` and only from there.** A
 * fallback search by username would return whichever account holds that name
 * — after a race or a manual edit, someone else's — and the compensating
 * delete in U5 would then remove the wrong user.
 *
 * **`setRealmRole` touches only the six BMS role names.** A user also carries
 * `default-roles-bms` (which bundles `offline_access` and
 * `uma_authorization`); deleting every mapping would strip those too. It
 * removes before it adds, so a failure between the two leaves a user with no
 * BMS role (fail closed) rather than two.
 *
 * **Every request is bounded** by `requestTimeoutMs` (default
 * {@link KEYCLOAK_REQUEST_TIMEOUT_MS}): `fetch` gets an `AbortSignal.timeout`
 * and the call also races that signal, so even a transport that ignores the
 * signal fails as `unavailable` on time. The log line names the operation and
 * the timeout, never the URL.
 */

/** The fixed set of reasons a Keycloak failure is reported as. */
export type IdentityAdminFailureReason =
  | "not_configured"
  | "unauthorized_client"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "unavailable"
  | "unexpected_response";

export class IdentityAdminError extends Error {
  override readonly name = "IdentityAdminError";

  constructor(
    readonly reason: IdentityAdminFailureReason,
    readonly status: number | null = null,
  ) {
    super(
      status === null
        ? `Keycloak admin call failed: ${reason}`
        : `Keycloak admin call failed: ${reason} (HTTP ${status})`,
    );
  }
}

/**
 * Status → reason. Exported so the provisioning CLI (U4) maps the same way and
 * logs the same way: the status, never the body.
 */
export function mapKeycloakFailure(status: number): IdentityAdminFailureReason {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized_client";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 500 && status <= 599) return "unavailable";
  return "unexpected_response";
}

/** The realm roles that ARE the BMS role (ADR 0003). Every other mapping is left alone. */
export const BMS_REALM_ROLES = [
  "admin",
  "organization_admin",
  "location_admin",
  "asset_group_admin",
  "operator",
  "viewer",
] as const satisfies readonly UserRole[];

/**
 * Compile-time check that the list above is every `UserRole`. The root of
 * `@bms/shared` exports the role schema as a type only, so the list cannot be
 * derived from it at runtime; a seventh role would fail to compile here.
 */
type MissingRealmRole = Exclude<UserRole, (typeof BMS_REALM_ROLES)[number]>;
const realmRolesAreExhaustive: [MissingRealmRole] extends [never] ? true : never = true;
void realmRolesAreExhaustive;

export type NewIdentityUser = { readonly email: string; readonly displayName: string };

/** What the users API needs from the identity provider. */
export interface IdentityAdmin {
  /** Creates a disabled account with a verified, lower-cased email; returns Keycloak's id. */
  createUser(user: NewIdentityUser): Promise<{ id: string }>;
  /** Sets a password Keycloak makes the user change at the next sign-in. */
  setTemporaryPassword(id: string, password: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Leaves exactly one BMS realm role mapped; other realm roles are untouched. */
  setRealmRole(id: string, role: UserRole): Promise<void>;
  /** Ends every Keycloak session of the user. */
  logoutSessions(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
}

export type IdentityAdminLogger = {
  log(message: string): void;
  warn(message: string): void;
};

/** A token is dropped this long before Keycloak says it expires. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

type RoleRepresentation = { id: string; name: string };

export class KeycloakIdentityAdminClient implements IdentityAdmin {
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly logger: IdentityAdminLogger;
  private readonly requestTimeoutMs: number;
  private token: { value: string; refreshAt: number } | null = null;

  constructor(
    private readonly deps: {
      config: IdentityAdminConfig;
      fetch?: typeof globalThis.fetch;
      now?: () => number;
      logger?: IdentityAdminLogger;
      requestTimeoutMs?: number;
    },
  ) {
    // Bound: `fetch` throws "Illegal invocation" when called detached.
    this.fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? new Logger(KeycloakIdentityAdminClient.name);
    this.requestTimeoutMs = deps.requestTimeoutMs ?? KEYCLOAK_REQUEST_TIMEOUT_MS;
  }

  async createUser(user: NewIdentityUser): Promise<{ id: string }> {
    const email = user.email.toLowerCase();
    const res = await this.admin("createUser", "POST", "/users", {
      body: {
        username: email,
        email,
        firstName: user.displayName,
        enabled: false,
        emailVerified: true,
      },
    });
    const id = idFromLocation(res.headers.get("location"));
    if (id === null) {
      this.logger.warn(`Keycloak admin createUser: HTTP ${res.status} with no usable Location header`);
      throw new IdentityAdminError("unexpected_response", res.status);
    }
    this.logger.log(`Keycloak admin createUser: created user ${id}`);
    return { id };
  }

  async setTemporaryPassword(id: string, password: string): Promise<void> {
    await this.admin("setTemporaryPassword", "PUT", `/users/${enc(id)}/reset-password`, {
      userId: id,
      body: { type: "password", value: password, temporary: true },
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.admin("setEnabled", "PUT", `/users/${enc(id)}`, { userId: id, body: { enabled } });
  }

  async setRealmRole(id: string, role: UserRole): Promise<void> {
    const path = `/users/${enc(id)}/role-mappings/realm`;
    const mapped = await this.readRoles("setRealmRole", path, id);
    const available = await this.readRoles("setRealmRole", `${path}/available`, id);

    const bmsNames: readonly string[] = BMS_REALM_ROLES;
    const toRemove = mapped.filter((r) => bmsNames.includes(r.name) && r.name !== role);
    const alreadyMapped = mapped.some((r) => r.name === role);
    const toAdd = alreadyMapped ? null : available.find((r) => r.name === role);

    // Refuse before mutating: a role that cannot be added must not cost the
    // user the one it has.
    if (toAdd === undefined) {
      this.logger.warn(`Keycloak admin setRealmRole: role ${role} is not available for user ${id}`);
      throw new IdentityAdminError("not_found");
    }

    if (toRemove.length > 0) {
      await this.admin("setRealmRole", "DELETE", path, {
        userId: id,
        body: toRemove.map(({ id: roleId, name }) => ({ id: roleId, name })),
      });
    }
    if (toAdd !== null) {
      await this.admin("setRealmRole", "POST", path, {
        userId: id,
        body: [{ id: toAdd.id, name: toAdd.name }],
      });
    }
  }

  async logoutSessions(id: string): Promise<void> {
    await this.admin("logoutSessions", "POST", `/users/${enc(id)}/logout`, { userId: id });
  }

  async deleteUser(id: string): Promise<void> {
    await this.admin("deleteUser", "DELETE", `/users/${enc(id)}`, { userId: id });
  }

  // --- transport -----------------------------------------------------------

  private async readRoles(op: string, path: string, userId: string): Promise<RoleRepresentation[]> {
    const res = await this.admin(op, "GET", path, { userId });
    const parsed = await safeJson(res);
    if (!Array.isArray(parsed)) {
      this.logger.warn(`Keycloak admin ${op}: HTTP ${res.status} with an unreadable role list for user ${userId}`);
      throw new IdentityAdminError("unexpected_response", res.status);
    }
    return parsed.filter(
      (r): r is RoleRepresentation =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { id?: unknown }).id === "string" &&
        typeof (r as { name?: unknown }).name === "string",
    );
  }

  /** One admin REST call. Resolves on 2xx; otherwise logs the status and throws. */
  private async admin(
    op: string,
    method: string,
    path: string,
    opts: { userId?: string; body?: unknown } = {},
  ): Promise<Response> {
    const token = await this.accessToken();
    const { config } = this.deps;
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const res = await this.send(op, `${config.url}/admin/realms/${enc(config.realm)}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      redirect: "manual",
    });
    if (res.ok) {
      return res;
    }
    if (res.status === 401) {
      this.token = null;
    }
    discard(res);
    const reason = mapKeycloakFailure(res.status);
    this.logger.warn(
      `Keycloak admin ${op} failed: HTTP ${res.status} (${reason})` +
        (opts.userId === undefined ? "" : ` for user ${opts.userId}`),
    );
    throw new IdentityAdminError(reason, res.status);
  }

  private async accessToken(): Promise<string> {
    if (this.token !== null && this.now() < this.token.refreshAt) {
      return this.token.value;
    }
    const { config } = this.deps;
    const res = await this.send(
      "token",
      `${config.url}/realms/${enc(config.realm)}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }).toString(),
        redirect: "manual",
      },
    );
    if (!res.ok) {
      discard(res);
      const reason = mapKeycloakFailure(res.status);
      this.logger.warn(`Keycloak admin token request failed: HTTP ${res.status} (${reason})`);
      throw new IdentityAdminError(reason, res.status);
    }
    const parsed = (await safeJson(res)) as { access_token?: unknown; expires_in?: unknown } | null;
    const value = parsed?.access_token;
    const expiresIn = parsed?.expires_in;
    if (typeof value !== "string" || value === "" || typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
      this.logger.warn(`Keycloak admin token request: HTTP ${res.status} with an unreadable token`);
      throw new IdentityAdminError("unexpected_response", res.status);
    }
    this.token = { value, refreshAt: this.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS };
    return value;
  }

  /**
   * `fetch`, bounded by `requestTimeoutMs`, with a network failure or a
   * timeout mapped to a fixed reason — its message is never forwarded.
   */
  private async send(op: string, url: string, init: RequestInit): Promise<Response> {
    const signal = AbortSignal.timeout(this.requestTimeoutMs);
    const timedOut = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    try {
      return await Promise.race([this.fetch(url, { ...init, signal }), timedOut]);
    } catch {
      if (signal.aborted) {
        this.logger.warn(`Keycloak admin ${op} failed: no response within ${this.requestTimeoutMs} ms (unavailable)`);
      } else {
        this.logger.warn(`Keycloak admin ${op} failed: no response (unavailable)`);
      }
      throw new IdentityAdminError("unavailable");
    }
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

/** The last path segment of `Location`, or `null` when there is none. */
function idFromLocation(location: string | null): string | null {
  if (!location) {
    return null;
  }
  try {
    const pathname = new URL(location, "http://placeholder.invalid").pathname;
    const last = pathname.split("/").filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/**
 * Parses a 2xx body, or `null`. The parse error is swallowed whole: Node's
 * `SyntaxError` quotes the input it failed on, which would put the body in a
 * message.
 */
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
