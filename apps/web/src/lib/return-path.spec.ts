import { expect } from "vitest";

import {
  RETURN_PATH_KEY,
  peekReturnPath,
  rememberWallReturnPath,
  returnPathRefusal,
  safeReturnPath,
  takeReturnPath,
  type ReturnPathStorage,
} from "./return-path";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 8, plan D10) — the same-origin return
 * path kept for a wall URL across a 401 and the sign-in round trip.
 *
 * Assertions live here; `return-path.test.ts` is the Vitest entry point
 * (ADR 0014). The project runs `environment: "node"`, so every function takes
 * its storage and origin as arguments; `memoryStorage` stands in for
 * `sessionStorage`. Each refusal names the guard that fired
 * (`returnPathRefusal`), so a mutation that removes one guard reddens that
 * guard's own case and no other guard can hide it.
 */

const ORIGIN = "https://bms.example.test";
const WALL = "/control-room/site/x/sld?wall=1&every=30";

export function memoryStorage(seed: Record<string, string> = {}): ReturnPathStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** A storage whose every call throws, as Safari's private mode and a full quota do. */
function throwingStorage(): ReturnPathStorage {
  const fail = (): never => {
    throw new Error("SecurityError: storage is unavailable");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

/** R1 — a wall URL on this origin is accepted, path and query kept. */
export function acceptsASameOriginWallPath(): void {
  expect(returnPathRefusal(WALL, ORIGIN)).toBeNull();
  expect(safeReturnPath(WALL, ORIGIN)).toBe(WALL);
}

/** R2 — a fragment is dropped; only `pathname + search` is returned. */
export function dropsTheFragment(): void {
  expect(safeReturnPath(`${WALL}#top`, ORIGIN)).toBe(WALL);
}

/** R3 — an empty string, and a value that is not a string. */
export function refusesAnEmptyValue(): void {
  expect(returnPathRefusal("", ORIGIN)).toBe("empty");
  expect(returnPathRefusal(null, ORIGIN)).toBe("empty");
  expect(returnPathRefusal(42, ORIGIN)).toBe("empty");
  expect(safeReturnPath("", ORIGIN)).toBeNull();
}

/** R4 — an absolute URL and a script URL are not rooted paths. */
export function refusesAnAbsoluteOrScriptUrl(): void {
  expect(returnPathRefusal("https://evil.example", ORIGIN)).toBe("not-rooted");
  expect(returnPathRefusal("javascript:alert(1)", ORIGIN)).toBe("not-rooted");
  // `new URL` resolves this one onto the base's own origin; only the rooted check refuses it.
  expect(returnPathRefusal("https:/x", ORIGIN)).toBe("not-rooted");
  expect(safeReturnPath("javascript:alert(1)", ORIGIN)).toBeNull();
}

/** R5 — `//evil` is a protocol-relative URL to another host. */
export function refusesAProtocolRelativePath(): void {
  expect(returnPathRefusal("//evil.example", ORIGIN)).toBe("protocol-relative");
  expect(safeReturnPath("//evil.example", ORIGIN)).toBeNull();
}

/** R6 — a browser reads `\` as `/`, so `/\evil` is `//evil`. */
export function refusesABackslash(): void {
  expect(returnPathRefusal("/\\evil.example", ORIGIN)).toBe("backslash");
  expect(returnPathRefusal("/a\\b", ORIGIN)).toBe("backslash");
  expect(safeReturnPath("/\\evil.example", ORIGIN)).toBeNull();
}

/** R7 — a raw control character; the URL parser strips tab and newline, so it must run first. */
export function refusesARawControlCharacter(): void {
  expect(returnPathRefusal("/\t/evil.example", ORIGIN)).toBe("control");
  expect(returnPathRefusal("/x\r\nSet-Cookie: a=b", ORIGIN)).toBe("control");
  expect(returnPathRefusal("/x\u007f", ORIGIN)).toBe("control");
}

/** R8 — a percent-encoded control character, which `new URL` keeps encoded. */
export function refusesAnEncodedControlCharacter(): void {
  expect(returnPathRefusal("/x%0d", ORIGIN)).toBe("encoded-control");
  expect(returnPathRefusal("/x%0A", ORIGIN)).toBe("encoded-control");
  expect(returnPathRefusal("/x%7f", ORIGIN)).toBe("encoded-control");
  expect(safeReturnPath("/x%0d", ORIGIN)).toBeNull();
}

/** R9 — a path that normalises to `//host` is refused on the output, not the input. */
export function refusesAPathThatNormalisesToTwoSlashes(): void {
  expect(returnPathRefusal("/.//evil.example", ORIGIN)).toBe("normalised-protocol-relative");
  expect(returnPathRefusal("/%2e//evil.example", ORIGIN)).toBe("normalised-protocol-relative");
  expect(safeReturnPath("/.//evil.example", ORIGIN)).toBeNull();
}

/**
 * R10 — the origin check. No rooted, single-slash, backslash-free, control-free
 * string resolves to another origin, so this guard is defence in depth. What it
 * can still be shown to do is fail closed: a base that cannot parse a path
 * refuses, and an `origin` not in its serialised form (a trailing `/`) never
 * equals the parsed one, so it refuses rather than accepts.
 */
export function refusesAnotherOriginAfterParsing(): void {
  expect(returnPathRefusal("/x", "data:text/plain,a")).toBe("unparsable");
  expect(returnPathRefusal("/x", "https://other.example/")).toBe("cross-origin");
}

/** R11 — remember stores the wall URL. */
export function remembersAWallUrl(): void {
  const storage = memoryStorage();
  rememberWallReturnPath(
    { pathname: "/control-room/site/x/sld", search: "?wall=1&every=30" },
    ORIGIN,
    storage,
  );
  expect(storage.entries.get(RETURN_PATH_KEY)).toBe(WALL);
}

/** R12 — remember stores nothing off a wall URL. */
export function remembersNothingOffAWallUrl(): void {
  const storage = memoryStorage();
  rememberWallReturnPath({ pathname: "/control-room/site/x/sld", search: "?wall=yes" }, ORIGIN, storage);
  expect(storage.entries.has(RETURN_PATH_KEY)).toBe(false);
  rememberWallReturnPath({ pathname: "/alarms", search: "" }, ORIGIN, storage);
  expect(storage.entries.has(RETURN_PATH_KEY)).toBe(false);
}

/**
 * R12b — a later 401 off a wall URL keeps the stored path. A wall tab's
 * concurrent reads each get a 401, and the later ones land after the route
 * guard has moved the tab to `/login`.
 */
export function keepsAStoredPathOffAWallUrl(): void {
  const storage = memoryStorage({ [RETURN_PATH_KEY]: WALL });
  rememberWallReturnPath({ pathname: "/login", search: "" }, ORIGIN, storage);
  expect(storage.entries.get(RETURN_PATH_KEY)).toBe(WALL);
}

/** R13 — remember stores nothing for a wall URL the guard refuses. */
export function remembersNothingTheGuardRefuses(): void {
  const storage = memoryStorage();
  rememberWallReturnPath({ pathname: "/.//evil.example", search: "?wall=1" }, ORIGIN, storage);
  expect(storage.entries.has(RETURN_PATH_KEY)).toBe(false);
}

/** R14 — take returns the stored path once and removes the key. */
export function takeReturnsAndRemoves(): void {
  const storage = memoryStorage({ [RETURN_PATH_KEY]: WALL });
  expect(takeReturnPath(ORIGIN, storage)).toBe(WALL);
  expect(storage.entries.has(RETURN_PATH_KEY)).toBe(false);
  expect(takeReturnPath(ORIGIN, storage)).toBeNull();
}

/** R15 — take validates on read: a planted `//evil` comes back `null`, and the key is gone. */
export function takeRevalidatesOnRead(): void {
  const storage = memoryStorage({ [RETURN_PATH_KEY]: "//evil.example" });
  expect(takeReturnPath(ORIGIN, storage)).toBeNull();
  expect(storage.entries.has(RETURN_PATH_KEY)).toBe(false);
}

/** R16 — peek validates and keeps the key. */
export function peekValidatesAndKeeps(): void {
  const storage = memoryStorage({ [RETURN_PATH_KEY]: WALL });
  expect(peekReturnPath(ORIGIN, storage)).toBe(WALL);
  expect(storage.entries.get(RETURN_PATH_KEY)).toBe(WALL);
  const planted = memoryStorage({ [RETURN_PATH_KEY]: "//evil.example" });
  expect(peekReturnPath(ORIGIN, planted)).toBeNull();
}

/** R17 — storage that throws fails closed: nothing is returned and nothing throws. */
export function failsClosedWhenStorageThrows(): void {
  const storage = throwingStorage();
  expect(() =>
    rememberWallReturnPath({ pathname: "/a", search: "?wall=1" }, ORIGIN, storage),
  ).not.toThrow();
  expect(() =>
    rememberWallReturnPath({ pathname: "/a", search: "" }, ORIGIN, storage),
  ).not.toThrow();
  expect(peekReturnPath(ORIGIN, storage)).toBeNull();
  expect(takeReturnPath(ORIGIN, storage)).toBeNull();
}

/** R18 — with no storage at all (a node process, no `window`), every reader is `null`. */
export function readsNothingWithNoStorage(): void {
  expect(peekReturnPath(ORIGIN, null)).toBeNull();
  expect(takeReturnPath(ORIGIN, null)).toBeNull();
  expect(() =>
    rememberWallReturnPath({ pathname: "/a", search: "?wall=1" }, ORIGIN, null),
  ).not.toThrow();
}
