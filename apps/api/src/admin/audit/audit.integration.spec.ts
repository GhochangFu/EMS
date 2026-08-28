import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { AUDIT_EXPORT_COLUMNS } from "./audit.serialise";
import type { AuditAdminService } from "./audit.service";

/**
 * `F4.14` — the ADR 0021 audit read API against a real database, widened by
 * `E7.1e` / ADR 0046.
 *
 * The query contracts are proven by `audit.schema.spec.ts` and the escaping by
 * `audit.serialise.spec.ts`. Everything here is a rule no pure function can
 * express: the read gate resolved from `bms.users`, the organization scope it
 * returns, the left join that keeps actor-less rows, the `(created_at, id)`
 * tie-break that makes offset pagination stable, and that each filter actually
 * narrows.
 *
 * **The fixtures are the point.** Following the `F4.10` note in
 * `docs/BACKLOG.md`, each row below exists so that a specific assertion *can*
 * fail: without a null-actor row the left join is indistinguishable from an
 * inner join, without two rows sharing a timestamp the tie-break never executes
 * a single comparison, and without a **foreign-organization** row the scope
 * assertion would pass against a reader that filtered nothing but `NULL`.
 *
 * The `E7.1e` rows live under their own `entity_type` on purpose. Folding them
 * into `TEST_ENTITY_TYPE` would move the `total === 4` counts and the T0/T1/T2
 * ordering expectations below, which is how a new feature quietly dissolves the
 * regression value of the suite it joins.
 *
 * These tests write, so every row carries one of the two fixture entity types
 * and is deleted before and after the run — a crashed run must not poison the
 * next one. `E7.1e` also creates one `bms.users` row, deleted the same way.
 */

/** Every `F4.14` row this suite creates carries this `entity_type`. */
export const TEST_ENTITY_TYPE = "f414_audit_fixture";

/** Every `E7.1e` organization-scope row carries this one. All four are org-stamped or deliberately NULL. */
export const TEST_ORG_ENTITY_TYPE = "e71e_audit_org_fixture";

const ACTION_ALPHA = "F414-AUDIT-TEST.alpha";
const ACTION_BETA = "F414-AUDIT-TEST.beta";

/** Stamped with the org admin's own organization (PHEWB). */
const ACTION_OWN = "E71E-AUDIT-TEST.own";
/** Stamped with a different organization (ESKOM) — the cross-tenant negative. */
const ACTION_FOREIGN = "E71E-AUDIT-TEST.foreign";
/** `organization_id IS NULL` — a platform event under ADR 0043 decision 5. */
const ACTION_PLATFORM = "E71E-AUDIT-TEST.platform";

/**
 * An `organization_admin` with a `bms.users` row and **no**
 * `user_organization_access` grant. `writableOrganizationIds` returns `[]` for
 * it, which §4.7 forbids treating as the unrestricted `null`.
 *
 * Per-run identity, following `multi-org-scope.rls.integration.test.ts`:
 * `bms.users.email` is UNIQUE, so a fixed address collides between two
 * developers sharing one database.
 */
const GRANTLESS_ORG_ADMIN_EMAIL = `e71e-grantless-${randomUUID()
  .replace(/-/g, "")
  .slice(0, 12)}@bms.local`;

/** Oldest fixture row. */
const T0 = "2026-08-01T00:00:00.000Z";
/** The actor-less row. */
const T1 = "2026-08-02T00:00:00.000Z";
/** Shared by two rows, so the `(created_at, id)` tie-break is exercised. */
const T2 = "2026-08-03T00:00:00.000Z";

export type Fixtures = {
  adminJwt: JwtPayload;
  locationAdminJwt: JwtPayload;
  /** `phe-admin@bms.local` — `organization_admin`, granted PHEWB only. */
  orgAdminJwt: JwtPayload;
  /** A real `organization_admin` row with no organization grant at all. */
  grantlessOrgAdminJwt: JwtPayload;
  /** Claims `admin` but has no `bms.users` row — see `assertReadGateRoles`. */
  unprovisionedAdminJwt: JwtPayload;
  actorId: string;
  /** The org admin's own organization. */
  ownOrgId: string;
  /** An organization the org admin holds no grant on. */
  foreignOrgId: string;
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

/** Deletes only this suite's audit rows. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.audit_log WHERE entity_type = ANY($1)`, [
    [TEST_ENTITY_TYPE, TEST_ORG_ENTITY_TYPE],
  ]);
}

/**
 * Creates the grantless `organization_admin`, on the **superuser** pool.
 *
 * Identity rows are the one thing `bms_fleet` cannot write: it holds BYPASSRLS
 * but no INSERT or DELETE on `bms.users` since ADR 0043 Amendment 4, and
 * `bms_owner` is FORCE-bound with no GUC. The sanctioned path is the gate's
 * `connection: "superuser"`, exactly as `multi-org-scope.rls.integration.test.ts`
 * does it — setup and teardown only; every assertion still runs through the
 * service on the fleet pool.
 *
 * The password hash is deliberately not a valid bcrypt digest: this row is a
 * scope fixture and must never become a usable login on a developer's stack.
 * It gets a home `organization_id` and **no** `user_organization_access` row,
 * which is precisely the shape that makes `writableOrganizationIds` return `[]`
 * — `directOrganizationIds` walks the grant junction, not the home column.
 */
export async function seedGrantlessOrgAdmin(
  superuserPool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  await superuserPool.query(
    `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, $2, 'not-a-usable-hash', 'E7.1e grantless org admin', 'organization_admin')`,
    [fx.ownOrgId, GRANTLESS_ORG_ADMIN_EMAIL],
  );
}

/** Removes the grantless `organization_admin`, on the same superuser pool. */
export async function cleanupGrantlessOrgAdmin(superuserPool: pg.Pool): Promise<void> {
  await superuserPool.query(`DELETE FROM bms.users WHERE email = $1`, [
    GRANTLESS_ORG_ADMIN_EMAIL,
  ]);
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

  // `E7.1e`: the same "run the seed" contract as the actor above. Without a
  // real `organization_admin` and two real organizations, every scope assertion
  // below degrades to a NULL test and the cross-tenant negative disappears.
  const { rows: orgAdminRows } = await pool.query<{ id: string; organization_id: string | null }>(
    `SELECT u.id, uoa.organization_id
       FROM bms.users u
       LEFT JOIN bms.user_organization_access uoa ON uoa.user_id = u.id
      WHERE u.email = 'phe-admin@bms.local' AND u.role = 'organization_admin'
      LIMIT 1`,
  );
  const ownOrgId = orgAdminRows[0]?.organization_id;
  if (!ownOrgId) {
    throw new Error(
      "E7.1e fixtures missing — no phe-admin@bms.local organization_admin with a " +
        "user_organization_access grant. Run 'pnpm db:seed'; without the grant " +
        "writableOrganizationIds returns [] and the scoped read cannot be distinguished " +
        "from a refused one.",
    );
  }

  const { rows: foreignRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY code LIMIT 1`,
    [ownOrgId],
  );
  const foreignOrgId = foreignRows[0]?.id;
  if (!foreignOrgId) {
    throw new Error(
      "E7.1e fixtures missing — only one organization exists. Run 'pnpm db:seed'; the " +
        "cross-tenant negative needs a second organization, or the scope filter is " +
        "indistinguishable from no filter at all.",
    );
  }

  return {
    actorId: actor.id,
    ownOrgId,
    foreignOrgId,
    orgAdminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "phe-admin@bms.local",
      name: "integration:org-admin",
      role: "organization_admin",
    },
    grantlessOrgAdminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: GRANTLESS_ORG_ADMIN_EMAIL,
      name: "integration:grantless-org-admin",
      role: "organization_admin",
    },
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

/**
 * `E7.1e` — three rows that make the organization scope falsifiable.
 *
 * All three share a timestamp inside the `F4.14` window; ordering is not what
 * this set is for. The foreign-organization row is the one that matters: with
 * only the own-org and `NULL` rows, a reader that filtered nothing but `NULL`
 * would pass every assertion below.
 */
export async function seedOrganizationRows(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const rows: [string, string | null][] = [
    [ACTION_OWN, fx.ownOrgId],
    [ACTION_FOREIGN, fx.foreignOrgId],
    [ACTION_PLATFORM, null],
  ];
  for (const [action, organizationId] of rows) {
    await pool.query(
      `INSERT INTO bms.audit_log (organization_id, actor_id, action, entity_type, entity_id, reason, payload, created_at)
       VALUES ($1, $2, $3, $4, gen_random_uuid(), NULL, NULL, $5)`,
      [organizationId, fx.actorId, action, TEST_ORG_ENTITY_TYPE, T2],
    );
  }
}

const ALL_FIXTURES = { entityType: TEST_ENTITY_TYPE, limit: 50, offset: 0 } as const;

const ORG_FIXTURES = { entityType: TEST_ORG_ENTITY_TYPE, limit: 50, offset: 0 } as const;

/**
 * ADR 0021 decision 1, as amended by ADR 0046 decisions 3 and 4 — `admin` and
 * `organization_admin` read; every other role is refused.
 */
export async function assertReadGateRoles(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const seen = await svc.list(fx.adminJwt, { ...ALL_FIXTURES });
  assert(seen.total === 4, `global admin sees the fixtures, got total ${seen.total}`);

  // `wc-admin@bms.local` is a real, provisioned user with grants — and the case
  // that decides ADR 0046 decision 4. `writableOrganizationIds` resolves a
  // `location_admin` through `locationDerivedOrganizationIds`, its whole
  // organization, so a gate keyed on "the scope is a non-empty array" admits it
  // and hands it every audit row its organization owns. Only a gate keyed on
  // the role refuses it, which is why this assertion is not redundant with the
  // unprovisioned one below.
  await expectRejection(
    () => svc.list(fx.locationAdminJwt, { ...ALL_FIXTURES }),
    /global admin or organization admin/i,
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
    /global admin or organization admin/i,
    "location admin exporting the audit log",
  );

  // ADR 0046 decision 2, stated against the `F4.14` fixtures: every one of the
  // four is org-less, and a scoped reader sees none of them. This is the whole
  // "un-attributed history stays invisible to a tenant" ruling, and it is
  // asserted here rather than inferred from `inArray` never matching NULL.
  const orgAdminOnNullRows = await svc.list(fx.orgAdminJwt, { ...ALL_FIXTURES });
  assert(
    orgAdminOnNullRows.total === 0,
    `an organization admin sees no NULL-organization row, got total ${orgAdminOnNullRows.total}`,
  );
  assert(
    orgAdminOnNullRows.items.length === 0,
    "and the page is empty, not merely mis-counted",
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

/**
 * ADR 0046 decisions 1 and 2 — an organization admin reads its own rows, and
 * neither the foreign organization's nor the platform's.
 */
export async function assertOrganizationScope(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const unfiltered = await svc.list(fx.adminJwt, { ...ORG_FIXTURES });
  assert(
    unfiltered.total === 3,
    `the global admin still reads every organization, got total ${unfiltered.total}`,
  );
  assert(
    unfiltered.items.some((item) => item.action === ACTION_PLATFORM),
    "including the platform event, which only the global admin may see",
  );

  const scoped = await svc.list(fx.orgAdminJwt, { ...ORG_FIXTURES });
  assert(scoped.total === 1, `the organization admin reads one row, got total ${scoped.total}`);
  assert(
    scoped.items[0]?.action === ACTION_OWN,
    `and it is its own organization's row, got ${scoped.items[0]?.action}`,
  );
  assert(
    !scoped.items.some((item) => item.action === ACTION_FOREIGN),
    "the other organization's row never appears — the cross-tenant negative",
  );
  assert(
    !scoped.items.some((item) => item.action === ACTION_PLATFORM),
    "and neither does the platform event (decision 2)",
  );
}

/**
 * §4.7 — an empty scope is a real user with no grants, never the unrestricted
 * `null`.
 *
 * `writableOrganizationIds` returns `[]` here, and the failure this guards is
 * the one-character version of the gate that treats `[]` as "no filter": that
 * reader would hand this account all three fixture rows, including the other
 * organization's.
 */
export async function assertGrantlessOrgAdminReadsNothing(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const scoped = await svc.list(fx.grantlessOrgAdminJwt, { ...ORG_FIXTURES });
  assert(
    scoped.total === 0 && scoped.items.length === 0,
    `an organization admin with no grant reads nothing, got total ${scoped.total}`,
  );

  const csv = await svc.export(fx.grantlessOrgAdminJwt, {
    entityType: TEST_ORG_ENTITY_TYPE,
    from: T0,
    to: T2,
    format: "csv",
  });
  assert(
    String(csv.body).trim().split("\n").length === 1,
    "and its export is the header row alone",
  );
}

/**
 * ADR 0046 decision 6 — export carries the same scope as the list.
 *
 * What this does **not** prove, said plainly: that an over-cap export is
 * refused on the *scoped* count. `AuditAdminService.export` calls
 * `assertWithinExportCap(total)` without a cap argument, so the ceiling here is
 * the real 50,000 and no fixture reaches it. What holds the decision is
 * structural — `count` and `selectRows` receive one `where` from one
 * `buildWhere(query, scope)` call — and the list totals in
 * `assertOrganizationScope` show that predicate counting 1 against 3.
 */
export async function assertScopedExport(
  svc: AuditAdminService,
  fx: Fixtures,
): Promise<void> {
  const window = { entityType: TEST_ORG_ENTITY_TYPE, from: T0, to: T2, format: "csv" } as const;

  const unfiltered = await svc.export(fx.adminJwt, { ...window });
  assert(
    String(unfiltered.body).trim().split("\n").length === 4,
    "the global admin exports the header plus all three rows",
  );

  const scoped = await svc.export(fx.orgAdminJwt, { ...window });
  const lines = String(scoped.body).trim().split("\n");
  assert(
    lines.length === 2,
    `the organization admin exports the header plus its own row, got ${lines.length} lines`,
  );
  assert(
    lines[1].includes(ACTION_OWN) && !lines[1].includes(ACTION_FOREIGN),
    "and the row is its own, not the other organization's",
  );
}
