import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { ReportsController } from "./reports.controller";

/**
 * `F4.298` U4 (ADR 0108 decisions 2.2 and 2.7) — the two energy view routes:
 * `energyView` parses with `energyViewQuerySchema` (a `ZodError` is a 400 with
 * `flatten()`) and hands the dto and the user to `EnergyViewService`;
 * `filterOptions` hands the user. Both send `Cache-Control: no-store`. Vitest
 * entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-000000000001";

function harness() {
  const viewCalls: unknown[][] = [];
  const optionCalls: unknown[] = [];
  const answer = { marker: "view" };
  const options = { organizations: [], locations: [] };
  const controller = new ReportsController(
    {} as never,
    {} as never,
    {
      view: async (user: JwtPayload, dto: unknown) => {
        viewCalls.push([user, dto]);
        return answer;
      },
      filterOptions: async (user: JwtPayload) => {
        optionCalls.push(user);
        return options;
      },
    } as never,
  );
  return { controller, viewCalls, optionCalls, answer, options };
}

/** The parsed dto and the user reach the service, and its answer is the response. */
export async function theDtoAndUserReachTheService(): Promise<void> {
  const h = harness();
  const out = await h.controller.energyView(USER, { range: "7d", organizationId: ORG, locationIds: SITE, compare: "previous" });
  expect(h.viewCalls).toEqual([[USER, { range: "7d", organizationId: ORG, locationIds: [SITE], compare: "previous" }]]);
  expect(out).toBe(h.answer);
}

/** An unknown key (the schema is `.strict()`) is a 400 carrying the flattened `ZodError`, and the service is not called. */
export async function aZodErrorIsA400WithFlatten(): Promise<void> {
  const h = harness();
  let caught: unknown;
  try {
    await h.controller.energyView(USER, { range: "7d", window: "24h" });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  const body = (caught as BadRequestException).getResponse() as { formErrors?: string[]; fieldErrors?: unknown };
  expect(body.formErrors?.join(" ")).toContain("window");
  expect(body.fieldErrors).toBeDefined();
  expect(h.viewCalls).toEqual([]);
}

/** `filterOptions` hands the user to the service and returns its answer. */
export async function filterOptionsPassesTheUser(): Promise<void> {
  const h = harness();
  const out = await h.controller.energyFilterOptions(USER);
  expect(h.optionCalls).toEqual([USER]);
  expect(out).toBe(h.options);
}

/** Both routes are scope-filtered, so neither may be cached by a shared cache. */
export function bothRoutesSendNoStore(): void {
  const headersOf = (handler: unknown) =>
    (Reflect.getMetadata(HEADERS_METADATA, handler as object) as Array<{ name: string; value: string }> | undefined) ?? [];
  for (const handler of [ReportsController.prototype.energyView, ReportsController.prototype.energyFilterOptions]) {
    expect(headersOf(handler)).toContainEqual({ name: "Cache-Control", value: "no-store" });
  }
}
