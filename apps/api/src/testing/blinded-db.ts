import type { BmsDb } from "@bms/db";

/**
 * `F3.54` — a real `BmsDb` with **one** `select` projection made to throw.
 *
 * ## Why this exists
 *
 * Two exits in `NotificationsService.dispatchToChannel` fire only when a *read*
 * throws: the ledger read (ADR 0057 plan D3) and the rate-limit read (its
 * security review H1). ADR 0057 Amendment 4 changed what each of them writes for
 * a `cleared` message, and the claim worth holding is that the row reaches
 * `bms.notification_deliveries` — against the real status CHECK, the real
 * `organization_id NOT NULL` and the real `alarm_id` foreign key, none of which
 * a hand-written fake has.
 *
 * Inducing a read failure against a live database means revoking a grant or
 * terminating a backend, on a role and a database other suites are using. This
 * is the cheaper induction, and it is sound for a reason the code already
 * relies on: **the four SELECTs in that service are told apart by their
 * projection** — and `blindedReads()` below turns that from a claim into a
 * gate — `{allSent, reservedSent}` is the hourly ceiling, `{id}` the raise-path skip
 * read, `{status}` the event ledger read, `{channelId}` the cleared
 * recipients — and those four shapes are disjoint. `notifications.service.
 * spec.ts`'s fake dispatches on exactly the same key. So blinding one shape
 * fails one read and nothing else.
 *
 * **Everything that is not that one `select` goes to the real database**, the
 * INSERT included. The write path under test is never simulated.
 *
 * ## Two implementation notes, both load-bearing
 *
 * Every non-`select` member is bound to the **target**, never to the proxy. A
 * drizzle database reaches its own `#private` fields, and a `#private` read
 * with the proxy as `this` throws `TypeError` rather than forwarding.
 *
 * The blinded builder answers every property with itself and rejects when
 * awaited, so it does not need to know the shape of the chain it is standing
 * in for — `.from().where().limit()` and `.from().where()` both work.
 */
export function dbBlindTo(db: BmsDb, blindedShape: string): BlindedDb {
  const reason = `blinded-db: the select({ ${blindedShape} }) read is made to throw`;
  const realSelect = (db as unknown as { select: (p?: unknown) => unknown }).select.bind(db);
  let blinded = 0;

  const proxy = new Proxy(db as object, {
    get(target, prop): unknown {
      if (prop === "select") {
        return (projection?: Record<string, unknown>) => {
          if (shapeOf(projection) !== blindedShape) return realSelect(projection);
          blinded += 1;
          return rejectingBuilder(reason);
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as BmsDb;

  return { db: proxy, blindedReads: () => blinded };
}

/**
 * The proxied database, and **how many reads it actually blinded**.
 *
 * The count is not a convenience: it is what makes the disjointness claim in
 * the header a gate rather than a sentence. A caller asserts the number it
 * expects, so a fifth `select` of the same shape appearing in the service under
 * test — which would blind two reads and quietly change what the caller is
 * proving — fails the assertion instead of passing under a stale comment.
 *
 * A shape that matches nothing needs no separate guard: the read then succeeds,
 * and the caller's own positive assertion about the refusal goes red.
 */
export type BlindedDb = { db: BmsDb; blindedReads: () => number };

/** A projection's identity: its keys, sorted, comma-joined. `""` for `select()`. */
function shapeOf(projection?: Record<string, unknown>): string {
  return projection === undefined ? "" : Object.keys(projection).sort().join(",");
}

/** A query builder that accepts any chain and rejects when awaited. */
function rejectingBuilder(reason: string): unknown {
  const error = new Error(reason);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (prop === "then") {
          return (_resolve: unknown, reject: (err: unknown) => void) => {
            reject(error);
          };
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}
