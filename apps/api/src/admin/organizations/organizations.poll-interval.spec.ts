import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { adminOrganizationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { OrganizationsAdminController } from "./organizations.controller";
import { OrganizationsAdminService } from "./organizations.service";

/**
 * `F1.2` (ADR 0141 decision 10, Amendment 1 (c), plan T7.3) — `setPollInterval`'s control flow
 * on fakes: the gate runs before any read, an unchanged value writes nothing, and a change writes
 * one audit row with `{ from, to }` on the tenant transaction, in the organization. What Postgres
 * holds is `organizations.poll-interval.integration.spec.ts`'s. The sibling `.test.ts` carries the
 * `it()`s.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const JWT = { sub: "u", email: "a@bms.local", role: "admin" } as JwtPayload;

function row(defaultPollIntervalMs: number | null) {
  return {
    id: ID,
    code: "F12PI",
    name: "F1.2 poll interval",
    active: true,
    meta: null,
    currency: "INR",
    timezone: "UTC",
    colourProfile: null,
    designSystem: null,
    ingestEnabled: true,
    energyFeatures: "auto",
    cardPrimaryMetric: "auto",
    defaultPollIntervalMs,
    createdAt: new Date(0),
  };
}

type Harness = {
  svc: OrganizationsAdminService;
  events: string[];
  audits: Array<{ entry: Record<string, unknown>; executor: unknown }>;
};

function harness(organizationLevelAdmin: boolean, stored: number | null): Harness {
  const events: string[] = [];
  const audits: Harness["audits"] = [];
  let current = row(stored);
  const tx = {
    execute: async () => {
      events.push("set-guc");
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async (mode: string) => {
              events.push(`select for ${mode}`);
              return [current];
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: { defaultPollIntervalMs: number | null }) => ({
        where: () => ({
          returning: async () => {
            events.push(`update ${String(values.defaultPollIntervalMs)}`);
            current = { ...current, ...values };
            return [current];
          },
        }),
      }),
    }),
  };
  const tenantDb = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      events.push("tx");
      return fn(tx);
    },
  } as unknown as BmsDb;
  const access = {
    requireMasterDataUser: async () => {
      events.push("requireMasterDataUser");
      return { role: "organization_admin" };
    },
    isOrganizationLevelAdmin: async () => {
      events.push("isOrganizationLevelAdmin");
      return organizationLevelAdmin;
    },
  } as unknown as AccessControlService;
  const audit = {
    write: async (entry: Record<string, unknown>, executor: unknown) => {
      events.push("audit");
      audits.push({ entry, executor });
    },
  } as unknown as MasterDataAuditService;
  return { svc: new OrganizationsAdminService({ fleet: true } as unknown as BmsDb, tenantDb, access, audit), events, audits };
}

/** P1 — a caller the organization-level gate refuses is a 403 before any read or transaction. */
export async function runTheGateRunsBeforeAnyRead(): Promise<void> {
  const h = harness(false, null);
  await expect(h.svc.setPollInterval(JWT, ID, { defaultPollIntervalMs: 60_000 })).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.events).toEqual(["requireMasterDataUser", "isOrganizationLevelAdmin"]);
  expect(h.audits).toEqual([]);
}

/** P2 — the stored value again: the row is returned, no `UPDATE`, no audit row. */
export async function runAnUnchangedValueWritesNothing(): Promise<void> {
  for (const value of [null, 30_000]) {
    const h = harness(true, value);
    const dto = await h.svc.setPollInterval(JWT, ID, { defaultPollIntervalMs: value });
    expect(dto.defaultPollIntervalMs).toBe(value);
    expect(h.events.filter((e) => e.startsWith("update") || e === "audit")).toEqual([]);
  }
}

/** P3 — a change locks the row, writes it, and audits `{ from, to }` in the organization on the same transaction. */
export async function runAChangeIsWrittenAndAudited(): Promise<void> {
  const h = harness(true, 30_000);
  const dto = await h.svc.setPollInterval(JWT, ID, { defaultPollIntervalMs: null });
  expect(adminOrganizationDtoSchema.parse(dto).defaultPollIntervalMs).toBeNull();
  expect(h.events).toEqual([
    "requireMasterDataUser",
    "isOrganizationLevelAdmin",
    "tx",
    "set-guc",
    "select for update",
    "update null",
    "audit",
  ]);
  expect(h.audits).toHaveLength(1);
  expect(h.audits[0]!.entry).toMatchObject({
    action: "master.organization.poll_interval.update",
    entityType: "organization",
    entityId: ID,
    organizationId: ID,
    payload: { from: 30_000, to: null },
  });
  expect(h.audits[0]!.executor).not.toEqual({ fleet: true });
}

/** P4 — the controller answers 400 for a body the contract refuses, before the service runs. */
export async function runTheControllerRefusesABadBody(): Promise<void> {
  const calls: unknown[] = [];
  const service = {
    setPollInterval: async (...args: unknown[]) => {
      calls.push(args);
      return {};
    },
  } as unknown as OrganizationsAdminService;
  const controller = new OrganizationsAdminController(service);
  for (const body of [{ defaultPollIntervalMs: 999 }, { defaultPollIntervalMs: 4_000_000 }, {}, { defaultPollIntervalMs: null, x: 1 }]) {
    await expect(controller.setPollInterval(ID, body, JWT)).rejects.toBeInstanceOf(BadRequestException);
  }
  expect(calls).toEqual([]);
  await controller.setPollInterval(ID, { defaultPollIntervalMs: 120_000 }, JWT);
  expect(calls).toEqual([[JWT, ID, { defaultPollIntervalMs: 120_000 }]]);
}
