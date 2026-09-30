import { BadRequestException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { DashboardController } from "./dashboard.controller";
import type { DashboardService } from "./dashboard.service";

/**
 * `F3.72` U0 — `GET /dashboard/load-trend?organizationId=`. Assertions live
 * here; `dashboard.controller.test.ts` is the Vitest entry point (ADR 0014).
 * Same hand-rolled stub pattern as `asset-health.controller.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCOPE = ["77777777-7777-4777-8777-777777777777"];

function build(opts: { readable?: string[] | null; inOrganization?: string[] }) {
  const loadTrendCalls: { window: string | undefined; assetIds: string[] | null | undefined }[] = [];
  const readableCalls: number[] = [];
  const inOrganizationCalls: { user: JwtPayload; organizationId: string }[] = [];
  const dashboard = {
    loadTrend: async (window?: string, assetIds?: string[] | null) => {
      loadTrendCalls.push({ window, assetIds });
      return { points: [] };
    },
  } as unknown as DashboardService;
  const access = {
    readableAssetIds: async () => {
      readableCalls.push(1);
      return opts.readable ?? null;
    },
    readableAssetIdsInOrganization: async (user: JwtPayload, organizationId: string) => {
      inOrganizationCalls.push({ user, organizationId });
      return opts.inOrganization ?? [];
    },
  } as unknown as AccessControlService;
  return {
    controller: new DashboardController(dashboard, access),
    loadTrendCalls,
    readableCalls,
    inOrganizationCalls,
  };
}

export async function loadTrendNarrowsByOrganizationId(): Promise<void> {
  const narrowed = ["x"];
  const { controller, loadTrendCalls, readableCalls, inOrganizationCalls } = build({
    readable: SCOPE,
    inOrganization: narrowed,
  });
  await controller.loadTrend(USER, { window: "60m", organizationId: ORGANIZATION_ID });
  assert(
    inOrganizationCalls.length === 1 &&
      inOrganizationCalls[0]?.user === USER &&
      inOrganizationCalls[0]?.organizationId === ORGANIZATION_ID,
    `readableAssetIdsInOrganization must be called once with (user, organizationId); got ${JSON.stringify(inOrganizationCalls)}`,
  );
  assert(
    loadTrendCalls[0]?.assetIds === narrowed,
    "the narrowed set must reach loadTrend by reference",
  );
  assert(loadTrendCalls[0]?.window === "60m", "the window must still reach loadTrend");
  assert(
    readableCalls.length === 0,
    "readableAssetIds must not be called when organizationId is present",
  );
}

export async function loadTrendWithoutOrganizationIdReadsTheReadableSet(): Promise<void> {
  const { controller, loadTrendCalls, inOrganizationCalls } = build({ readable: SCOPE });
  await controller.loadTrend(USER, { window: "6h" });
  assert(loadTrendCalls[0]?.assetIds === SCOPE, "the readable set must reach loadTrend unchanged");
  assert(loadTrendCalls[0]?.window === "6h", "the window must reach loadTrend");
  assert(inOrganizationCalls.length === 0, "readableAssetIdsInOrganization must not be called");

  await controller.loadTrend(USER, {});
  assert(
    loadTrendCalls[1]?.window === undefined,
    "an absent window must reach loadTrend as undefined",
  );
}

export async function loadTrendMalformedOrganizationIdIsABadRequest(): Promise<void> {
  const { controller, loadTrendCalls, readableCalls, inOrganizationCalls } = build({});
  let thrown: unknown;
  try {
    await controller.loadTrend(USER, { organizationId: "not-a-uuid" });
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof BadRequestException, `expected a 400, got ${String(thrown)}`);
  assert(loadTrendCalls.length === 0, "a malformed query must not reach the service");
  assert(
    readableCalls.length === 0 && inOrganizationCalls.length === 0,
    "a malformed organizationId must be refused before any access-control read",
  );
}
