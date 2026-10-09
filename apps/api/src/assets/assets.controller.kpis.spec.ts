import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetKpisResponse, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { repoRoot } from "../testing/repo-root";
import type { AssetKpisService } from "./asset-kpis.service";
import type { AssetRoleSummaryService } from "./asset-role-summary.service";
import { AssetsController } from "./assets.controller";
import type { AssetsService } from "./assets.service";

/**
 * `F2.33` (ADR 0097 decision 1) — `GET /assets/:assetId/kpis`, gated by
 * `canReadAsset` exactly as `GET /assets/:assetId/points` is. A sibling of
 * `assets.controller.spec.ts` rather than more cases in it; it also takes over
 * that file's "last handler" guard, because `listKpis` is now the last handler.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/assets/assets.controller.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "asset_group_admin" };
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

function build(canReadAsset: boolean) {
  const guardCalls: string[] = [];
  const serviceCalls: { assetId: string; windowMinutes: number; now: Date }[] = [];
  const access = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      guardCalls.push(assetId);
      return canReadAsset;
    },
  } as unknown as AccessControlService;
  const kpis = {
    listKpis: async (assetId: string, windowMinutes: number, now: Date): Promise<AssetKpisResponse> => {
      serviceCalls.push({ assetId, windowMinutes, now });
      return { assetId, windowMinutes, items: [] };
    },
  } as unknown as AssetKpisService;
  const controller = new AssetsController(
    {} as unknown as AssetsService,
    access,
    {} as unknown as AssetRoleSummaryService,
    kpis,
  );
  return { controller, guardCalls, serviceCalls };
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : String(err);
  }
  throw new Error("expected the call to reject, and it resolved");
}

export async function deniedIsForbidden(): Promise<void> {
  const { controller } = build(false);
  const name = await rejection(() => controller.listKpis(USER, ASSET_ID, {}));
  assert(name === "ForbiddenException", `a denied asset is a 403; got ${name}`);
}

export async function deniedNeverReachesTheService(): Promise<void> {
  const { controller, serviceCalls } = build(false);
  await rejection(() => controller.listKpis(USER, ASSET_ID, {}));
  assert(serviceCalls.length === 0, `the service must not be called for a denied asset; got ${serviceCalls.length}`);
}

export async function nonUuidIsZodErrorBeforeTheGuard(): Promise<void> {
  const { controller, guardCalls } = build(true);
  const name = await rejection(() => controller.listKpis(USER, "not-a-uuid", {}));
  assert(name === "ZodError", `a non-uuid segment is a ZodError; got ${name}`);
  assert(guardCalls.length === 0, "a non-uuid segment never reaches canReadAsset");
}

export async function noQueryAppliesTheDefaultWindow(): Promise<void> {
  const { controller, serviceCalls, guardCalls } = build(true);
  await controller.listKpis(USER, ASSET_ID, {});
  assert(guardCalls.join() === ASSET_ID, `the guard sees the parsed id once; got ${guardCalls.join()}`);
  assert(
    serviceCalls.length === 1 && serviceCalls[0].assetId === ASSET_ID && serviceCalls[0].windowMinutes === 15,
    `no query → the service gets windowMinutes 15; got ${JSON.stringify(serviceCalls)}`,
  );
}

export async function aWindowInRangeIsPassedThrough(): Promise<void> {
  const { controller, serviceCalls } = build(true);
  await controller.listKpis(USER, ASSET_ID, { windowMinutes: "60" });
  assert(serviceCalls[0]?.windowMinutes === 60, `windowMinutes=60 is the bound and passes; got ${JSON.stringify(serviceCalls)}`);
}

export const REFUSED_QUERIES: readonly { label: string; query: Record<string, unknown> }[] = [
  { label: "windowMinutes=61 (over the bound)", query: { windowMinutes: "61" } },
  { label: "windowMinutes=0", query: { windowMinutes: "0" } },
  { label: "an unknown query key", query: { window: "15" } },
];

export async function refusedQueryIsBadRequest(query: Record<string, unknown>): Promise<void> {
  const { controller, serviceCalls } = build(true);
  const name = await rejection(() => controller.listKpis(USER, ASSET_ID, query));
  assert(name === "BadRequestException", `got ${name}`);
  assert(serviceCalls.length === 0, "a refused query never reaches the service");
}

/** `listKpis` is the last handler: from its `async listKpis(` to the end of the file, refused
 * when a later route decorator folds into the slice (the `listPointsBody` rule it inherits). */
function listKpisBody(text: string): string {
  const from = text.indexOf("async listKpis(");
  assert(from > -1, "the controller must declare async listKpis(");
  const body = text.slice(from);
  assert(
    !/@(Get|Post|Patch|Put|Delete)\(/.test(body),
    "listKpis is no longer the last handler — anchor listKpisBody on the next route decorator",
  );
  return body;
}

export function guardPrecedesTheServiceInSource(): void {
  const body = listKpisBody(readFileSync(CONTROLLER, "utf8"));
  const guard = body.indexOf("canReadAsset(");
  const service = body.indexOf("this.kpis.listKpis(");
  assert(guard > -1 && service > -1, "listKpis must call canReadAsset and this.kpis.listKpis");
  assert(guard < service, "canReadAsset must precede this.kpis.listKpis in listKpis");
}
