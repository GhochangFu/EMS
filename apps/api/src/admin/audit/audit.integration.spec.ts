import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { AUDIT_EXPORT_COLUMNS } from "./audit.serialise";
import type { AuditAdminService } from "./audit.service";

/**
 * `F4.14` — the ADR 0021 audit read API against a real database.
 *
 * The query contracts are proven by `audit.schema.spec.ts` and the escaping by
 * `audit.serialise.spec.ts`. Everything here is a rule no pure function can
 * express: the global-admin gate resolved from `bms.users`, the left join that
 * keeps actor-less rows, the `(created_at, id)` tie-break that makes offset
 * pagination stable, and that each filter actually narrows.
 *
 * **The fixtures are the point.** Following the `F4.10` note in
 * `docs/BACKLOG.md`, each row below exists so that a specific assertion *can*
 * fail: without a null-actor row the left join is indistinguishable from an
 * inner join, and without two rows sharing a timestamp the tie-break never
 * executes a single comparison.
 *
 * These tests write, so every row carries `TEST_ENTITY_TYPE` and is deleted
 * before and after the run — a crashed run must not poison the next one.
 */

/** Every row this suite creates carries this `entity_type`, and only these are deleted. */
export const TEST_ENTITY_TYPE = "f414_audit_fixture";

const ACTION_ALPHA = "F414-AUDIT-TEST.alpha";
const ACTION_BETA = "F414-AUDIT-TEST.beta";

/** Oldest fixture row. */
const T0 = "2026-08-01T00:00:00.000Z";
/** The actor-less row. */
const T1 = "2026-08-02T00:00:00.000Z";
/** Shared by two rows, so the `(created_at, id)` tie-break is exercised. */
const T2 = "2026-08-03T00:00:00.000Z";

export type Fixtures = {
  adminJwt: JwtPayload;
  locationAdminJwt: JwtPayload;
  /** Claims `admin` but has no `bms.users` row — see `assertGlobalAdminOnly`. */
  unprovisionedAdminJwt: JwtPayload;
  actorId: string;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
}

/** Deletes only this suite's rows. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.audit_log WHERE entity_type = $1`, [TEST_ENTITY_TYPE]);
}

export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.users WHERE email = 'admin@bms.local' LIMIT 1`,
  );
  const actor = rows[0];
  if (!actor) {
    throw new Error(
      "F4.14 fixtures missing — no admin@bms.local user. Run 'pnpm db:seed'; without a " +
        "real actor row the left join cannot be distinguished from an inner join.",
    );
  }
  return {
    actorId: actor.id,
    adminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "admin@bms.local",
      name: "integration:admin",
      role: "admin",
    },
    locationAdminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "wc-admin@bms.local",
      name: "integration:location-admin",
      role: "location_admin",
    },
    // Neither the id nor the email matches any `bms.users` row, so
    // `resolveDbUser` finds nothing. In OIDC mode this is an ordinary Keycloak
    // principal holding the realm role `admin` that nobody provisioned here.
    unprovisionedAdminJwt: {
      sub: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      email: "f414-unprovisioned@example.invalid",
      name: "integration:unprovisioned-admin",
      role: "admin",
    },
  };
}

/** Seeds four rows chosen so each assertion below has a way to fail. */
export async function seedRows(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const rows: [string, string | null, string, unknown][] = [
    [ACTION_ALPHA, fx.actorId, T0, { a: 1 }],
    // Actor-less: an inner join would silently drop this row.
    [ACTION_BETA, null, T1, null],
    // Two rows sharing T2 — without them the ORDER BY tie-break never runs.
    [ACTION_BETA, fx.actorId, T2, { b: 2 }],
    [ACTION_BETA, fx.actorId, T2, null],
  ];
  for (const [action, actorId, createdAt, payload] of rows) {
    await pool.query(
      `INSERT INTO bms.audit_log (actor_id, action, entity_type, entity_id, reason, payload, created_at)
       VALUES ($1, $2, $3, gen_random_uuid(), NULL, $4, $5)`,
      [actorId, action, TEST_ENTITY_TYPE, payload === null ? null : JSON.stringify(payload), createdAt],
    );
  }
}

const ALL_FIXTURES = { entityType: TEST_ENTITY_TYPE, limit: 50, offset: 0 } as const;

/** ADR 0021 decision 1 — only the unrestricted global admin may read. */
export async function assertGlobalAdminOnly(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const seen = await svc.list(fx.adminJwt, { ...ALL_FIXTURES });
  assert(seen.total === 4, `global admin sees the fixtures, got total ${seen.total}`);

  // `wc-admin@bms.local` is a real, provisioned user with grants — its
  // `writableOrganizationIds` is a non-null array, which is exactly the case
  // decision 1 excludes. A role check that only rejected unknown users would
  // pass a weaker test than this one.
  await expectRejection(
    () => svc.list(fx.locationAdminJwt, { ...ALL_FIXTURES }),
    /global admin/i,
    "location admin reading the audit log",
  );
  await expectRejection(
    () =>
      svc.export(fx.locationAdminJwt, {
        entityType: TEST_ENTITY_TYPE,
        from: T0,
        to: T2,
        format: "csv",
      }),
    /global admin/i,
    "location admin exporting the audit log",
  );

  // The case the provisioned negative above does NOT cover, and the one that
  // matters most: `resolveDbUser` falls back to the *claim* when no `bms.users`
  // row matches (`access-control.service.ts` — the row-absent branch), so an
  // unprovisioned principal claiming `admin` resolves to `role: "admin"` and
  // `writableOrganizationIds() === null`. Without an explicit provisioning
  // check this endpoint hands it the entire audit log, and deleting someone's
  // `bms.users` row would *escalate* rather than revoke them. Recorded against
  // `F4.10` in docs/BACKLOG.md as pre-existing; ADR 0021 made it load-bearing
  // by resting decision 1 solely on the `null` scope.
  await expectRejection(
    () => svc.list(fx.unprovisionedAdminJwt, { ...ALL_FIXTURES }),
    /provisioned account/i,
    "unprovisioned principal claiming admin reading the audit log",
  );
  await expectRejection(
    () =>
      svc.export(fx.unprovisionedAdminJwt, {
        entityType: TEST_ENTITY_TYPE,
        from: T0,
        to: T2,
        format: "csv",
      }),
    /provisioned account/i,
    "unprovisioned principal claiming admin exporting the audit log",
  );
}

/** The left join keeps rows whose actor could not be resolved. */
export async function assertActorlessRowSurvives(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const page = await svc.list(fx.adminJwt, { ...ALL_FIXTURES });
  const actorless = page.items.filter((item) => item.actorId === null);
  assert(
    actorless.length === 1,
    `expected exactly one actor-less fixture row, got ${actorless.length} — ` +
      "an inner join would report 0 here",
  );
  assert(actorless[0].actorEmail === null, "an actor-less row carries no email");

  const attributed = page.items.filter((item) => item.actorId !== null);
  assert(attributed.length === 3, "the other three rows are attributed");
  assert(
    attributed.every((item) => item.actorEmail === "admin@bms.local"),
    "attributed rows resolve their actor's email through the join",
  );
}

/** Newest first, with a tie-break that makes offset pagination stable. */
export async function assertOrderingIsStable(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const page = await svc.list(fx.adminJwt, { ...ALL_FIXTURES });
  const times = page.items.map((item) => item.createdAt);
  assert(times[0] === T2 && times[1] === T2, "the two newest rows share T2");
  assert(times[2] === T1, "then the actor-less row");
  assert(times[3] === T0, "then the oldest");

  // The tie-break's whole purpose: paging one row at a time across the T2 pair
  // must not repeat or skip either of them.
  const first = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, limit: 1, offset: 0 });
  const second = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, limit: 1, offset: 1 });
  assert(first.items.length === 1 && second.items.length === 1, "one row per page");
  assert(
    first.items[0].id !== second.items[0].id,
    "consecutive pages over equal timestamps return different rows",
  );
  assert(
    first.total === 4 && second.total === 4,
    "`total` counts every match, not just the page",
  );
}

/** Each filter narrows, and the time window excludes rather than reorders. */
export async function assertFiltersNarrow(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const beta = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, action: ACTION_BETA });
  assert(beta.total === 3, `action filter narrows to 3, got ${beta.total}`);
  assert(
    beta.items.every((item) => item.action === ACTION_BETA),
    "no non-matching action leaks through",
  );

  const alpha = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, action: ACTION_ALPHA });
  assert(alpha.total === 1, "the other action matches exactly one row");

  const windowed = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, from: T1, to: T2 });
  assert(windowed.total === 3, `window T1..T2 excludes the T0 row, got ${windowed.total}`);

  const byActor = await svc.list(fx.adminJwt, { ...ALL_FIXTURES, actorId: fx.actorId });
  assert(byActor.total === 3, "the actor filter excludes the actor-less row");

  const byEntity = await svc.list(fx.adminJwt, {
    ...ALL_FIXTURES,
    entityId: alpha.items[0].entityId ?? undefined,
  });
  assert(byEntity.total === 1, "the entity filter isolates one row");
}

/** Export carries the header, honours filters, and names the file by window. */
export async function assertExportShape(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const csv = await svc.export(fx.adminJwt, {
    entityType: TEST_ENTITY_TYPE,
    from: T0,
    to: T2,
    format: "csv",
  });
  assert(csv.contentType.startsWith("text/csv"), "csv content type");
  assert(csv.filename === "audit-2026-08-01.csv", `filename stamps the window start, got ${csv.filename}`);
  const body = String(csv.body).trim().split("\n");
  assert(body[0] === AUDIT_EXPORT_COLUMNS.join(","), "header row leads the file");
  assert(body.length === 5, `header plus four fixture rows, got ${body.length}`);

  const narrowed = await svc.export(fx.adminJwt, {
    entityType: TEST_ENTITY_TYPE,
    action: ACTION_ALPHA,
    from: T0,
    to: T2,
    format: "csv",
  });
  assert(
    String(narrowed.body).trim().split("\n").length === 2,
    "export applies the same filters as the list",
  );

  const xlsx = await svc.export(fx.adminJwt, {
    entityType: TEST_ENTITY_TYPE,
    from: T0,
    to: T2,
    format: "xlsx",
  });
  assert(Buffer.isBuffer(xlsx.body), "xlsx export is a buffer");
  assert(xlsx.filename.endsWith(".xlsx"), "xlsx filename extension");
}
