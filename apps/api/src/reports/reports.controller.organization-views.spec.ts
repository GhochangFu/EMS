import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { ReportsController } from "./reports.controller";

/**
 * `F4.299` U4 (ADR 0108 Amendment 1, 7.1) — `GET /reports/energy/organization-views`:
 * it parses with `energyViewQuerySchema` (the `energy/view` query, by
 * identity), a `ZodError` is a 400 with `flatten()`, and the dto and the user
 * reach `EnergyOrganizationViewsService`. `Cache-Control: no-store`. Vitest
 * entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-000000000001";

function harness() {
  const calls: unknown[][] = [];
  const viewCalls: unknown[][] = [];
  const answer = { marker: "organization-views" };
  const controller = new ReportsController(
    {} as never,
    {} as never,
    {
      view: async (user: JwtPayload, dto: unknown) => {
        viewCalls.push([user, dto]);
        return {};
      },
    } as never,
    {
      organizationViews: async (user: JwtPayload, dto: unknown) => {
        calls.push([user, dto]);
        return answer;
      },
    } as never,
  );
  return { controller, calls, viewCalls, answer };
}

/** The parsed dto (one `locationIds` string becomes a list) and the user reach the service, and its answer is the response. */
export async function theDtoAndUserReachTheOrganizationViewsService(): Promise<void> {
  const h = harness();
  const out = await h.controller.energyOrganizationViews(USER, {
    range: "7d",
    organizationId: ORG,
    locationIds: SITE,
    compare: "previous",
  });
  expect(h.calls).toEqual([[USER, { range: "7d", organizationId: ORG, locationIds: [SITE], compare: "previous" }]]);
  expect(h.viewCalls).toEqual([]);
  expect(out).toBe(h.answer);
}

/** An unknown key (the schema is `.strict()`) is a 400 carrying the flattened `ZodError`, and the service is not called. */
export async function anOrganizationViewsZodErrorIsA400WithFlatten(): Promise<void> {
  const h = harness();
  let caught: unknown;
  try {
    await h.controller.energyOrganizationViews(USER, { range: "7d", window: "24h" });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  const body = (caught as BadRequestException).getResponse() as { formErrors?: string[]; fieldErrors?: unknown };
  expect(body.formErrors?.join(" ")).toContain("window");
  expect(body.fieldErrors).toBeDefined();
  expect(h.calls).toEqual([]);
}

/** A non-Zod error from the service is rethrown as it is. */
export async function aServiceErrorIsRethrown(): Promise<void> {
  const failure = new Error("boom");
  const controller = new ReportsController(
    {} as never,
    {} as never,
    {} as never,
    {
      organizationViews: async () => {
        throw failure;
      },
    } as never,
  );
  await expect(controller.energyOrganizationViews(USER, { range: "7d", organizationId: ORG })).rejects.toBe(failure);
}

/** The route is scope-filtered, so a shared cache may not keep it. */
export function theOrganizationViewsRouteSendsNoStore(): void {
  const headers =
    (Reflect.getMetadata(HEADERS_METADATA, ReportsController.prototype.energyOrganizationViews) as
      | Array<{ name: string; value: string }>
      | undefined) ?? [];
  expect(headers).toContainEqual({ name: "Cache-Control", value: "no-store" });
}
