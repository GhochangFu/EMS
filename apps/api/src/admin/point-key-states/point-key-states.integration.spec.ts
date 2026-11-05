import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { PointKeyStatesAdminService } from "./point-key-states.service";

/**
 * `F4.309` / ADR 0088 Amendment 3 decisions 1–4 (plan T3) — `PointKeyStatesAdminService` against
 * a real Postgres, on the real `bms_fleet`, `bms_tenant` and `bms_auth` roles (the wrapper builds
 * them, as `point-keys.rls.integration.test.ts` does).
 *
 * Every row a case writes names a **per-run point key** the wrapper creates (and an inactive one
 * beside it), never a seeded key: `tests/f3.74-point-key-states-seed.integration.test.ts` reads
 * the seed's codes exactly, and a concurrent suite must not see a stray row there. The wrapper
 * deletes both keys in `afterAll`; `point_key_states` cascades from `point_keys`.
 *
 * `observer` is `requireIntegrationDb`'s default connection (`bms_fleet`), used to read the table
 * and the audit log back, so each claim is about the rows, not the service's own `mapRow`.
 */
export type PksFixtures = {
  svc: PointKeyStatesAdminService;
  observer: pg.Pool;
  /** An active per-run point key, unseeded. */
  activeKey: string;
  /** An inactive per-run point key. */
  inactiveKey: string;
};

type AuditRow = { action: string; entity_type: string; organization_id: string | null };

async function auditRowsFor(observer: pg.Pool, entityId: string): Promise<AuditRow[]> {
  const { rows } = await observer.query<AuditRow>(
    `SELECT action, entity_type, organization_id FROM bms.audit_log
      WHERE entity_id = $1 AND action LIKE 'master.point_key_state.%'
      ORDER BY created_at, action`,
    [entityId],
  );
  return rows;
}

/** Deletes the audit rows a case wrote for these state ids. */
export async function deleteAuditRows(observer: pg.Pool, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await observer.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])", [ids]);
}

/**
 * The lifecycle, by the global admin: create, list (with `seeded` right on both kinds of row),
 * patch, delete — each with exactly one audit row of its own action, `entity_type`
 * `point_key_state` and no organization (ADR 0043 Amendment 5, admitted `TO bms_fleet`).
 * Returns the id, so the wrapper can delete the audit rows.
 */
export async function assertGlobalAdminLifecycle(ctx: PksFixtures, admin: JwtPayload): Promise<string> {
  const { svc, observer, activeKey } = ctx;
  const created = await svc.create(admin, { pointKey: activeKey, value: 2, label: "  EARTHED ", tone: "open" });
  expect(created).toMatchObject({ pointKey: activeKey, value: 2, label: "EARTHED", tone: "open", seeded: false });

  const listed = await svc.list(admin);
  expect(listed.items.find((row) => row.id === created.id)).toEqual(created);
  const seeded = listed.items.find((row) => row.pointKey === "breaker_main" && row.value === 1);
  expect(seeded, "the seeded (breaker_main, 1) row must be listed").toMatchObject({ seeded: true, label: "CLOSED" });
  // Ordered by point key then value, read without assuming the database's collation (it orders
  // the codes): each key's rows are contiguous, and ascending by value within it.
  const seen = new Set<string>();
  listed.items.forEach((row, i) => {
    const previous = listed.items[i - 1];
    if (previous && previous.pointKey === row.pointKey) {
      expect(previous.value, `${row.pointKey}'s values ascending`).toBeLessThanOrEqual(row.value);
      return;
    }
    expect(seen.has(row.pointKey), `${row.pointKey}'s rows contiguous`).toBe(false);
    seen.add(row.pointKey);
  });

  const patched = await svc.update(admin, created.id, { tone: "tripped" });
  expect(patched).toMatchObject({ id: created.id, label: "EARTHED", tone: "tripped" });
  const { rows: afterPatch } = await observer.query<{ label: string; tone: string }>(
    "SELECT label, tone FROM bms.point_key_states WHERE id = $1",
    [created.id],
  );
  expect(afterPatch, "PATCH { tone } must write the tone and leave the label").toEqual([{ label: "EARTHED", tone: "tripped" }]);

  await svc.remove(admin, created.id);
  const { rows: afterDelete } = await observer.query("SELECT 1 FROM bms.point_key_states WHERE id = $1", [created.id]);
  expect(afterDelete).toEqual([]);

  expect(await auditRowsFor(observer, created.id)).toEqual(
    ["master.point_key_state.create", "master.point_key_state.delete", "master.point_key_state.update"].map((action) => ({
      action,
      entity_type: "point_key_state",
      organization_id: null,
    })),
  );
  return created.id;
}

/**
 * Decision 2 (owner ruling Q1 (a)) — an `organization_admin` and a `location_admin` are refused
 * the list and every write, and nothing is written. `existingId` is a non-seeded row the wrapper
 * created, so a refusal cannot be a 404 or a 409 in disguise.
 */
export async function assertTenantAdminsAreRefusedEverything(
  ctx: PksFixtures,
  tenantAdmins: readonly JwtPayload[],
  existingId: string,
): Promise<void> {
  const { svc, observer, activeKey } = ctx;
  for (const jwt of tenantAdmins) {
    await expect(svc.list(jwt), `${jwt.role} list`).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.create(jwt, { pointKey: activeKey, value: 9, label: "NEVER", tone: "open" }),
      `${jwt.role} create`,
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.update(jwt, existingId, { label: "NEVER" }), `${jwt.role} update`).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(jwt, existingId), `${jwt.role} delete`).rejects.toBeInstanceOf(ForbiddenException);
  }
  const { rows: existing } = await observer.query<{ label: string }>(
    "SELECT label FROM bms.point_key_states WHERE id = $1",
    [existingId],
  );
  expect(existing, "a refused PATCH or DELETE must leave the row as it was").toEqual([{ label: "FIXTURE" }]);
  const { rows: created } = await observer.query(
    "SELECT 1 FROM bms.point_key_states WHERE point_key_code = $1 AND value = 9",
    [activeKey],
  );
  expect(created, "a refused POST must write no row").toEqual([]);
  expect(await auditRowsFor(observer, existingId)).toEqual([
    { action: "master.point_key_state.create", entity_type: "point_key_state", organization_id: null },
  ]);
}

/**
 * Decision 3 — the seeded `(breaker_main, 1)` is read-only: `PATCH`, `DELETE` and a `POST` of the
 * pair are 409, and the row is unchanged.
 */
export async function assertTheSeededRowIsReadOnly(ctx: PksFixtures, admin: JwtPayload): Promise<void> {
  const { svc, observer } = ctx;
  const read = async (): Promise<Array<{ id: string; label: string; tone: string }>> =>
    (
      await observer.query<{ id: string; label: string; tone: string }>(
        "SELECT id, label, tone FROM bms.point_key_states WHERE point_key_code = 'breaker_main' AND value = 1",
      )
    ).rows;
  const before = await read();
  expect(before, "the seeded (breaker_main, 1) row — run pnpm db:seed").toHaveLength(1);
  const id = before[0]!.id;

  await expect(svc.update(admin, id, { label: "SHUT" })).rejects.toBeInstanceOf(ConflictException);
  await expect(svc.remove(admin, id)).rejects.toBeInstanceOf(ConflictException);
  await expect(
    svc.create(admin, { pointKey: "breaker_main", value: 1, label: "SHUT", tone: "open" }),
  ).rejects.toBeInstanceOf(ConflictException);

  expect(await read()).toEqual(before);
  expect(await auditRowsFor(observer, id)).toEqual([]);
}

/** Decision 4 — an unknown or an inactive point key is a 400, and nothing is written. */
export async function assertAnUnknownOrInactiveKeyIs400(ctx: PksFixtures, admin: JwtPayload): Promise<void> {
  const { svc, observer, inactiveKey } = ctx;
  const unknownKey = `${inactiveKey}-nope`;
  await expect(
    svc.create(admin, { pointKey: unknownKey, value: 1, label: "ON", tone: "closed" }),
  ).rejects.toBeInstanceOf(BadRequestException);
  await expect(
    svc.create(admin, { pointKey: inactiveKey, value: 1, label: "ON", tone: "closed" }),
  ).rejects.toBeInstanceOf(BadRequestException);
  const { rows } = await observer.query(
    "SELECT 1 FROM bms.point_key_states WHERE point_key_code = ANY($1::text[])",
    [[unknownKey, inactiveKey]],
  );
  expect(rows).toEqual([]);
}

/**
 * Decision 4 — a second row of the same pair is a 409 naming it (the unique constraint,
 * translated), and the first row stands. Returns the first row's id.
 */
export async function assertADuplicatePairIs409(ctx: PksFixtures, admin: JwtPayload): Promise<string> {
  const { svc, activeKey } = ctx;
  const first = await svc.create(admin, { pointKey: activeKey, value: 4, label: "FIRST", tone: "open" });
  const err = await svc.create(admin, { pointKey: activeKey, value: 4, label: "SECOND", tone: "shut" }).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toContain(activeKey);
  const listed = await svc.list(admin);
  expect(listed.items.filter((row) => row.pointKey === activeKey && row.value === 4)).toEqual([first]);
  return first.id;
}

/** Plan C9 — an empty `PATCH` is 400; an unknown id is 404 on `PATCH` and `DELETE`. */
export async function assertEmptyPatchIs400AndUnknownIdIs404(
  ctx: PksFixtures,
  admin: JwtPayload,
  existingId: string,
): Promise<void> {
  const { svc } = ctx;
  await expect(svc.update(admin, existingId, {})).rejects.toBeInstanceOf(BadRequestException);
  const missing = "00000000-0000-4000-8000-00000000f309";
  await expect(svc.update(admin, missing, { label: "X" })).rejects.toBeInstanceOf(NotFoundException);
  await expect(svc.remove(admin, missing)).rejects.toBeInstanceOf(NotFoundException);
}
