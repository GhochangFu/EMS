import { HttpException, Logger } from "@nestjs/common";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { rememberIdentity, type ResolvedIdentity } from "../../auth/identity-resolver";
import type { IdentityAdminFailureReason, NewIdentityUser } from "../../identity/identity-admin.client";
import { FakeIdentityAdmin } from "../../identity/testing/fake-identity-admin";
import { MasterDataAuditService } from "../master-data-audit.service";
import { dbOps, recordingDb, type DbOp, type Timeline } from "../../testing/recording-db";
import {
  ADMIN_ROLE_ADMIN_ONLY,
  CHANGED_UNDER_YOU,
  DUPLICATE_EMAIL,
  LAST_ACTIVE_ADMIN,
  LOCAL_MODE_READ_ONLY,
  NOT_CONFIGURED,
  ORGANIZATION_OUT_OF_SCOPE,
  SELF_DEACTIVATE,
  SELF_ROLE_CHANGE,
  UNLINKED_USER,
  USER_NOT_FOUND,
  UsersService,
  type UserRow,
} from "./users.service";

/**
 * `F3.78` / ADR 0089 decisions 1–3, 6, 8, 11, 14 — `UsersService` against a
 * recording fake db (`testing/recording-db.ts`) and `FakeIdentityAdmin`.
 * Both write into one timeline, so an ordering claim is one index comparison.
 * The caller's identity is memoised with `rememberIdentity`, so the role every
 * manager decision reads is the row the spec names, never the token's claim.
 * One claim per exported function; `users.service.test.ts` is the entry point.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const PASSWORD = "Temp-Pass-123";

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
const OTHER_ADMIN = user("00000000-0000-4000-8000-0000000000a2", "admin", null);
const ADMIN_TARGET = user("00000000-0000-4000-8000-0000000000a3", "admin", null);
const VIEWER_A = user("00000000-0000-4000-8000-0000000000v1", "viewer", ORG_A);
const VIEWER_A_GRANTED_B = user("00000000-0000-4000-8000-0000000000v2", "viewer", ORG_A);
const UNLINKED_A = user("00000000-0000-4000-8000-0000000000u1", "viewer", ORG_A, { subject: null });
const DISABLED_A = user("00000000-0000-4000-8000-0000000000d1", "viewer", ORG_A, {
  disabledAt: new Date("2026-10-02T00:00:00.000Z"),
});

const ALL_USERS = [ADMIN_CALLER, ORG_ADMIN_CALLER, OTHER_ADMIN, ADMIN_TARGET, VIEWER_A, VIEWER_A_GRANTED_B, UNLINKED_A, DISABLED_A];
const GRANTS: Record<string, string[]> = { [VIEWER_A_GRANTED_B.id]: [ORG_B] };

/** `FakeIdentityAdmin`, also writing into the shared timeline. */
class TimelineIdentityAdmin extends FakeIdentityAdmin {
  constructor(private readonly timeline: Timeline) {
    super();
  }
  private note(method: string, args: unknown[]): void {
    this.timeline.push({ source: "identity", method, args });
  }
  override createUser(u: NewIdentityUser) {
    this.note("createUser", [u]);
    return super.createUser(u);
  }
  override setTemporaryPassword(id: string, password: string) {
    this.note("setTemporaryPassword", [id, password]);
    return super.setTemporaryPassword(id, password);
  }
  override setEnabled(id: string, enabled: boolean) {
    this.note("setEnabled", [id, enabled]);
    return super.setEnabled(id, enabled);
  }
  override setRealmRole(id: string, role: UserRole) {
    this.note("setRealmRole", [id, role]);
    return super.setRealmRole(id, role);
  }
  override logoutSessions(id: string) {
    this.note("logoutSessions", [id]);
    return super.logoutSessions(id);
  }
  override deleteUser(id: string) {
    this.note("deleteUser", [id]);
    return super.deleteUser(id);
  }
}

type Options = {
  readonly caller?: UserRow;
  /** The token's claimed role, when it differs from the row's. */
  readonly jwtRole?: UserRole;
  readonly writable?: string[];
  readonly authMode?: "oidc" | "local";
  readonly failInsert?: boolean;
  readonly emptyUpdate?: boolean;
  readonly activeAdmins?: string[];
  readonly users?: UserRow[];
};

function harness(options: Options = {}) {
  const caller = options.caller ?? ADMIN_CALLER;
  const rows = options.users ?? ALL_USERS;
  vi.stubEnv("AUTH_MODE", options.authMode ?? "oidc");
  vi.stubEnv("OIDC_ISSUER", options.authMode === "local" ? "" : "http://keycloak:8080/realms/bms");

  const timeline: Timeline = [];
  const answer = (op: DbOp): unknown[] | undefined => {
    if (op.kind === "select" && op.table === "users") {
      if (op.text.includes("lower(")) {
        return rows.filter((row) => op.params.includes(row.email)).map((row) => ({ id: row.id }));
      }
      if (op.text.includes('"id" =')) {
        return rows.filter((row) => op.params.includes(row.id));
      }
      return rows;
    }
    if (op.kind === "execute") {
      if (op.text.includes("user_organization_access")) {
        const ids = String(op.params[0]).replace(/[{}]/g, "").split(",");
        return ids.flatMap((id) => (GRANTS[id] ?? []).map((org) => ({ user_id: id, organization_id: org })));
      }
      if (op.text.includes("FOR UPDATE")) {
        const active =
          options.activeAdmins ?? rows.filter((row) => row.role === "admin" && row.disabledAt === null).map((row) => row.id);
        return active.map((id) => ({ id }));
      }
      if (op.text.includes("INSERT INTO bms.users")) {
        if (options.failInsert) {
          throw new Error("the insert failed");
        }
        const [id, organizationId, email, displayName, role, subject] = op.params as string[];
        return [
          {
            id,
            organization_id: organizationId,
            email,
            display_name: displayName,
            role,
            oidc_subject: subject,
            disabled_at: null,
            last_login_at: null,
            created_at: CREATED,
          },
        ];
      }
      return [];
    }
    if (op.kind === "update" && op.table === "users") {
      return options.emptyUpdate ? [] : [{ id: "updated" }];
    }
    return [];
  };
  const fleet = recordingDb("fleet", timeline, answer);
  const tenant = recordingDb("tenant", timeline, answer);
  const identity = new TimelineIdentityAdmin(timeline);
  const writable = caller.role === "admin" ? null : (options.writable ?? [ORG_A]);
  const accessControl = {
    writableOrganizationIds: async () => writable,
  } as unknown as AccessControlService;
  const audit = new MasterDataAuditService(tenant as BmsDb, fleet as BmsDb);
  const service = new UsersService(fleet, tenant, accessControl, audit, identity);

  const jwt: JwtPayload = {
    sub: caller.subject ?? caller.id,
    email: caller.email,
    name: caller.displayName,
    role: options.jwtRole ?? caller.role,
  };
  const identityRow: ResolvedIdentity = {
    id: caller.id,
    email: caller.email,
    displayName: caller.displayName,
    role: caller.role,
    organizationId: caller.organizationId,
    oidcSubject: caller.subject,
    disabledAt: caller.disabledAt,
  };
  rememberIdentity(jwt, identityRow);
  return { service, jwt, timeline, identity };
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
const notifies = (timeline: Timeline) => ops(timeline).filter((op) => op.kind === "execute" && op.text.includes("pg_notify"));
const userInserts = (timeline: Timeline) =>
  ops(timeline).filter((op) => op.kind === "execute" && op.text.includes("INSERT INTO bms.users"));
const userUpdates = (timeline: Timeline) => ops(timeline).filter((op) => op.kind === "update" && op.table === "users");
const identityIndex = (timeline: Timeline, method: string, firstArg?: unknown) =>
  timeline.findIndex(
    (entry) => entry.source === "identity" && entry.method === method && (firstArg === undefined || entry.args[1] === firstArg || entry.args[0] === firstArg),
  );

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "  New.Person@Example.com ",
    displayName: "New Person",
    role: "viewer",
    organizationId: ORG_A,
    temporaryPassword: PASSWORD,
    ...overrides,
  };
}

// -- create -----------------------------------------------------------------

export async function assertKeycloakCreatePrecedesTheInsert(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.create(jwt, createBody());
  const created = timeline.findIndex((e) => e.source === "identity" && e.method === "createUser");
  const inserted = timeline.findIndex((e) => e.source === "db" && e.op.text.includes("INSERT INTO bms.users"));
  expect(created).toBeGreaterThanOrEqual(0);
  expect(created).toBeLessThan(inserted);
}

export async function assertTheInsertCarriesTheParsedId(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.create(jwt, createBody());
  const [insert] = userInserts(timeline);
  expect(insert?.params[5]).toBe("fake-kc-1");
}

export async function assertCreateEnablesKeycloakOnlyAfterTheInsert(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.create(jwt, createBody());
  const inserted = timeline.findIndex((e) => e.source === "db" && e.op.text.includes("INSERT INTO bms.users"));
  const enabled = timeline.findIndex((e) => e.source === "identity" && e.method === "setEnabled" && e.args[1] === true);
  expect(inserted).toBeGreaterThanOrEqual(0);
  expect(enabled).toBeGreaterThan(inserted);
}

export async function assertADbFailureDeletesExactlyTheParsedId(): Promise<void> {
  const { service, jwt, identity } = harness({ failInsert: true });
  await expect(service.create(jwt, createBody())).rejects.toThrow("the insert failed");
  expect(identity.calls.filter((call) => call.method === "deleteUser")).toEqual([
    { method: "deleteUser", args: ["fake-kc-1"] },
  ]);
}

export async function assertAFailingDeleteLogsTheIdAndNotTheEmail(): Promise<void> {
  const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  const { service, jwt, identity } = harness({ failInsert: true });
  identity.failNext("deleteUser", "unavailable");
  await expect(service.create(jwt, createBody())).rejects.toThrow("the insert failed");
  const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
  expect(logged).toContain("fake-kc-1");
  expect(logged).not.toContain("new.person@example.com");
}

export async function assertADuplicateEmailIs409BeforeKeycloak(): Promise<void> {
  const { service, jwt, identity } = harness();
  const err = await refusal(service.create(jwt, createBody({ email: VIEWER_A.email.toUpperCase() })));
  expect([err.getStatus(), err.message, identity.calls.length]).toEqual([409, DUPLICATE_EMAIL, 0]);
}

export async function assertAnAdminBodyWithAnOrganizationIs400BeforeKeycloak(): Promise<void> {
  const { service, jwt, identity } = harness();
  const err = await refusal(service.create(jwt, createBody({ role: "admin", organizationId: ORG_A })));
  expect([err.getStatus(), identity.calls.length]).toEqual([400, 0]);
}

export async function assertAnOrganizationAdminCreatingAnAdminIs403(): Promise<void> {
  const { service, jwt, identity } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.create(jwt, createBody({ role: "admin", organizationId: null })));
  expect([err.getStatus(), err.message, identity.calls.length]).toEqual([403, ADMIN_ROLE_ADMIN_ONLY, 0]);
}

export async function assertAnOrganizationAdminCreatingOutsideItsOrganizationsIsRefused(): Promise<void> {
  const { service, jwt, identity } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(service.create(jwt, createBody({ organizationId: ORG_B })));
  expect([err.getStatus(), err.message, identity.calls.length]).toEqual([403, ORGANIZATION_OUT_OF_SCOPE, 0]);
}

export async function assertCreatingAViewerInsertsUnderTheTargetsGuc(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.create(jwt, createBody());
  const [insert] = userInserts(timeline);
  const guc = ops(timeline).find((op) => op.text.includes("app.current_organization"));
  expect([insert?.executor, guc?.params[0]]).toEqual(["tenant.tx", ORG_A]);
}

export async function assertCreatingAnAdminInsertsOnTheFleetTransaction(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.create(jwt, createBody({ role: "admin", organizationId: null }));
  const [insert] = userInserts(timeline);
  expect(insert?.executor).toBe("fleet.tx");
}

// -- the admin-target rule and C1, per action -------------------------------

export type Action = "PATCH displayName" | "PATCH role" | "deactivate" | "reactivate" | "temporary-password";

function act(service: UsersService, jwt: JwtPayload, id: string, action: Action): Promise<unknown> {
  switch (action) {
    case "PATCH displayName":
      return service.update(jwt, id, { displayName: "Renamed" });
    case "PATCH role":
      return service.update(jwt, id, { role: "operator" });
    case "deactivate":
      return service.deactivate(jwt, id);
    case "reactivate":
      return service.reactivate(jwt, id);
    case "temporary-password":
      return service.temporaryPassword(jwt, id, { temporaryPassword: PASSWORD });
  }
}

async function assertHiddenTarget(target: UserRow, action: Action): Promise<void> {
  const { service, jwt, identity, timeline } = harness({ caller: ORG_ADMIN_CALLER });
  const err = await refusal(act(service, jwt, target.id, action));
  expect(err.getStatus()).toBe(404);
  expect(err.message).toBe(USER_NOT_FOUND);
  expect(JSON.stringify(err.getResponse())).not.toContain(target.email);
  expect(identity.calls).toEqual([]);
  expect(auditInserts(timeline)).toEqual([]);
}

/** `organization_admin` on an `admin` target: 404 that does not name it, Keycloak not called. */
export async function assertOrganizationAdminOnAnAdminTargetIsHidden(action: Action): Promise<void> {
  await assertHiddenTarget(ADMIN_TARGET, action);
}

/** C1: a home-org target granted another organization is outside an `organization_admin` of one. */
export async function assertOrganizationAdminOnACrossOrganizationTargetIsHidden(action: Action): Promise<void> {
  await assertHiddenTarget(VIEWER_A_GRANTED_B, action);
}

export async function assertTheRowsRoleDecidesNotTheTokens(): Promise<void> {
  const { service, jwt, timeline } = harness({ caller: ORG_ADMIN_CALLER, jwtRole: "admin" });
  const err = await refusal(service.deactivate(jwt, ADMIN_TARGET.id));
  expect(err.getStatus()).toBe(404);
  expect(ops(timeline).filter((op) => op.executor === "fleet.tx")).toEqual([]);
}

// -- list -------------------------------------------------------------------

export async function assertListAsOrganizationAdminExcludesAdminRows(): Promise<void> {
  const { service, jwt } = harness({ caller: ORG_ADMIN_CALLER });
  const ids = (await service.list(jwt)).items.map((item) => item.id);
  expect(ids, "positive control: an in-scope viewer is listed").toContain(VIEWER_A.id);
  expect(ids).not.toContain(ADMIN_TARGET.id);
}

export async function assertListAsOrganizationAdminExcludesAUserGrantedAnotherOrganization(): Promise<void> {
  const { service, jwt } = harness({ caller: ORG_ADMIN_CALLER });
  const ids = (await service.list(jwt)).items.map((item) => item.id);
  expect(ids, "positive control: an in-scope viewer is listed").toContain(VIEWER_A.id);
  expect(ids).not.toContain(VIEWER_A_GRANTED_B.id);
}

export async function assertListNeverCarriesAPasswordHash(): Promise<void> {
  const { service, jwt } = harness();
  const [item] = (await service.list(jwt)).items;
  expect(item).toBeDefined();
  expect(Object.keys(item ?? {})).not.toContain("passwordHash");
}

// -- self, last admin, boundary --------------------------------------------

export async function assertASelfRoleChangeIs403(): Promise<void> {
  const { service, jwt } = harness({ users: [...ALL_USERS] });
  const err = await refusal(service.update(jwt, ADMIN_CALLER.id, { role: "viewer", organizationId: ORG_A }));
  expect([err.getStatus(), err.message]).toEqual([403, SELF_ROLE_CHANGE]);
}

export async function assertASelfDeactivateIs403(): Promise<void> {
  const { service, jwt } = harness();
  const err = await refusal(service.deactivate(jwt, ADMIN_CALLER.id));
  expect([err.getStatus(), err.message]).toEqual([403, SELF_DEACTIVATE]);
}

export async function assertDemotingTheLastActiveAdminIsRefused(): Promise<void> {
  const { service, jwt, timeline } = harness({ activeAdmins: [ADMIN_TARGET.id] });
  const err = await refusal(service.update(jwt, ADMIN_TARGET.id, { role: "viewer", organizationId: ORG_A }));
  expect([err.getStatus(), err.message]).toEqual([409, LAST_ACTIVE_ADMIN]);
  expect(userUpdates(timeline)).toEqual([]);
}

export async function assertAnOrganizationWithoutABoundaryCrossingIs400(): Promise<void> {
  const { service, jwt, identity } = harness();
  const err = await refusal(service.update(jwt, VIEWER_A.id, { role: "operator", organizationId: ORG_A }));
  expect([err.getStatus(), identity.calls.length]).toEqual([400, 0]);
}

export async function assertToAdminWithAnOrganizationIs400(): Promise<void> {
  const { service, jwt, identity } = harness();
  const err = await refusal(service.update(jwt, VIEWER_A.id, { role: "admin", organizationId: ORG_A }));
  expect([err.getStatus(), identity.calls.length]).toEqual([400, 0]);
}

export async function assertAPromotionWritesOnTheFleetTransaction(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.update(jwt, VIEWER_A.id, { role: "admin", organizationId: null });
  const [update] = userUpdates(timeline);
  expect([update?.executor, update?.values?.role, update?.values?.organizationId]).toEqual(["fleet.tx", "admin", null]);
}

export async function assertARoleChangeMirrorsToKeycloakBeforeTheDb(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.update(jwt, VIEWER_A.id, { role: "operator" });
  const mirrored = timeline.findIndex((e) => e.source === "identity" && e.method === "setRealmRole");
  const updated = timeline.findIndex((e) => e.source === "db" && e.op.kind === "update" && e.op.table === "users");
  expect(mirrored).toBeGreaterThanOrEqual(0);
  expect(mirrored).toBeLessThan(updated);
}

export async function assertARoleChangeDbFailureUndoesKeycloak(): Promise<void> {
  const { service, jwt, identity } = harness({ emptyUpdate: true });
  await refusal(service.update(jwt, VIEWER_A.id, { role: "operator" }));
  expect(identity.calls.filter((call) => call.method === "setRealmRole")).toEqual([
    { method: "setRealmRole", args: [VIEWER_A.subject, "operator"] },
    { method: "setRealmRole", args: [VIEWER_A.subject, "viewer"] },
  ]);
}

// -- unlinked ---------------------------------------------------------------

export type UnlinkedAction = "update" | "deactivate" | "reactivate" | "temporary-password";

export async function assertAnUnlinkedTargetIs409(action: UnlinkedAction): Promise<void> {
  const { service, jwt, identity } = harness();
  const call =
    action === "update"
      ? service.update(jwt, UNLINKED_A.id, { displayName: "Renamed" })
      : action === "deactivate"
        ? service.deactivate(jwt, UNLINKED_A.id)
        : action === "reactivate"
          ? service.reactivate(jwt, UNLINKED_A.id)
          : service.temporaryPassword(jwt, UNLINKED_A.id, { temporaryPassword: PASSWORD });
  const err = await refusal(call);
  expect([err.getStatus(), err.message, identity.calls.length]).toEqual([409, UNLINKED_USER, 0]);
}

// -- deactivate -------------------------------------------------------------

export async function assertDeactivateStampsAndNotifiesBeforeDisablingKeycloak(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.deactivate(jwt, VIEWER_A.id);
  const stamped = timeline.findIndex((e) => e.source === "db" && e.op.kind === "update" && e.op.table === "users");
  const notified = timeline.findIndex((e) => e.source === "db" && e.op.text.includes("pg_notify"));
  const disabled = identityIndex(timeline, "setEnabled", false);
  expect(stamped).toBeGreaterThanOrEqual(0);
  expect(notified).toBeGreaterThan(stamped);
  expect(disabled).toBeGreaterThan(notified);
}

export async function assertARepeatedDeactivateWritesOneAlreadyDisabledAuditRow(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.deactivate(jwt, DISABLED_A.id);
  expect(auditInserts(timeline).map((op) => op.values?.payload)).toEqual([{ alreadyDisabled: true }]);
}

export async function assertARepeatedDeactivateSkipsTheUpdateAndTheNotify(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.deactivate(jwt, DISABLED_A.id);
  expect(auditInserts(timeline), "positive control: the retry is audited").toHaveLength(1);
  expect([userUpdates(timeline).length, notifies(timeline).length]).toEqual([0, 0]);
}

export async function assertARepeatedDeactivateStillDisablesKeycloakAndEndsSessions(): Promise<void> {
  const { service, jwt, identity } = harness();
  await service.deactivate(jwt, DISABLED_A.id);
  expect(identity.calls.map((call) => call.method)).toEqual(["setEnabled", "logoutSessions"]);
}

export async function assertAnEmptyDeactivateUpdateThrows(): Promise<void> {
  const { service, jwt } = harness({ emptyUpdate: true });
  const err = await refusal(service.deactivate(jwt, VIEWER_A.id));
  expect([err.getStatus(), err.message]).toEqual([409, CHANGED_UNDER_YOU]);
}

export async function assertAnEmptyDeactivateUpdateWritesNoAudit(): Promise<void> {
  const { service, jwt, timeline } = harness({ emptyUpdate: true });
  await refusal(service.deactivate(jwt, VIEWER_A.id));
  expect(userUpdates(timeline), "positive control: the update was attempted").toHaveLength(1);
  expect(auditInserts(timeline)).toEqual([]);
}

export async function assertAnEmptyDeactivateUpdateSendsNoNotify(): Promise<void> {
  const { service, jwt, timeline } = harness({ emptyUpdate: true });
  await refusal(service.deactivate(jwt, VIEWER_A.id));
  expect(userUpdates(timeline), "positive control: the update was attempted").toHaveLength(1);
  expect(notifies(timeline)).toEqual([]);
}

export async function assertAKeycloakFailureOnDeactivateIsAFollowUp(): Promise<void> {
  const { service, jwt, identity } = harness();
  identity.failNext("setEnabled", "unavailable");
  const response = await service.deactivate(jwt, VIEWER_A.id);
  expect(response.followUp).toBe("keycloak_disable_failed");
}

// -- reactivate -------------------------------------------------------------

export async function assertReactivatingAnActiveRowWritesOneUnclearedAuditRow(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.reactivate(jwt, VIEWER_A.id);
  expect(auditInserts(timeline).map((op) => op.values?.payload)).toEqual([{ clearedDisabledAt: false }]);
}

export async function assertReactivatingAnActiveRowEnablesKeycloak(): Promise<void> {
  const { service, jwt, identity } = harness();
  await service.reactivate(jwt, VIEWER_A.id);
  expect(identity.calls).toEqual([{ method: "setEnabled", args: [VIEWER_A.subject, true] }]);
}

// -- temporary password -----------------------------------------------------

export async function assertAShortTemporaryPasswordIsRefusedByTheSchema(): Promise<void> {
  const { service, jwt, identity } = harness();
  const err = await refusal(service.temporaryPassword(jwt, VIEWER_A.id, { temporaryPassword: "eleven-char" }));
  expect([err.getStatus(), identity.calls.length]).toEqual([400, 0]);
}

export async function assertTheTemporaryPasswordAuditHasNoPassword(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await service.temporaryPassword(jwt, VIEWER_A.id, { temporaryPassword: PASSWORD });
  const audits = auditInserts(timeline);
  expect(audits, "positive control: the action is audited").toHaveLength(1);
  expect(Object.keys((audits[0]?.values?.payload ?? {}) as object)).not.toContain("temporaryPassword");
  expect(JSON.stringify(audits[0]?.values)).not.toContain(PASSWORD);
}

export async function assertTheTemporaryPasswordEndsTheSessions(): Promise<void> {
  const { service, jwt, identity } = harness();
  await service.temporaryPassword(jwt, VIEWER_A.id, { temporaryPassword: PASSWORD });
  expect(identity.calls.map((call) => call.method)).toEqual(["setTemporaryPassword", "logoutSessions"]);
}

// -- local mode and not configured -----------------------------------------

export async function assertLocalModeIs409WithKeycloakUntouched(): Promise<void> {
  const { service, jwt, identity } = harness({ authMode: "local" });
  const err = await refusal(service.create(jwt, createBody()));
  expect([err.getStatus(), err.message, identity.calls.length]).toEqual([409, LOCAL_MODE_READ_ONLY, 0]);
}

export async function assertNotConfiguredIs503(): Promise<void> {
  const { service, jwt, identity } = harness();
  identity.failNext("createUser", "not_configured" satisfies IdentityAdminFailureReason);
  const err = await refusal(service.create(jwt, createBody()));
  expect([err.getStatus(), err.message]).toEqual([503, NOT_CONFIGURED]);
}

export async function assertNotConfiguredStillServesTheList(): Promise<void> {
  const { service, jwt, identity } = harness();
  identity.failNext("createUser", "not_configured");
  await refusal(service.create(jwt, createBody()));
  expect((await service.list(jwt)).items.length).toBeGreaterThan(0);
}
