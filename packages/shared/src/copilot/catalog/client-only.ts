/**
 * `F4.279` (ADR 0099 Amendment 8, Q12) — a catalog entry's `clientOnly` names
 * either a top-level body key (`secret`) or a dotted path to a nested one
 * (`config.url`). The user types each on the Confirm card; the model never
 * sees it, and the stored hash leaves it out.
 *
 * One helper for both sides, so they cannot drift: the API's `bodyHash` strips
 * the paths with {@link withoutPaths}, and the web's Confirm request sets the
 * typed values with {@link withPaths}. Any body that is not a plain object is
 * returned as it is.
 */

import { cloneJson } from "../../stack-safe-json";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A deep copy of `body` without each top-level key or dotted path. An absent path is a no-op. */
export function withoutPaths(body: unknown, paths: readonly string[]): unknown {
  if (paths.length === 0 || !isObject(body)) return body;
  const out = cloneJson(body);
  for (const path of paths) {
    const keys = path.split(".");
    const last = keys.pop() as string;
    let node: unknown = out;
    for (const key of keys) node = isObject(node) ? node[key] : undefined;
    if (isObject(node)) delete node[last];
  }
  return out;
}

/**
 * A deep copy of `body` with each typed value set at its path, creating the
 * object on the way. A blank value is **not** set: an untyped optional field
 * (a webhook secret on an update) is omitted, so the route keeps what it stored.
 */
export function withPaths(body: unknown, values: Readonly<Record<string, string>>): unknown {
  if (!isObject(body)) return body;
  const out = cloneJson(body);
  for (const [path, value] of Object.entries(values)) {
    if (value === "") continue;
    const keys = path.split(".");
    const last = keys.pop() as string;
    let node: Json = out;
    for (const key of keys) {
      const next = node[key];
      if (!isObject(next)) node[key] = {};
      node = node[key] as Json;
    }
    node[last] = value;
  }
  return out;
}
