/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 8, plan D10) — the same-origin return
 * path a wall display goes back to after its session ends and someone signs in
 * again.
 *
 * `clearSessionOnAuthFailure` (`api/http.ts`) calls `rememberWallReturnPath`
 * on a 401 before it clears the session, and so do `App`'s two session effects
 * (`app.tsx`: a stored token that has expired, and a `/me` read that fails) —
 * a wall tab reloaded with a dead session; the route guard then sends the tab to
 * `/login` as before. The login page shows the "Session ended" banner while a
 * path is stored (`peekReturnPath`), and both login pages navigate to
 * `takeReturnPath() ?? "/"`. `sessionStorage` is per tab and survives the
 * Keycloak round trip (`/auth/callback` lands in the same tab), so `oidc.ts`
 * needs no change.
 *
 * Only this module writes the key, and only for a URL whose `wall` parameter
 * is exactly `"1"` — the same rule as wall mode's own `parseWallParams`. There
 * is no `?return=` query parameter. The guard is defence in depth all the same:
 * it validates on write **and** on every read, so a value planted in storage by
 * anything else is refused.
 *
 * **The guard.** `returnPathRefusal` names the first rule a value breaks, so a
 * test can hold each rule on its own case; `safeReturnPath` is its accepting
 * half and returns `pathname + search` (no fragment). The order matters:
 *
 * 1. A non-empty string.
 * 2. No raw control character — checked **before** parsing, because the URL
 *    parser strips tab and newline, so `"/\t/evil"` parses as `//evil`.
 * 3. No percent-encoded control character (`%00`–`%1f`, `%7f`): the parser
 *    keeps `/x%0d` encoded, so rule 2 cannot see it.
 * 4. Starts with `/` (refuses `https://…`, `javascript:…`, and `https:/x`,
 *    which the parser would otherwise resolve onto this origin).
 * 5. The second character is not `/` (refuses protocol-relative `//evil`).
 * 6. No `\` anywhere — a browser reads it as `/`, so `/\evil` is `//evil`.
 * 7. `new URL(value, origin)` parses and its origin equals `origin` exactly.
 *    Rules 1–6 leave no string that resolves elsewhere, so this rule is the
 *    backstop; it fails closed on an unparsable base or an `origin` that is not
 *    in its serialised form.
 * 8. The **output** does not start with `//`: `/.//evil` and `/%2e//evil`
 *    normalise to the pathname `//evil`.
 *
 * Every storage access is wrapped: a storage that throws (private mode, a full
 * quota, no `window` in a node process) stores and returns nothing.
 */

/** The `sessionStorage` key; `bms-` like the other client keys. */
export const RETURN_PATH_KEY = "bms-return-path";

/** The three `Storage` methods this module uses — `sessionStorage`, or a test double. */
export type ReturnPathStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The rule a refused value broke; `null` from `returnPathRefusal` means accepted. */
export type ReturnPathRefusal =
  | "empty"
  | "control"
  | "encoded-control"
  | "not-rooted"
  | "protocol-relative"
  | "backslash"
  | "unparsable"
  | "cross-origin"
  | "normalised-protocol-relative";

/** C0 controls and DEL. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
/** The same, percent-encoded, either case. */
const ENCODED_CONTROL_CHARACTER = /%(?:[01][0-9a-f]|7f)/i;

/** Parses `value` against `origin`; `null` when it does not parse. */
function parse(value: string, origin: string): URL | null {
  try {
    return new URL(value, origin);
  } catch {
    return null;
  }
}

/** The first rule `value` breaks as a return path on `origin`, or `null` when it is safe. */
export function returnPathRefusal(value: unknown, origin: string): ReturnPathRefusal | null {
  if (typeof value !== "string" || value.length === 0) {
    return "empty";
  }
  if (CONTROL_CHARACTER.test(value)) {
    return "control";
  }
  if (ENCODED_CONTROL_CHARACTER.test(value)) {
    return "encoded-control";
  }
  if (!value.startsWith("/")) {
    return "not-rooted";
  }
  if (value.startsWith("//")) {
    return "protocol-relative";
  }
  if (value.includes("\\")) {
    return "backslash";
  }
  const url = parse(value, origin);
  if (url === null) {
    return "unparsable";
  }
  if (url.origin !== origin) {
    return "cross-origin";
  }
  if (url.pathname.startsWith("//")) {
    return "normalised-protocol-relative";
  }
  return null;
}

/** `value` as a same-origin `pathname + search`, or `null` when any rule refuses it. */
export function safeReturnPath(value: unknown, origin: string): string | null {
  if (returnPathRefusal(value, origin) !== null) {
    return null;
  }
  const url = parse(value as string, origin) as URL;
  return `${url.pathname}${url.search}`;
}

/** This tab's origin, or `null` in a process with no `window`. */
function currentOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

/** This tab's `sessionStorage`, or `null` when there is none or reading it throws. */
function currentStorage(): ReturnPathStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Stores `location`'s path and query when it is a wall URL (`wall` exactly
 * `"1"`) the guard accepts; otherwise does nothing. It never removes: a wall
 * tab with several reads in flight gets one 401 per read, and the later ones
 * arrive after the route guard has moved the tab to `/login` — removing there
 * would drop the path the first 401 kept. The key is spent only by
 * `takeReturnPath`, on sign-in. Never throws.
 */
export function rememberWallReturnPath(
  location: { readonly pathname: string; readonly search: string },
  origin: string | null = currentOrigin(),
  storage: ReturnPathStorage | null = currentStorage(),
): void {
  if (storage === null) {
    return;
  }
  try {
    const isWall = new URLSearchParams(location.search).get("wall") === "1";
    const path = isWall && origin !== null
      ? safeReturnPath(`${location.pathname}${location.search}`, origin)
      : null;
    if (path !== null) {
      storage.setItem(RETURN_PATH_KEY, path);
    }
  } catch {
    // Fail closed: a storage that refuses leaves the user on the default landing.
  }
}

function readStored(storage: ReturnPathStorage, origin: string | null, remove: boolean): string | null {
  try {
    const raw = storage.getItem(RETURN_PATH_KEY);
    if (remove) {
      storage.removeItem(RETURN_PATH_KEY);
    }
    return origin === null ? null : safeReturnPath(raw, origin);
  } catch {
    return null;
  }
}

/** The stored return path, validated, **without** removing it — for the banner. */
export function peekReturnPath(
  origin: string | null = currentOrigin(),
  storage: ReturnPathStorage | null = currentStorage(),
): string | null {
  return storage === null ? null : readStored(storage, origin, false);
}

/** The stored return path, validated on read; the key is removed either way. */
export function takeReturnPath(
  origin: string | null = currentOrigin(),
  storage: ReturnPathStorage | null = currentStorage(),
): string | null {
  return storage === null ? null : readStored(storage, origin, true);
}
