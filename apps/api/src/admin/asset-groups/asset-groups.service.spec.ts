import "reflect-metadata";

import { ForbiddenException, HttpException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";
import { ZodError } from "zod";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { ZodErrorFilter } from "../../common/zod-error.filter";
import { dbOps, recordingDb, type DbOp, type Timeline } from "../../testing/recording-db";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { AssetGroupMembersAdminController, AssetGroupsAdminController } from "./asset-groups.controller";
import { updateAssetGroupBodySchema } from "./asset-groups.schema";
import { AssetGroupsAdminService } from "./asset-groups.service";

/**
 * `F3.78` (ADR 0089 decision 7, plan U8) — the asset-group write routes against
 * the recording fake db. One claim per exported function; the integration
 * suite owns what only a real `bms_tenant` connection can show.
 * `asset-groups.service.test.ts` is the entry point.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const LOC_A = "00000000-0000-4000-8000-0000000001a1";
const LOC_B = "00000000-0000-4000-8000-0000000001b1";
const GROUP_A = "00000000-0000-4000-8000-0000000002a1";
const GROUP_B = "00000000-0000-4000-8000-0000000002b1";
const MEMBER_A = "00000000-0000-4000-8000-0000000004a1";
const MEMBER_B = "00000000-0000-4000-8000-0000000004b1";
const ASSET_A = "00000000-0000-4000-8000-0000000005a1";
const ASSET_B = "00000000-0000-4000-8000-0000000005b1";
const GROUP_B_NAME = "Group B (foreign)";

const GROUPS: Record<string, { organizationId: string; locationId: string; name: string }> = {
  [GROUP_A]: { organizationId: ORG_A, locationId: LOC_A, name: "Group A" },
  [GROUP_B]: { organizationId: ORG_B, locationId: LOC_B, name: GROUP_B_NAME },
};
const MEMBERS: Record<string, { assetGroupId: string; assetId: string }> = {
  [MEMBER_A]: { assetGroupId: GROUP_A, assetId: ASSET_A },
  [MEMBER_B]: { assetGroupId: GROUP_B, assetId: ASSET_B },
};
const WRITES = new Set<DbOp["kind"]>(["insert", "update", "delete"]);

function harness() {
  const timeline: Timeline = [];
  const answer = (op: DbOp): unknown[] | undefined => {
    if (op.kind === "select" && op.table === "asset_groups") {
      return Object.entries(GROUPS)
        .filter(([id]) => op.params.includes(id))
        .map(([id, row]) => ({ id, ...row, createdAt: new Date(0) }));
    }
    if (op.kind === "select" && op.table === "asset_group_members") {
      return Object.entries(MEMBERS)
        .filter(([id]) => op.params.includes(id))
        .map(([id, row]) => ({
          membershipId: id,
          ...row,
          role: null,
          organizationId: GROUPS[row.assetGroupId]?.organizationId,
          locationId: GROUPS[row.assetGroupId]?.locationId,
        }));
    }
    if (op.kind === "select" && op.table === "assets") {
      return [{ active: true, locationId: LOC_A, organizationId: ORG_A }];
    }
    if (op.kind === "select" && op.table === "locations") {
      return [{ organizationId: ORG_A }];
    }
    if (WRITES.has(op.kind)) {
      return [{ id: op.table === "asset_groups" ? GROUP_A : MEMBER_A }];
    }
    return [];
  };
  const fleet = recordingDb("fleet", timeline, answer);
  const tenant = recordingDb("tenant", timeline, answer);
  const accessControl = {
    requireMasterDataUser: async () => undefined,
    // A location admin of organization A: only LOC_A is manageable.
    canManageLocation: async (_jwt: JwtPayload, locationId: string) => locationId === LOC_A,
  } as unknown as AccessControlService;
  const audit = {
    write: async (input: unknown) => {
      timeline.push({ source: "identity", method: "audit", args: [input] });
    },
  } as unknown as MasterDataAuditService;
  const vocabularies = {
    assertAssetRole: async () => undefined,
    assertAssetDomain: async () => undefined,
  } as unknown as VocabulariesService;
  const service = new AssetGroupsAdminService(
    fleet as BmsDb,
    tenant as BmsDb,
    accessControl,
    audit,
    vocabularies,
  );
  const jwt = { sub: "s", email: "e", name: "n", role: "location_admin" } as JwtPayload;
  return { service, jwt, timeline };
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

/** The refusal's body names no row: no id, no name, no foreign location. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ForbiddenException);
  const text = JSON.stringify((caught as ForbiddenException).getResponse());
  for (const secret of [GROUP_B, MEMBER_B, ASSET_B, LOC_B, ORG_B, GROUP_B_NAME]) {
    expect(text).not.toContain(secret);
  }
  return text;
}

function writesOf(timeline: Timeline): DbOp[] {
  return dbOps(timeline).filter((op) => WRITES.has(op.kind));
}

export function assertUpdateSchemaRefusesCode(): void {
  const refused = updateAssetGroupBodySchema.safeParse({ name: "X", code: "NEW_CODE" });
  expect(refused.success).toBe(false);
  expect(refused.success ? [] : refused.error.issues.map((issue) => issue.code)).toContain("unrecognized_keys");
  // Positive control: the same body without `code` parses, so the refusal is the key's.
  expect(updateAssetGroupBodySchema.safeParse({ name: "X" }).success).toBe(true);
}

export function assertBothControllersCarryJwtAuthGuard(): void {
  expect(guardsOf(AssetGroupsAdminController)).toContain(JwtAuthGuard);
  expect(guardsOf(AssetGroupMembersAdminController)).toContain(JwtAuthGuard);
}

export async function assertCreateRefusesAnotherSitesLocation(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await refusalOf(() => service.create(jwt, { locationId: LOC_B, code: "G_X", name: "X" }));
  expect(writesOf(timeline)).toEqual([]);
  // Positive control: the same body at the caller's own site writes.
  await service.create(jwt, { locationId: LOC_A, code: "G_X", name: "X" });
  expect(writesOf(timeline).map((op) => op.table)).toEqual(["asset_groups"]);
}

export async function assertUpdateRefusesAnotherSitesGroup(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await refusalOf(() => service.update(jwt, GROUP_B, { name: "Renamed" }));
  expect(writesOf(timeline)).toEqual([]);
  await service.update(jwt, GROUP_A, { name: "Renamed" });
  expect(writesOf(timeline).map((op) => op.table)).toEqual(["asset_groups"]);
}

export async function assertAddMemberRefusesAnotherSitesGroup(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await refusalOf(() => service.addMember(jwt, GROUP_B, { assetId: ASSET_A }));
  expect(writesOf(timeline)).toEqual([]);
  await service.addMember(jwt, GROUP_A, { assetId: ASSET_A });
  expect(writesOf(timeline).map((op) => op.table)).toEqual(["asset_group_members"]);
}

export async function assertRemoveMemberRefusesAnotherSitesMember(): Promise<void> {
  const { service, jwt, timeline } = harness();
  await refusalOf(() => service.removeMember(jwt, MEMBER_B));
  expect(writesOf(timeline)).toEqual([]);
  await service.removeMember(jwt, MEMBER_A);
  expect(writesOf(timeline).map((op) => `${op.kind}:${op.table}`)).toEqual(["delete:asset_group_members"]);
}

/** `F4.189` — the route is the controller over the real service: a refused body is a 400 and writes nothing. */
async function assertBodyRefusedWith400AndNoWrite(
  run: (controller: AssetGroupsAdminController, jwt: JwtPayload) => Promise<unknown>,
  accepted: (controller: AssetGroupsAdminController, jwt: JwtPayload) => Promise<unknown>,
  writtenTable: string,
): Promise<void> {
  const { service, jwt, timeline } = harness();
  const controller = new AssetGroupsAdminController(service);
  let caught: unknown;
  try {
    await run(controller, jwt);
  } catch (err) {
    caught = err;
  }
  // The handler's `.parse()` sits *inside* `parsing()`, which turns a ZodError into
  // `BadRequestException(err.flatten())` — that is the production path, where the api and
  // `@bms/shared`'s dist both `require` zod's CJS build. Under vitest the api's `import "zod"`
  // resolves the ESM build while `@bms/shared` (dist, CJS) `require`s `index.cjs`: one package,
  // two module instances, so `parsing()`'s `instanceof ZodError` misses and the raw error
  // escapes to the global `ZodErrorFilter` (ADR 0060), which also answers 400. The claim is the
  // status and the unknown key, whichever path answered; the message names the branch that ran.
  if (caught instanceof HttpException) {
    const branch = "branch: parsing() -> BadRequestException";
    expect(caught.getStatus(), branch).toBe(400);
    expect(JSON.stringify(caught.getResponse()), branch).toMatch(/unrecognized_keys|Unrecognized key/);
  } else {
    const branch = "branch: raw ZodError -> ZodErrorFilter";
    // By name, not `instanceof`: the instance comes from the other zod module (see above).
    expect((caught as Error | undefined)?.name, branch).toBe("ZodError");
    expect(
      (caught as ZodError).issues.map((issue) => issue.code),
      branch,
    ).toEqual(["unrecognized_keys"]);
    const answered: { status: number | null } = { status: null };
    const response = {
      status(code: number) {
        answered.status = code;
        return response;
      },
      json: () => response,
    };
    new ZodErrorFilter().catch(caught as ZodError, {
      getType: () => "http",
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost);
    expect(answered.status, branch).toBe(400);
  }
  expect(writesOf(timeline)).toEqual([]);
  // Positive control: the same body without the unknown key writes, so the refusal is the key's.
  await accepted(controller, jwt);
  expect(writesOf(timeline).map((op) => op.table)).toEqual([writtenTable]);
}

export async function assertCreateWithAnUnknownKeyIs400AndWritesNothing(): Promise<void> {
  const body = { locationId: LOC_A, code: "G_X", name: "X" };
  await assertBodyRefusedWith400AndNoWrite(
    (controller, jwt) => controller.create({ ...body, descripton: "typo" }, jwt),
    (controller, jwt) => controller.create(body, jwt),
    "asset_groups",
  );
}

export async function assertAddMemberWithAnUnknownKeyIs400AndWritesNothing(): Promise<void> {
  const body = { assetId: ASSET_A };
  await assertBodyRefusedWith400AndNoWrite(
    (controller, jwt) => controller.addMember(GROUP_A, { ...body, rol: "typo" }, jwt),
    (controller, jwt) => controller.addMember(GROUP_A, body, jwt),
    "asset_group_members",
  );
}
