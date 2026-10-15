import { ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import { copilotOrgSettings } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { PutCopilotAccessBody } from "./copilot-access.schema";
import {
  COPILOT_ATTACHMENTS_NEEDS_ORG_SWITCH_MESSAGE,
  COPILOT_ORG_SWITCH_MESSAGE,
  CopilotAccessService,
  type OverrideTarget,
} from "./copilot-access.service";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin" | "operator";

const jwt = (role: Role): JwtPayload => ({ sub: `user-${role}`, email: `${role}@example.test`, role }) as JwtPayload;

/**
 * The access-control fake answers like the real service for a user whose home
 * organization is A: the global admin manages everything, an
 * `organization_admin` holds a direct grant on A, and every other role is
 * `false` from the role alone. `canManageOrganization` answers `true` for every
 * role, as the real one does for a `location_admin` holding a node in A — so a
 * gate that trusts it alone lets the scoped roles through, and the specs below
 * go red.
 */
function harness(targets: Record<string, OverrideTarget | null> = {}) {
  const calls: string[] = [];
  const accessControl = {
    requireMasterDataUser: async (token: JwtPayload) => {
      if (token.role === "operator" || token.role === "viewer") {
        throw new ForbiddenException("master data requires an administrator role");
      }
      return { id: token.sub, email: token.email, displayName: token.sub, role: token.role };
    },
    isOrganizationLevelAdmin: async (token: JwtPayload, organizationId: string) =>
      token.role === "admin" || (token.role === "organization_admin" && organizationId === ORG_A),
    canManageOrganization: async () => true,
  } as unknown as AccessControlService;
  const audit = {
    write: async () => {
      calls.push("audit");
    },
  } as unknown as MasterDataAuditService;
  const tenantDb = {
    transaction: async () => {
      calls.push("transaction");
      throw new Error("the refusal must come before any tenant transaction");
    },
  };
  const authDb = {
    select: () => {
      throw new Error("the spec replaces loadOverrideTarget; the auth pool is not read");
    },
  };
  const service = new CopilotAccessService(tenantDb as never, authDb as never, accessControl, audit);
  service.loadOverrideTarget = async (userId: string) => {
    calls.push(`target:${userId}`);
    return targets[userId] ?? null;
  };
  return { service, calls };
}

async function refused(run: () => Promise<unknown>): Promise<ForbiddenException> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return error as ForbiddenException;
  }
  throw new Error("expected a 403");
}

/** Operators and viewers are refused before anything else is read. */
export async function assertAnOperatorIsRefusedOnGetAndPut(): Promise<void> {
  const { service, calls } = harness();
  await refused(() => service.get(jwt("operator"), ORG_A));
  await refused(() => service.put(jwt("operator"), ORG_A, { enabled: true }));
  expect(calls).toEqual([]);
}

/**
 * Plan §5.2 / security review H1: the role is checked **before**
 * `isOrganizationLevelAdmin`, and never `canManageOrganization`, which admits a
 * `location_admin` in every organization where it holds one node. Mutation:
 * gate on `canManageOrganization` alone → these three go green → red.
 */
export async function assertScopedAdministratorsCannotReadTheSettings(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.get(jwt(role), ORG_A));
    expect(calls, role).toEqual([]);
  }
}

export async function assertScopedAdministratorsCannotSetARoleSwitch(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.put(jwt(role), ORG_A, { roles: { [role]: true } }));
    expect(calls, role).toEqual([]);
  }
}

export async function assertScopedAdministratorsCannotSetTheirOwnException(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const self: OverrideTarget = { organizationId: ORG_A, role };
    const { service, calls } = harness({ [`user-${role}`]: self });
    const body: PutCopilotAccessBody = { override: { userId: `user-${role}`, allow: true } };
    await refused(() => service.put(jwt(role), ORG_A, body));
    expect(calls, role).toEqual([]);
  }
}

/** An organization admin of A administers A only. */
export async function assertAnOrganizationAdminIsRefusedForAnotherOrganization(): Promise<void> {
  const { service, calls } = harness();
  await refused(() => service.get(jwt("organization_admin"), ORG_B));
  await refused(() => service.put(jwt("organization_admin"), ORG_B, { roles: { location_admin: false } }));
  expect(calls).toEqual([]);
}

/** Ruling 15 / drafter choice 7: only the global admin switches an organization on or off. */
export async function assertOnlyTheGlobalAdminSetsTheOrganizationSwitch(): Promise<void> {
  const { service, calls } = harness();
  const error = await refused(() => service.put(jwt("organization_admin"), ORG_A, { enabled: true }));
  expect(error.message).toMatch(/global admin/i);
  expect(calls).toEqual([]);
}

/**
 * An exception may name only an administrator whose home organization is this
 * one. A user that does not exist and a user of another organization get the
 * **same** answer, so the route cannot be used to learn which ids exist
 * elsewhere (security review note on PR 3). No row is written either way.
 */
export async function assertAnExceptionForAnUnknownOrForeignUserGetsOneAnswer(): Promise<void> {
  const foreign: OverrideTarget = { organizationId: ORG_B, role: "location_admin" };
  const { service, calls } = harness({ "user-foreign": foreign });
  const unknown = await refused(() =>
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-missing", allow: true } }),
  );
  const other = await refused(() =>
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-foreign", allow: true } }),
  );
  expect(other.getStatus()).toBe(unknown.getStatus());
  expect(other.getResponse()).toEqual(unknown.getResponse());
  expect(calls).toEqual(["target:user-missing", "target:user-foreign"]);
}

/** An exception names an administrator; an operator of this organization is refused the same way. */
export async function assertAnExceptionForANonAdministratorIsRefused(): Promise<void> {
  const operator: OverrideTarget = { organizationId: ORG_A, role: "operator" };
  const { service, calls } = harness({ "user-op": operator });
  await refused(() => service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-op", allow: true } }));
  expect(calls).toEqual(["target:user-op"]);
}

/**
 * Security and code review (PR 3): removing an exception only narrows, so it
 * must not depend on the user still qualifying — a user demoted or moved away
 * left a stale row that the card listed and could not remove. A remove passes
 * the gate and reaches the transaction without reading the target.
 * Mutation: check the target on a remove too → red.
 */
export async function assertAStaleExceptionCanBeRemoved(): Promise<void> {
  const demoted: OverrideTarget = { organizationId: ORG_A, role: "operator" };
  const { service, calls } = harness({ "user-demoted": demoted });
  await expect(
    service.put(jwt("organization_admin"), ORG_A, { override: { userId: "user-demoted", allow: null } }),
  ).rejects.toThrow("the refusal must come before any tenant transaction");
  expect(calls).toEqual(["transaction"]);
}

/** A scoped administrator cannot set the organization switch either. */
export async function assertScopedAdministratorsCannotSetTheOrganizationSwitch(): Promise<void> {
  for (const role of ["location_admin", "asset_group_admin"] as const) {
    const { service, calls } = harness();
    await refused(() => service.put(jwt(role), ORG_A, { enabled: true }));
    expect(calls, role).toEqual([]);
  }
}

/** The organization switch row as the fake store holds it; `null` is no row. */
interface OrgRow {
  enabled: boolean;
  attachmentsEnabled: boolean;
}

/**
 * A working tenant pool over one organization's `copilot_org_settings` row, for
 * the A7 write rules. It records every write by kind (`insert:org`,
 * `update:org`) and applies the column defaults a real insert would: a row
 * inserted without `enabled` gets `false`, as `0104`'s DEFAULT does. The
 * predicates are not evaluated — the store holds one organization only.
 */
function storeHarness(initial: OrgRow | null) {
  const { service, calls } = harness();
  const store: { row: OrgRow | null; writes: string[]; audits: unknown[] } = {
    row: initial ? { ...initial } : null,
    writes: [],
    audits: [],
  };
  const isOrg = (table: unknown) => table === copilotOrgSettings;
  const tx = {
    execute: async () => undefined,
    select: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = isOrg(table) && store.row ? [pick(store.row, fields)] : [];
          return Object.assign(Promise.resolve(rows), { orderBy: async () => rows });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          if (!isOrg(table)) throw new Error("only the organization switch is written here");
          store.writes.push("insert:org");
          store.row = store.row
            ? { ...store.row, ...columnsOf(set) }
            : { enabled: false, attachmentsEnabled: false, ...columnsOf(values) };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: unknown) => ({
          returning: async () => {
            if (!isOrg(table)) throw new Error("only the organization switch is updated here");
            // An UPDATE with no predicate would reach every row the role can see.
            if (predicate === undefined) throw new Error("the organization admin's UPDATE names its row");
            store.writes.push("update:org");
            if (!store.row) return [];
            store.row = { ...store.row, ...columnsOf(values) };
            return [{ organizationId: ORG_A }];
          },
        }),
      }),
    }),
  };
  (service as unknown as { tenantDb: unknown }).tenantDb = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      calls.push("transaction");
      const before = store.row ? { ...store.row } : null;
      const writes = store.writes.length;
      try {
        return await fn(tx);
      } catch (error) {
        store.row = before;
        store.writes.length = writes;
        throw error;
      }
    },
  };
  (service as unknown as { audit: unknown }).audit = {
    write: async (entry: { payload: unknown }) => {
      store.audits.push(entry.payload);
    },
  };
  return { service, calls, store };
}

/** The switch columns of a write's values; the stamp is dropped. */
function columnsOf(values: Record<string, unknown>): Partial<OrgRow> {
  const out: Partial<OrgRow> = {};
  if (typeof values.enabled === "boolean") out.enabled = values.enabled;
  if (typeof values.attachmentsEnabled === "boolean") out.attachmentsEnabled = values.attachmentsEnabled;
  return out;
}

function pick(row: OrgRow, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, row[key as keyof OrgRow]]));
}

/**
 * Plan D3 / ADR 0099 Amendment 3 A7: the organization admin's
 * `attachmentsEnabled` write on an organization with **no** switch row is a
 * 409 and writes nothing — it may never create the row, because a created row
 * would carry an `enabled` the organization admin may not set.
 * Mutation: replace the UPDATE by the upsert → no 409, a row → red.
 */
export async function assertAnOrganizationAdminsAttachmentWriteWithNoRowIs409(): Promise<void> {
  const { service, store } = storeHarness(null);
  let caught: unknown;
  try {
    await service.put(jwt("organization_admin"), ORG_A, { attachmentsEnabled: true });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConflictException);
  expect((caught as ConflictException).message).toBe(COPILOT_ATTACHMENTS_NEEDS_ORG_SWITCH_MESSAGE);
  expect(store.row).toBeNull();
  expect(store.writes).not.toContain("insert:org");
  expect(store.audits).toEqual([]);
}

/**
 * The organization admin's write on an existing row updates the attachment
 * switch only: it is an UPDATE, never an insert, and `enabled` keeps its value.
 */
export async function assertAnOrganizationAdminSetsAttachmentsOnAnExistingRowOnly(): Promise<void> {
  const { service, store } = storeHarness({ enabled: true, attachmentsEnabled: false });
  const dto = await service.put(jwt("organization_admin"), ORG_A, { attachmentsEnabled: true });
  expect(store.writes).toEqual(["update:org"]);
  expect(store.row).toEqual({ enabled: true, attachmentsEnabled: true });
  expect(dto.attachmentsEnabled).toBe(true);
  expect(dto.enabled).toBe(true);
}

/** Sending `enabled` beside `attachmentsEnabled` is still the global admin's switch: 403, nothing written. */
export async function assertAnOrganizationAdminCannotSendEnabledWithAttachments(): Promise<void> {
  const { service, calls, store } = storeHarness({ enabled: true, attachmentsEnabled: false });
  const error = await refused(() =>
    service.put(jwt("organization_admin"), ORG_A, { enabled: false, attachmentsEnabled: true }),
  );
  expect(error.message).toBe(COPILOT_ORG_SWITCH_MESSAGE);
  expect(calls).toEqual([]);
  expect(store.row).toEqual({ enabled: true, attachmentsEnabled: false });
}

/**
 * Ruling Q3(a): the global admin's write on an organization with no row
 * creates it with `enabled` at its default **false** — attachments on, the
 * copilot still off. Mutation: write `enabled: true` on the insert → red.
 */
export async function assertTheGlobalAdminsAttachmentWriteCreatesTheRowOff(): Promise<void> {
  const { service, store } = storeHarness(null);
  const dto = await service.put(jwt("admin"), ORG_A, { attachmentsEnabled: true });
  expect(store.writes).toEqual(["insert:org"]);
  expect(store.row).toEqual({ enabled: false, attachmentsEnabled: true });
  expect(dto.enabled).toBe(false);
  expect(dto.attachmentsEnabled).toBe(true);
}

/** The global admin's upsert on an existing row leaves `enabled` as it was. */
export async function assertTheGlobalAdminsAttachmentWriteKeepsEnabled(): Promise<void> {
  const { service, store } = storeHarness({ enabled: true, attachmentsEnabled: true });
  await service.put(jwt("admin"), ORG_A, { attachmentsEnabled: false });
  expect(store.row).toEqual({ enabled: true, attachmentsEnabled: false });
}

/** The audit row names the attachment switch the write set. */
export async function assertTheAuditPayloadCarriesAttachmentsEnabled(): Promise<void> {
  const { service, store } = storeHarness({ enabled: true, attachmentsEnabled: false });
  await service.put(jwt("organization_admin"), ORG_A, { attachmentsEnabled: true });
  expect(store.audits).toEqual([
    expect.objectContaining({ attachmentsEnabled: true }),
  ]);
}

/** No row reads as attachments off, as it reads as the copilot off. */
export async function assertNoRowReadsAsAttachmentsOff(): Promise<void> {
  const { service } = storeHarness(null);
  const dto = await service.get(jwt("admin"), ORG_A);
  expect(dto.enabled).toBe(false);
  expect(dto.attachmentsEnabled).toBe(false);
}
