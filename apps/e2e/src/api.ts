import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertLocalBaseUrl } from "./base-url.js";

/**
 * ADR 0100 decision 6 — the API helpers every spec and the global setup share.
 *
 * Paths resolve from this file, never from the cwd, so a spec's
 * `storageState: authFile("admin")` means the same file however Playwright
 * was started.
 */
export const E2E_DIR: string = fileURLToPath(new URL("..", import.meta.url));
export const REPO_ROOT: string = fileURLToPath(new URL("../../..", import.meta.url));
export const AUTH_DIR: string = join(E2E_DIR, ".auth");
export const FIXTURES_FILE: string = join(AUTH_DIR, "fixtures.json");

/** The web origin. `storageState` origins must equal it exactly. */
export const BASE_URL: string = assertLocalBaseUrl(
  process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
).origin;
/** The API, run from source by the Playwright `webServer`. */
export const API_URL: string = assertLocalBaseUrl(
  process.env.E2E_API_URL ?? "http://127.0.0.1:4000",
).origin;

/** The four seeded logins (`packages/db/src/demo-users-seed.ts`), password `admin123`. */
export const ROLES = {
  admin: "admin@bms.local",
  "phe-admin": "phe-admin@bms.local",
  "wc-admin": "wc-admin@bms.local",
  "wc-hvac-admin": "wc-hvac-admin@bms.local",
} as const;
export type Role = keyof typeof ROLES;
export const DEMO_PASSWORD = "admin123";

/** The `storageState` file of one seeded role, as an absolute path. */
export function authFile(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}

/** The seeded ids the global setup resolves once per run. */
export type Fixtures = {
  readonly wcLocationId: string;
  readonly gautengLocationId: string;
  readonly crMainBusAssetId: string;
  readonly eskomOrganizationId: string;
};

/** The fixture ids the global setup wrote to `.auth/fixtures.json`. */
export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
}

export class E2eApiError extends Error {
  override readonly name = "E2eApiError";
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} answered ${status}: ${body.slice(0, 500)}`);
  }
}

async function request(method: string, path: string, token: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectOk<T>(method: string, path: string, res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new E2eApiError(method, path, res.status, text);
  return (text === "" ? null : JSON.parse(text)) as T;
}

/** GET that throws `E2eApiError` with the status unless the answer is 2xx. */
export async function apiGet<T>(path: string, token: string): Promise<T> {
  return expectOk<T>("GET", path, await request("GET", path, token));
}

/** POST that throws `E2eApiError` with the status unless the answer is 2xx. */
export async function apiPost<T>(path: string, token: string, body?: unknown): Promise<T> {
  return expectOk<T>("POST", path, await request("POST", path, token, body ?? {}));
}

/** The raw status of a GET, for a spec that asserts a refusal (403, 404). */
export async function apiStatus(path: string, token: string): Promise<number> {
  const res = await request("GET", path, token);
  await res.text();
  return res.status;
}

type LoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: { id: string; email: string; displayName: string; role: string };
};
type MeResponse = { user: LoginResponse["user"]; scope: unknown };

export type Session = { accessToken: string; user: MeResponse["user"]; scope: unknown };

/** `POST /auth/login` then `GET /auth/me`, the same two calls the login page makes. */
export async function login(role: Role): Promise<Session> {
  const path = "/api/v1/auth/login";
  const res = await request("POST", path, null, { email: ROLES[role], password: DEMO_PASSWORD });
  const { accessToken } = await expectOk<LoginResponse>("POST", path, res);
  const me = await apiGet<MeResponse>("/api/v1/auth/me", accessToken);
  return { accessToken, user: me.user, scope: me.scope };
}

export type StorageState = {
  cookies: never[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
};

/**
 * The `bms-auth` entry zustand's `persist` writes (`apps/web/src/stores/auth-store.ts`):
 * the four `partialize` keys under `state`, at store version 0.
 */
export function storageStateFor(session: Session): StorageState {
  const value = JSON.stringify({
    state: { accessToken: session.accessToken, oidcIdToken: null, user: session.user, scope: session.scope },
    version: 0,
  });
  return { cookies: [], origins: [{ origin: BASE_URL, localStorage: [{ name: "bms-auth", value }] }] };
}

/** The bearer token a saved `storageState` file carries, for a spec's API cross-check. */
export function tokenFromStorageState(path: string): string {
  const state = JSON.parse(readFileSync(path, "utf8")) as StorageState;
  const entry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === "bms-auth");
  if (entry === undefined) throw new Error(`${path} has no bms-auth localStorage entry`);
  const token = (JSON.parse(entry.value) as { state?: { accessToken?: unknown } }).state?.accessToken;
  if (typeof token !== "string" || token === "") throw new Error(`${path} has no accessToken`);
  return token;
}
