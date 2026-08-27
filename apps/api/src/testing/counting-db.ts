import type { BmsDb } from "@bms/db";

/**
 * `E7.1b` — wraps a `BmsDb` so every `.transaction(...)` call is counted, and
 * nothing else changes. It is the mechanism seam the conformed decision-1 LIST
 * reads are gated on: `withReadScope` opens a **tenant** transaction
 * (`withTenant`) for a single-organization actor and a **fleet** transaction for
 * an admin/multi-organization one, while the org-resolution step uses
 * `fleetDb.select` — not `.transaction`. So a single-org list must show exactly
 * one tenant-pool transaction and zero fleet-pool transactions; a revert of a
 * conformed read back to `this.fleetDb.select(...)` drops the tenant count to
 * zero and fails.
 *
 * Only the top-level `.transaction` is intercepted. Drizzle's query builders
 * (`.select`/`.insert`/…) return fresh builder objects, so they are untouched and
 * run normally against the real connection.
 */
export type CountingDb = { db: BmsDb; transactions: () => number };

export function countingDb(inner: BmsDb): CountingDb {
  let count = 0;
  const proxy = new Proxy(inner as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "transaction" && typeof value === "function") {
        return (...args: unknown[]) => {
          count += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as BmsDb;
  return { db: proxy, transactions: () => count };
}
