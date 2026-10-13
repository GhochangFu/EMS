import { ForbiddenException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import { Column, getTableName, is, type SQL } from "drizzle-orm";
import { expect } from "vitest";

import { onboardingSessions, users } from "@bms/db";
import { ONBOARDING_DRAFT_LIST_LIMIT } from "@bms/shared";

import { OnboardingService } from "./onboarding.service";

/**
 * `F4.255` (ADR 0099 Amendment 2 A1) — `OnboardingService.listDrafts`, the
 * organization's open onboarding drafts for the copilot dock. The access is
 * `assertOnboardingAccess`, applied to the organization the caller names, so a
 * scoped administrator naming another organization is the **403** of
 * `createSession` (not `F4.256`'s by-id 404 — the id is the caller's own
 * input); the global administrator naming an unknown organization gets the
 * organization read's 404. The list reads on `fleetDb` and never selects the
 * `draft` column — it takes one JSON path, so `_secrets` never leave the
 * query. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

type Role = "admin" | "organization_admin" | "location_admin" | "asset_group_admin";

const JWT = { sub: "kc-1" } as never;
const ORG = "22222222-2222-4222-8222-222222222222";
const dialect = new PgDialect();

type DraftRow = {
  id: string;
  organizationId: string;
  currentPhase: string;
  createdAt: Date;
  updatedAt: Date;
  locationName: string | null;
  createdById: string | null;
  createdByName: string | null;
};

const ROW: DraftRow = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: ORG,
  currentPhase: "rtu",
  createdAt: new Date("2026-10-13T00:00:00.000Z"),
  updatedAt: new Date("2026-10-13T00:05:00.000Z"),
  locationName: "Berhampur",
  createdById: "33333333-3333-4333-8333-333333333333",
  createdByName: "Asha",
};

function serviceAs(role: Role, options: { canManage?: boolean; orgExists?: boolean; rows?: DraftRow[] } = {}) {
  const reads = { select: 0, tenantSelect: 0, fleetSelect: 0 };
  const recorded = {
    projection: undefined as Record<string, unknown> | undefined,
    from: [] as unknown[],
    leftJoin: [] as unknown[],
    joinOn: undefined as SQL | undefined,
    where: undefined as SQL | undefined,
    orderBy: [] as unknown[],
    limit: undefined as number | undefined,
  };
  const orgChain = {
    from: () => orgChain,
    where: () => orgChain,
    limit: () => Promise.resolve(options.orgExists === false ? [] : [{ id: ORG, code: "ORG", name: "Org" }]),
  };
  const tenantDb = {
    select: () => {
      reads.select += 1;
      reads.tenantSelect += 1;
      return orgChain;
    },
  };
  const listChain = {
    from: (table: unknown) => {
      recorded.from.push(table);
      return listChain;
    },
    leftJoin: (table: unknown, on: SQL) => {
      recorded.leftJoin.push(table);
      recorded.joinOn = on;
      return listChain;
    },
    where: (condition: SQL) => {
      recorded.where = condition;
      return listChain;
    },
    orderBy: (...order: unknown[]) => {
      recorded.orderBy.push(...order);
      return listChain;
    },
    limit: (n: number) => {
      recorded.limit = n;
      return Promise.resolve(options.rows ?? [ROW]);
    },
  };
  const fleetDb = {
    select: (projection: Record<string, unknown>) => {
      reads.select += 1;
      reads.fleetSelect += 1;
      recorded.projection = projection;
      return listChain;
    },
  };
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role }),
    canManageOrganization: () => Promise.resolve(options.canManage ?? true),
  };
  const none = {} as never;
  const service = new OnboardingService(
    fleetDb as never,
    tenantDb as never,
    accessControl as never,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  );
  return { service, reads, recorded };
}

function rendered(condition: SQL | undefined) {
  if (!condition) throw new Error("the list recorded no condition");
  return dialect.sqlToQuery(condition);
}

/** L1 — a location administrator is refused with the role sentence before any read. */
export async function aLocationAdminCannotListDrafts(): Promise<void> {
  const { service, reads } = serviceAs("location_admin");
  await expect(service.listDrafts(JWT, ORG)).rejects.toThrow(
    new ForbiddenException("Onboarding requires admin or organization_admin role"),
  );
  expect(reads.select).toBe(0);
}

/** L2 — an organization outside the caller's scope is the 403 scope sentence (not a 404), before any read. */
export async function anOrganizationOutsideTheScopeIsA403(): Promise<void> {
  const { service, reads } = serviceAs("organization_admin", { canManage: false });
  await expect(service.listDrafts(JWT, ORG)).rejects.toThrow(
    new ForbiddenException("Organization is outside your access scope"),
  );
  expect(reads.select).toBe(0);
}

/** L3 — the global administrator naming an unknown organization gets 404, and the list is not read. */
export async function anUnknownOrganizationIsA404(): Promise<void> {
  const { service, reads } = serviceAs("admin", { orgExists: false });
  await expect(service.listDrafts(JWT, ORG)).rejects.toThrow(new NotFoundException("Organization not found"));
  expect(reads.fleetSelect).toBe(0);
}

/** L4a — the list keeps only drafts: the condition names the status column and binds `draft`. */
export async function theListKeepsOnlyDrafts(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  const query = rendered(recorded.where);
  expect(query.sql).toContain('"onboarding_sessions"."status" = $');
  expect(query.params).toContain("draft");
}

/** L4b — the list keeps only the named organization: the condition names the column and binds the id. */
export async function theListKeepsOnlyTheNamedOrganization(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  const query = rendered(recorded.where);
  expect(query.sql).toContain('"onboarding_sessions"."organization_id" = $');
  expect(query.params).toContain(ORG);
}

/** L5 — the projection never takes the `draft` column; the location name is one JSON path out of it. */
export async function theListNeverSelectsTheDraft(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  const projection = recorded.projection ?? {};
  expect(Object.values(projection)).not.toContain(onboardingSessions.draft);
  // The positive beside the absence: the name is read by path, not by taking the draft.
  expect(dialect.sqlToQuery(projection.locationName as SQL).sql).toContain("->'location'->>'name'");
}

/** L6 — a row with no starter maps to `createdBy: null`; a row with one maps to `{ id, displayName }`. */
export async function theStarterMapsToNullOrTheUser(): Promise<void> {
  const legacy = { ...ROW, id: "44444444-4444-4444-8444-444444444444", createdById: null, createdByName: null };
  const { service } = serviceAs("organization_admin", { rows: [ROW, legacy] });
  const list = await service.listDrafts(JWT, ORG);
  expect(list.items.map((item) => item.createdBy)).toEqual([{ id: ROW.createdById, displayName: "Asha" }, null]);
}

/** L7a — the list reads the sessions and joins the starter from `users`. */
export async function theListJoinsTheStarterFromUsers(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  expect(recorded.from).toEqual([onboardingSessions]);
  expect(recorded.leftJoin).toEqual([users]);
}

/**
 * L7d — the join condition is `users.id = onboarding_sessions.created_by`,
 * rendered, with no bound parameter. Recording only the joined table left a
 * join on any column green.
 */
export async function theJoinMatchesTheStarterColumn(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  const query = rendered(recorded.joinOn);
  expect(query.sql).toBe('"bms"."users"."id" = "bms"."onboarding_sessions"."created_by"');
  expect(query.params).toEqual([]);
}

/** L7e — each column of the projection is the intended table column (the JSON path is L5's). */
export async function eachProjectedColumnIsTheIntendedOne(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  const columns = Object.fromEntries(
    Object.entries(recorded.projection ?? {}).map(([key, value]) => [
      key,
      is(value, Column) ? `${getTableName(value.table)}.${value.name}` : "(sql)",
    ]),
  );
  expect(columns).toEqual({
    id: "onboarding_sessions.id",
    organizationId: "onboarding_sessions.organization_id",
    currentPhase: "onboarding_sessions.current_phase",
    createdAt: "onboarding_sessions.created_at",
    updatedAt: "onboarding_sessions.updated_at",
    locationName: "(sql)",
    createdById: "users.id",
    createdByName: "users.display_name",
  });
}

/**
 * L9 — the answer is parsed on the server through `parseStoredContract`: a
 * stored phase outside the enum is the 500 server fault (ADR 0060 ruling 2),
 * never a response and never the `ZodErrorFilter`'s 400.
 */
export async function anUnknownPhaseFailsTheServerParse(): Promise<void> {
  const { service } = serviceAs("organization_admin", { rows: [{ ...ROW, currentPhase: "bogus" }] });
  await expect(service.listDrafts(JWT, ORG)).rejects.toThrow(
    new InternalServerErrorException("Stored data does not match its contract: onboarding.list_drafts.dto"),
  );
}

/** L7b — the list is newest update first. */
export async function theListIsNewestUpdateFirst(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  expect(recorded.orderBy.map((o) => dialect.sqlToQuery(o as SQL).sql)).toEqual(['"bms"."onboarding_sessions"."updated_at" desc']);
}

/** L7c — the list is bounded by the shared limit. */
export async function theListIsBoundedByTheSharedLimit(): Promise<void> {
  const { service, recorded } = serviceAs("organization_admin");
  await service.listDrafts(JWT, ORG);
  expect(recorded.limit).toBe(ONBOARDING_DRAFT_LIST_LIMIT);
}

/** L8 — the answer is the summary DTO: ISO dates, the location name, the phase, and no `draft` key. */
export async function theListAnswersTheSummary(): Promise<void> {
  const { service } = serviceAs("organization_admin");
  const list = await service.listDrafts(JWT, ORG);
  expect(list).toEqual({
    items: [
      {
        id: ROW.id,
        organizationId: ORG,
        currentPhase: "rtu",
        locationName: "Berhampur",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:05:00.000Z",
        createdBy: { id: ROW.createdById, displayName: "Asha" },
      },
    ],
  });
}
