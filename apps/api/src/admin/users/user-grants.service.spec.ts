import { HttpException } from "@nestjs/common";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserGrantDto, UserRole } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { rememberIdentity } from "../../auth/identity-resolver";
import { FakeIdentityAdmin } from "../../identity/testing/fake-identity-admin";
import { dbOps, recordingDb, type DbOp, type Timeline } from "../../testing/recording-db";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  CROSS_ORGANIZATION_GRANT_ADMIN_ONLY,
  DUPLICATE_GRANT,
  GRANT_NOT_FOUND,
  GRANT_TARGET_CHANGED,
  GRANT_TARGET_NOT_FOUND,
  UserGrantsService,
} from "./user-grants.service";
import { MANAGER_ROLE_REQUIRED, USER_NOT_FOUND, UsersService, type UserRow } from "./users.service";

/**
 * `F3.78` / ADR 0089 decisions 2, 10, 12, 14 and plan D2 — `UserGrantsService`
 * against the recording fake db (`testing/recording-db.ts`). The caller's
 * identity is memoised with `rememberIdentity`, so every manager decision
 * reads the row the spec names. `withTenant` on the fake records its
 * `set_config` call, so "the write ran under organization X" is one read of
 * that op's parameter. One claim per exported function;
 * `user-grants.service.test.ts` is the entry point.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const LOC_A1 = "00000000-0000-4000-8000-0000000001a1";
const LOC_B1 = "00000000-0000-4000-8000-0000000001b1";
const GROUP_A1 = "00000000-0000-4000-8000-0000000002a1";
const GROUP_B1 = "00000000-0000-4000-8000-0000000002b1";
const MISSING = "00000000-0000-4000-8000-0000000009f9";
const NEW_GRANT = "00000000-0000-4000-8000-0000000003ff";

const CREATED = new Date("2026-10-01T00:00:00.000Z");

function user(id: string, role: UserRole, organizationId: string | null, extra: Partial<UserRow> = {}): UserRow {
  return {
    id,
    email: `${id.slice(-4)}-hidden@fixture.local`,
    displayName: `User ${id.slice(-4)}`,
    role,
    organizationId,
    subject: `kc-${id.slice(-4)}`,
    disabledAt: null,
    lastLoginAt: null,
    createdAt: CREATED,
    ...extra,
  };
}

const ADMIN_CALLER = user("00000000-0000-4000-8000-0000000000a1", "admin", null);
const ORG_ADMIN_CALLER = user("00000000-0000-4000-8000-0000000000o1", "organization_admin", ORG_A);
const LOCATION_ADMIN_CALLER = user("00000000-0000-4000-8000-0000000000l1", "location_admin", ORG_A);
const ADMIN_TARGET = user("00000000-0000-4000-8000-0000000000a3", "admin", null);
const VIEWER_A = user("00000000-0000-4000-8000-0000000000v1", "viewer", ORG_A);
/** The C1 target: home A, granted organization B. */
const VIEWER_A_GRANTED_B = user("00000000-0000-4000-8000-0000000000v2", "viewer", ORG_A);
/** A viewer with an organization grant and a location grant (plan D2). */
const VIEWER_TWO_GRANTS = user("00000000-0000-4000-8000-0000000000v3", "viewer", ORG_A);
const ORG_ADMIN_TARGET = user("00000000-0000-4000-8000-0000000000o2", "organization_admin", ORG_A);
const UNLINKED_A = user("00000000-0000-4000-8000-0000000000u1", "viewer", ORG_A, { subject: null });
/** `F4.201`: a viewer with one asset-group grant and one location grant, kept off the D2 fixtures. */
const VIEWER_GROUP_GRANT = user("00000000-0000-4000-8000-0000000000g1", "viewer", ORG_A);

const USERS = [
  ADMIN_CALLER,
  ORG_ADMIN_CALLER,
  LOCATION_ADMIN_CALLER,
  ADMIN_TARGET,
  VIEWER_A,
  VIEWER_A_GRANTED_B,
  VIEWER_TWO_GRANTS,
  ORG_ADMIN_TARGET,
  UNLINKED_A,
  VIEWER_GROUP_GRANT,
];

type Grant = { id: string; userId: string; kind: UserGrantDto["kind"]; targetId: string; organizationId: string; locationId: string | null };

const GRANTS: Grant[] = [
  { id: "00000000-0000-4000-8000-0000000003b2", userId: VIEWER_A_GRANTED_B.id, kind: "organization", targetId: ORG_B, organizationId: ORG_B, locationId: null },
  { id: "00000000-0000-4000-8000-0000000003c1", userId: VIEWER_TWO_GRANTS.id, kind: "organization", targetId: ORG_A, organizationId: ORG_A, locationId: null },
  { id: "00000000-0000-4000-8000-0000000003c2", userId: VIEWER_TWO_GRANTS.id, kind: "location", targetId: LOC_A1, organizationId: ORG_A, locationId: LOC_A1 },
  { id: "00000000-0000-4000-8000-0000000003d1", userId: ORG_ADMIN_TARGET.id, kind: "organization", targetId: ORG_A, organizationId: ORG_A, locationId: null },
  { id: "00000000-0000-4000-8000-0000000003d2", userId: ORG_ADMIN_TARGET.id, kind: "location", targetId: LOC_A1, organizationId: ORG_A, locationId: LOC_A1 },
  { id: "00000000-0000-4000-8000-0000000003e1", userId: VIEWER_A.id, kind: "location", targetId: LOC_A1, organizationId: ORG_A, locationId: LOC_A1 },
  { id: "00000000-0000-4000-8000-0000000003f1", userId: VIEWER_GROUP_GRANT.id, kind: "asset_group", targetId: GROUP_A1, organizationId: ORG_A, locationId: LOC_A1 },
  { id: "00000000-0000-4000-8000-0000000003f2", userId: VIEWER_GROUP_GRANT.id, kind: "location", targetId: LOC_B1, organizationId: ORG_B, locationId: LOC_B1 },
];

const ORGANIZATIONS: Record<string, string> = { [ORG_A]: "Org A", [ORG_B]: "Org B" };
const LOCATIONS: Record<string, { organizationId: string; name: string }> = {
  [LOC_A1]: { organizationId: ORG_A, name: "Site A1" },
  [LOC_B1]: { organizationId: ORG_B, name: "Site B1" },
};
const GROUPS: Record<string, { organizationId: string; locationId: string; name: string }> = {
  [GROUP_A1]: { organizationId: ORG_A, locationId: LOC_A1, name: "Group A1" },
  [GROUP_B1]: { organizationId: ORG_B, locationId: LOC_B1, name: "Group B1" },
};

const GRANT_TABLE: Record<UserGrantDto["kind"], string> = {
  organization: "user_organization_access",
  location: "user_location_access",
  asset_group: "user_asset_group_access",
};

type Options = {
  readonly caller?: UserRow;
  readonly jwtRole?: UserRole;
  readonly writable?: string[];
  readonly authMode?: "oidc" | "local";
  /** What the grant insert raises, as a Postgres error code. */
  readonly insertFails?: string;
  readonly emptyDelete?: boolean;
};

function harness(options: Options = {}) {
  const caller = options.caller ?? ADMIN_CALLER;
  vi.stubEnv("AUTH_MODE", options.authMode ?? "oidc");
  vi.stubEnv("OIDC_ISSUER", options.authMode === "local" ? "" : "http://keycloak:8080/realms/bms");

  const timeline: Timeline = [];
  const answer = (op: DbOp): unknown[] | undefined => {
    if (op.kind === "select" && op.table === "users") {
      return USERS.filter((row) => op.params.includes(row.id));
    }
    if (op.kind === "select" && op.table === "organizations") {
      return Object.entries(ORGANIZATIONS)
        .filter(([id]) => op.params.includes(id))
        .map(([id, name]) => ({ id, name, organizationId: id }));
    }
    if (op.kind === "select" && op.table === "locations") {
      return Object.entries(LOCATIONS)
        .filter(([id]) => op.params.includes(id))
        .map(([id, row]) => ({ id, ...row }));
    }
    if (op.kind === "select" && op.table === "asset_groups") {
      return Object.entries(GROUPS)
        .filter(([id]) => op.params.includes(id))
        .map(([id, row]) => ({ id, ...row }));
    }
    if (op.kind === "select" && op.table !== null && Object.values(GRANT_TABLE).includes(op.table)) {
      const kind = (Object.keys(GRANT_TABLE) as UserGrantDto["kind"][]).find((k) => GRANT_TABLE[k] === op.table);
      if (op.text.includes('"active"')) {
        // `readScopeSourceYields`: does this user's `kind` grant reach an active location?
        return GRANTS.some((g) => g.kind === kind && op.params.includes(g.userId)) ? [{ id: "a-location" }] : [];
      }
      // The DELETE's grant read: `id = grantId AND user_id = :id`.
      return GRANTS.filter((g) => g.kind === kind && op.params.includes(g.id) && op.params.includes(g.userId));
    }
    if (op.kind === "execute" && op.text.includes("AS kind")) {
      // The UNION read: `location_name` is the group's location on an asset_group row and NULL
      // on the other two branches, as the SQL selects it.
      return GRANTS.filter((g) => op.params.includes(g.userId)).map((g) => ({
        id: g.id,
        kind: g.kind,
        target_id: g.targetId,
        target_name:
          g.kind === "organization"
            ? ORGANIZATIONS[g.targetId]
            : g.kind === "asset_group"
              ? (GROUPS[g.targetId]?.name ?? "?")
              : (LOCATIONS[g.targetId]?.name ?? "?"),
        location_name: g.kind === "asset_group" ? (LOCATIONS[GROUPS[g.targetId]?.locationId ?? ""]?.name ?? "?") : null,
        organization_id: g.organizationId,
        created_at: CREATED,
      }));
    }
    if (op.kind === "execute" && op.text.includes("user_organization_access")) {
      // `grantOrganizationIds` (the U5 reach read).
      const ids = String(op.params[0]).replace(/[{}]/g, "").split(",");
      return GRANTS.filter((g) => ids.includes(g.userId)).map((g) => ({ user_id: g.userId, organization_id: g.organizationId }));
    }
    if (op.kind === "insert" && op.table !== null && Object.values(GRANT_TABLE).includes(op.table)) {
      if (options.insertFails) {
        throw Object.assign(new Error(`pg ${options.insertFails} on grant ${String(op.values?.locationId ?? "")}`), {
          code: options.insertFails,
        });
      }
      return [{ id: NEW_GRANT }];
    }
    if (op.kind === "delete") {
      return options.emptyDelete ? [] : [{ id: "deleted" }];
    }
    return [];
  };
  const fleet = recordingDb("fleet", timeline, answer);
  const tenant = recordingDb("tenant", timeline, answer);
  const writable = caller.role === "admin" ? null : (options.writable ?? [ORG_A]);
  const accessControl = {
    writableOrganizationIds: async () => writable,
    canManageOrganization: async (_jwt: JwtPayload, organizationId: string) =>
      writable === null || writable.includes(organizationId),
    canManageLocation: async (_jwt: JwtPayload, locationId: string) =>
      writable === null || writable.includes(LOCATIONS[locationId]?.organizationId ?? "none"),
  } as unknown as AccessControlService;
  const audit = new MasterDataAuditService(tenant as BmsDb, fleet as BmsDb);
  const users = new UsersService(fleet, tenant, accessControl, audit, new FakeIdentityAdmin());
  const service = new UserGrantsService(fleet, tenant, accessControl, audit, users);

  const jwt: JwtPayload = {
    sub: caller.subject ?? caller.id,
    email: caller.email,
    name: caller.displayName,
    role: options.jwtRole ?? caller.role,
  };
  rememberIdentity(jwt, {
    id: caller.id,
    email: caller.email,
    displayName: caller.displayName,
    role: caller.role,
    organizationId: caller.organizationId,
    oidcSubject: caller.subject,
    disabledAt: caller.disabledAt,
  });
  return { service, jwt, timeline };
}

async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  throw new Error("expected the call to be refused");
}

const ops = (timeline: Timeline) => dbOps(timeline);
const auditInserts = (timeline: Timeline) => ops(timeline).filter((op) => op.kind === "insert" && op.table === "audit_log");
const grantInserts = (timeline: Timeline) =>
  ops(timeline).filter((op) => op.kind === "insert" && op.table !== null && op.table.startsWith("user_"));
const grantDeletes = (timeline: Timeline) => ops(timeline).filter((op) => op.kind === "delete");
/** Every organization a `withTenant` in this timeline set as `app.current_organization`. */
const gucs = (timeline: Timeline) =>
  ops(timeline)
    .filter((op) => op.kind === "execute" && op.text.includes("set_config('app.current_organization'"))
    .map((op) => op.params[0]);
const written = (timeline: Timeline) => grantInserts(timeline).length + grantDeletes(timeline).length + auditInserts(timeline).length;
const effectiveOf = (items: readonly UserGrantDto[], kind: UserGrantDto["kind"]) =>
  items.filter((item) => item.kind === kind).map((item) => item.effective);

// -- GET ----------------------------------------------------------------------

export async function assertANonManagerIsRefusedOnGet(): Promise<void> {
  const { service, jwt } = harness({ caller: LOCATION_ADMIN_CALLER });
  const err = await refusal(service.list(jwt, VIEWER_A.id));
  expect([err.getStatus(), err.message]).toEqual([403, MANAGER_ROLE_REQUIRED]);
}

/** A C1 target answers exactly what a nonexistent id answers. */
export async function assertGetForAC1TargetIsTheNonexistentIdBody(): Promise<void> {
  const { service, jwt } = harness({ caller: ORG_ADMIN_CALLER });
  const hidden = await refusal(service.list(jwt, VIEWER_A_GRANTED_B.id));
  const missing = await refusal(service.list(jwt, MISSING));
  expect([hidden.getStatus(), hidden.getResponse()]).toEqual([404, missing.getResponse()]);
  expect(hidden.message).toBe(USER_NOT_FOUND);
}

export async function assertGetForAnAdminTargetIsHiddenFromAnOrganizationAdmin(): Promise<void> {
  const { service, jwt } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.list(jwt, ADMIN_TARGET.id));
  expect([err.getStatus(), err.message]).toEqual([404, USER_NOT_FOUND]);
}

/** A token that claims `admin` on an `organization_admin` row gets the `organization_admin` rules. */
export async function assertAStaleAdminTokenGetsTheOrganizationAdminRules(): Promise<void> {
  const { service, jwt } = harness({ caller: ORG_ADMIN_CALLER, jwtRole: "admin" });
  const err = await refusal(service.list(jwt, VIEWER_A_GRANTED_B.id));
  expect(err.getStatus()).toBe(404);
}

/** D2: an `organization_admin` reads only its organization grants; a location grant is kept but not effective. */
export async function assertALocationGrantOnAnOrganizationAdminIsNotEffective(): Promise<void> {
  const { service, jwt } = harness();
  const { items } = await service.list(jwt, ORG_ADMIN_TARGET.id);
  expect(effectiveOf(items, "organization")).toEqual([true]);
  expect(effectiveOf(items, "location")).toEqual([false]);
}

/** D2: the selected source, not the role's list — a viewer's location grant is shadowed by its organization grant. */
export async function assertAViewersOrganizationGrantShadowsItsLocationGrant(): Promise<void> {
  const { service, jwt } = harness();
  const { items } = await service.list(jwt, VIEWER_TWO_GRANTS.id);
  expect(effectiveOf(items, "organization")).toEqual([true]);
  expect(effectiveOf(items, "location")).toEqual([false]);
}

/** D2's other half: a viewer whose only grant is a location grant reads it. */
export async function assertAViewersOnlyLocationGrantIsEffective(): Promise<void> {
  const { service, jwt } = harness();
  const { items } = await service.list(jwt, VIEWER_A.id);
  expect(effectiveOf(items, "location")).toEqual([true]);
}

/** `F4.201`: an asset-group grant names its group's location, so two "HVAC" groups differ. */
export async function assertAnAssetGroupGrantCarriesItsLocationName(): Promise<void> {
  const { service, jwt } = harness();
  const { items } = await service.list(jwt, VIEWER_GROUP_GRANT.id);
  const group = items.find((item) => item.kind === "asset_group");
  expect(group?.targetName).toBe("Group A1");
  expect(group?.locationName).toBe("Site A1");
}

/** `F4.201`: the field is absent — not null, not undefined-valued — on a location grant. */
export async function assertALocationGrantCarriesNoLocationName(): Promise<void> {
  const { service, jwt } = harness();
  const { items } = await service.list(jwt, VIEWER_GROUP_GRANT.id);
  const location = items.find((item) => item.kind === "location");
  // Positive control: the location grant is in the list.
  expect(location?.targetName).toBe("Site B1");
  expect("locationName" in (location ?? {})).toBe(false);
}

export async function assertGrantReadsRunOnTheFleetPool(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.list(jwt, VIEWER_TWO_GRANTS.id);
  expect(new Set(ops(timeline).map((op) => op.executor))).toEqual(new Set(["fleet"]));
}

// -- POST ---------------------------------------------------------------------

export async function assertANonManagerIsRefusedOnAdd(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: LOCATION_ADMIN_CALLER });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_A1 }));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([403, MANAGER_ROLE_REQUIRED, 0]);
}

export async function assertABadBodyIs400AndWritesNothing(): Promise<void> {
  const { service, jwt, timeline } = harness();
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "asset", targetId: LOC_A1 }));
  expect([err.getStatus(), written(timeline)]).toEqual([400, 0]);
}

/** Positive control: an `organization_admin` grants a location in the user's home organization. */
export async function assertASameOrganizationLocationGrantLandsUnderItsOrganization(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  await service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_A1 });
  const [insert] = grantInserts(timeline);
  expect([insert?.table, insert?.executor, insert?.values]).toEqual([
    "user_location_access",
    "tenant.tx",
    { userId: VIEWER_A.id, locationId: LOC_A1 },
  ]);
  expect(gucs(timeline)).toEqual([ORG_A]);
}

/** Decision 10: the GUC is the location's organization, never the user's home organization. */
export async function assertACrossOrganizationLocationGrantRunsUnderTheLocationsOrganization(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_B1 });
  expect(gucs(timeline)).toEqual([ORG_B]);
  expect(grantInserts(timeline)).toHaveLength(1);
}

export async function assertAnAssetGroupGrantRunsUnderTheGroupsOrganization(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.add(jwt, VIEWER_A.id, { kind: "asset_group", targetId: GROUP_B1 });
  const [insert] = grantInserts(timeline);
  expect([insert?.table, insert?.values]).toEqual(["user_asset_group_access", { userId: VIEWER_A.id, assetGroupId: GROUP_B1 }]);
  expect(gucs(timeline)).toEqual([ORG_B]);
}

export async function assertAnOrganizationGrantRunsUnderThatOrganization(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.add(jwt, VIEWER_A.id, { kind: "organization", targetId: ORG_B });
  const [insert] = grantInserts(timeline);
  expect([insert?.table, insert?.values]).toEqual(["user_organization_access", { userId: VIEWER_A.id, organizationId: ORG_B }]);
  expect(gucs(timeline)).toEqual([ORG_B]);
}

/** Decision 14: one `master.user_grant.add` audit row, on the grant's transaction, stamped with the target's organization. */
export async function assertAnAddWritesOneAuditRowOnItsTransaction(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_B1 });
  const audits = auditInserts(timeline);
  expect(audits.map((op) => [op.executor, op.values?.action, op.values?.organizationId, op.values?.entityId])).toEqual([
    ["tenant.tx", "master.user_grant.add", ORG_B, NEW_GRANT],
  ]);
}

/** The cross-organization rule, location: `organization_admin` holding A and B may not grant a B location to a home-A user. */
export async function assertAnOrganizationAdminCrossOrganizationLocationGrantIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER, writable: [ORG_A, ORG_B] });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_B1 }));
  expect([err.getStatus(), err.message, written(timeline), gucs(timeline)]).toEqual([
    403,
    CROSS_ORGANIZATION_GRANT_ADMIN_ONLY,
    0,
    [],
  ]);
}

export async function assertAnOrganizationAdminCrossOrganizationAssetGroupGrantIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER, writable: [ORG_A, ORG_B] });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "asset_group", targetId: GROUP_B1 }));
  expect([err.getStatus(), err.message, written(timeline), gucs(timeline)]).toEqual([
    403,
    CROSS_ORGANIZATION_GRANT_ADMIN_ONLY,
    0,
    [],
  ]);
}

export async function assertAnOrganizationAdminCrossOrganizationOrganizationGrantIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER, writable: [ORG_A, ORG_B] });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "organization", targetId: ORG_B }));
  expect([err.getStatus(), err.message, written(timeline), gucs(timeline)]).toEqual([
    403,
    CROSS_ORGANIZATION_GRANT_ADMIN_ONLY,
    0,
    [],
  ]);
}

/** Target scope (`canManageLocation`): a location outside the caller's organizations is the missing-target 404. */
export async function assertATargetOutsideTheCallersScopeIsTheMissingTargetBody(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const hidden = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_B1 }));
  const missing = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: MISSING }));
  expect([hidden.getStatus(), hidden.getResponse(), written(timeline)]).toEqual([404, missing.getResponse(), 0]);
  expect(hidden.message).toBe(GRANT_TARGET_NOT_FOUND);
}

/** Target scope for a group is `canManageLocation` on the group's location. */
export async function assertAGroupOutsideTheCallersScopeIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "asset_group", targetId: GROUP_B1 }));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([404, GRANT_TARGET_NOT_FOUND, 0]);
}

/** Target scope (`canManageOrganization`). */
export async function assertAnOrganizationOutsideTheCallersScopeIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "organization", targetId: ORG_B }));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([404, GRANT_TARGET_NOT_FOUND, 0]);
}

export async function assertAddOnAC1TargetIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.add(jwt, VIEWER_A_GRANTED_B.id, { kind: "location", targetId: LOC_A1 }));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([404, USER_NOT_FOUND, 0]);
}

export async function assertAddOnAnAdminTargetIsRefusedForAnOrganizationAdmin(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.add(jwt, ADMIN_TARGET.id, { kind: "location", targetId: LOC_A1 }));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([404, USER_NOT_FOUND, 0]);
}

/** A duplicate is a 409 from the unique index, with no audit row. */
export async function assertADuplicateGrantIs409WithNoAudit(): Promise<void> {
  const { service, jwt, timeline } = harness({ insertFails: "23505" });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_A1 }));
  expect([err.getStatus(), err.message, auditInserts(timeline).length]).toEqual([409, DUPLICATE_GRANT, 0]);
}

/** The policy's `WITH CHECK` refusal (`42501`) is a non-naming answer with no audit row. */
export async function assertARowLevelSecurityRefusalIsNonNamingWithNoAudit(): Promise<void> {
  const { service, jwt, timeline } = harness({ insertFails: "42501" });
  const err = await refusal(service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_B1 }));
  expect([err.getStatus(), err.message, auditInserts(timeline).length]).toEqual([409, GRANT_TARGET_CHANGED, 0]);
  expect(JSON.stringify(err.getResponse())).not.toContain(LOC_B1);
}

/** Decision 11: grants touch only the database, so local auth mode still writes them. */
export async function assertAddWorksInLocalAuthMode(): Promise<void> {
  const { service, jwt, timeline } = harness({ authMode: "local" });
  await service.add(jwt, VIEWER_A.id, { kind: "location", targetId: LOC_A1 });
  expect(grantInserts(timeline)).toHaveLength(1);
}

/** No Keycloak id is needed: an unlinked user can be granted. */
export async function assertAddWorksOnAnUnlinkedUser(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.add(jwt, UNLINKED_A.id, { kind: "location", targetId: LOC_A1 });
  expect(grantInserts(timeline)).toHaveLength(1);
}

// -- DELETE -------------------------------------------------------------------

const VIEWER_A_LOCATION_GRANT = GRANTS.find((g) => g.userId === VIEWER_A.id && g.kind === "location") as Grant;
const VIEWER_TWO_LOCATION_GRANT = GRANTS.find((g) => g.userId === VIEWER_TWO_GRANTS.id && g.kind === "location") as Grant;
const C1_ORGANIZATION_GRANT = GRANTS.find((g) => g.userId === VIEWER_A_GRANTED_B.id) as Grant;

export async function assertARemoveLandsUnderTheTargetsOrganizationWithOneAuditRow(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  await service.remove(jwt, VIEWER_A.id, "location", VIEWER_A_LOCATION_GRANT.id);
  const [del] = grantDeletes(timeline);
  expect([del?.table, del?.executor, del?.returning]).toEqual(["user_location_access", "tenant.tx", true]);
  expect(gucs(timeline)).toEqual([ORG_A]);
  expect(auditInserts(timeline).map((op) => [op.values?.action, op.values?.organizationId])).toEqual([
    ["master.user_grant.remove", ORG_A],
  ]);
}

/** Another user's `grantId` is a 404 that does not name it, and nothing is deleted. */
export async function assertAnotherUsersGrantIdIs404WithoutNamingIt(): Promise<void> {
  const { service, jwt, timeline } = harness();
  const err = await refusal(service.remove(jwt, VIEWER_A.id, "location", VIEWER_TWO_LOCATION_GRANT.id));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([404, GRANT_NOT_FOUND, 0]);
  expect(JSON.stringify(err.getResponse())).not.toContain(VIEWER_TWO_LOCATION_GRANT.id);
}

/** Under `FORCE` a delete under the wrong GUC returns zero rows: a 404 with no audit row. */
export async function assertAnEmptyDeleteIs404WithNoAudit(): Promise<void> {
  const { service, jwt, timeline } = harness({ emptyDelete: true });
  const err = await refusal(service.remove(jwt, VIEWER_A.id, "location", VIEWER_A_LOCATION_GRANT.id));
  expect([err.getStatus(), err.message, auditInserts(timeline).length]).toEqual([404, GRANT_NOT_FOUND, 0]);
}

/** The cross-organization rule holds on remove as on add. */
export async function assertAnOrganizationAdminCannotRemoveACrossOrganizationGrant(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER, writable: [ORG_A, ORG_B] });
  const err = await refusal(service.remove(jwt, VIEWER_A_GRANTED_B.id, "organization", C1_ORGANIZATION_GRANT.id));
  expect([err.getStatus(), err.message, written(timeline)]).toEqual([403, CROSS_ORGANIZATION_GRANT_ADMIN_ONLY, 0]);
}

export async function assertAnUnknownKindIs400(): Promise<void> {
  const { service, jwt, timeline } = harness();
  const err = await refusal(service.remove(jwt, VIEWER_A.id, "asset", VIEWER_A_LOCATION_GRANT.id));
  expect([err.getStatus(), written(timeline)]).toEqual([400, 0]);
}
