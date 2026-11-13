import "reflect-metadata";

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, UserRole } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { canPerformOperationsWrite, operationsWriteDenialReason, type OperationsWriteClass } from "../auth/operations-write";
import { MaintenanceWindowsController } from "./maintenance-windows.controller";
import type { MaintenanceWindowsService } from "./maintenance-windows.service";

/**
 * `F4.359` U3 (ADR 0131 decision 13, plan Q5) — the maintenance-window
 * controller against a stubbed gate and a stubbed service: who may write, the
 * gate order, a bad body, and the three readable sets the list passes on.
 * Assertions live here; the sibling `.test.ts` runs them (ADR 0014). The real
 * scope rules are `maintenance-windows.service.rls.integration.spec.ts`'s.
 */

const WINDOW_ID = "70000000-0000-4000-8000-000000000001";
const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const LOCATION_ID = "20000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";

const ALL_ROLES: readonly UserRole[] = ["admin", "organization_admin", "location_admin", "asset_group_admin", "operator", "viewer"];

function user(role: UserRole): JwtPayload {
  return { sub: `sub-${role}`, email: `${role}@bms.local`, name: role, role };
}

type Harness = { controller: MaintenanceWindowsController; calls: string[]; lastScope: unknown[] };

/** The gate answers from the real operations matrix on the token's role. */
function harness(): Harness {
  const calls: string[] = [];
  const lastScope: unknown[] = [];
  const access = {
    async assertOperationsWriteRole(jwt: JwtPayload, writeClass: OperationsWriteClass): Promise<void> {
      calls.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(jwt.role, writeClass)) {
        throw new ForbiddenException(operationsWriteDenialReason(writeClass));
      }
    },
    async readableAssetIds(): Promise<string[] | null> {
      calls.push("scope:assets");
      return [ASSET_ID];
    },
    async readableLocationIds(): Promise<string[] | null> {
      calls.push("scope:locations");
      return [LOCATION_ID];
    },
    async readableOrganizationIds(): Promise<string[] | null> {
      calls.push("scope:organizations");
      return [ORGANIZATION_ID];
    },
  } as unknown as AccessControlService;
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<{ id: string }> => {
      calls.push(`service:${name}`);
      lastScope.splice(0, lastScope.length, args[args.length - 1]);
      return { id: WINDOW_ID };
    };
  const service = {
    list: record("list"),
    create: record("create"),
    extend: record("extend"),
    end: record("end"),
    cancel: record("cancel"),
  } as unknown as MaintenanceWindowsService;
  return { controller: new MaintenanceWindowsController(service, access), calls, lastScope };
}

const IN_A_DAY = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const CREATE_BODY = { reason: "Chiller overhaul", endsAt: IN_A_DAY, targets: [{ kind: "asset", assetId: ASSET_ID }] };

type Write = { name: string; run: (h: Harness, jwt: JwtPayload, body?: unknown) => Promise<unknown>; good: unknown };

const WRITES: readonly Write[] = [
  { name: "create", run: (h, jwt, body) => h.controller.create(body, jwt), good: CREATE_BODY },
  { name: "extend", run: (h, jwt, body) => h.controller.extend(WINDOW_ID, body, jwt), good: { endsAt: IN_A_DAY } },
  { name: "end", run: (h, jwt, body) => h.controller.end(WINDOW_ID, body, jwt), good: {} },
  { name: "cancel", run: (h, jwt, body) => h.controller.cancel(WINDOW_ID, body, jwt), good: { reason: "Not needed" } },
];

/** An `operator` and a `viewer` get 403 on each of the four writes, and nothing after the gate runs. */
export async function anOperatorAndAViewerAreRefusedEveryWrite(): Promise<void> {
  for (const role of ["operator", "viewer"] as const) {
    for (const write of WRITES) {
      const h = harness();
      await expect(write.run(h, user(role), write.good), `${role} ${write.name}`).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.calls, `${role} ${write.name}`).toEqual(["role:configuration"]);
    }
  }
}

/** The four admin roles pass the gate (Q5 admits `asset_group_admin`), and the gate runs before the scope. */
export async function theFourAdminRolesWriteWithTheGateFirst(): Promise<void> {
  const admitted = ALL_ROLES.filter((role) => canPerformOperationsWrite(role, "configuration"));
  expect(admitted).toEqual(["admin", "organization_admin", "location_admin", "asset_group_admin"]);
  for (const role of admitted) {
    for (const write of WRITES) {
      const h = harness();
      await write.run(h, user(role), write.good);
      expect(h.calls, `${role} ${write.name}`).toEqual([
        "role:configuration",
        "scope:assets",
        "scope:locations",
        "scope:organizations",
        `service:${write.name}`,
      ]);
    }
  }
}

/** A bad body is a 400 and reaches no service; so is a non-uuid id. */
export async function aBadBodyIs400(): Promise<void> {
  const bad: Record<string, unknown> = {
    create: { ...CREATE_BODY, organizationId: ORGANIZATION_ID },
    extend: { endsAt: "tomorrow" },
    end: { endedBy: ASSET_ID },
    cancel: { reason: "no" },
  };
  for (const write of WRITES) {
    const h = harness();
    await expect(write.run(h, user("admin"), bad[write.name]), write.name).rejects.toBeInstanceOf(BadRequestException);
    expect(h.calls.some((call) => call.startsWith("service:")), write.name).toBe(false);
  }
  const h = harness();
  await expect(h.controller.end("not-a-uuid", {}, user("admin"))).rejects.toBeInstanceOf(BadRequestException);
  expect(h.calls).toEqual(["role:configuration"]);
}

/** The list passes the caller's three readable sets through, and a bad query is a 400. */
export async function theListPassesTheThreeReadableSets(): Promise<void> {
  const h = harness();
  await h.controller.list(user("viewer"), { state: "active" });
  expect(h.calls).toEqual(["scope:assets", "scope:locations", "scope:organizations", "service:list"]);
  expect(h.lastScope).toEqual([{ assetIds: [ASSET_ID], locationIds: [LOCATION_ID], organizationIds: [ORGANIZATION_ID] }]);
  const bad = harness();
  await expect(bad.controller.list(user("viewer"), { state: "soon" })).rejects.toBeInstanceOf(BadRequestException);
  await expect(bad.controller.list(user("viewer"), { cursor: "x" })).rejects.toBeInstanceOf(BadRequestException);
  await expect(bad.controller.list(user("viewer"), { limit: "101" })).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.calls).toEqual([]);
}
