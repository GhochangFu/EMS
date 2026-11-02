import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { SiteSegmentViewsController } from "./segment-views.controller";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 4) — the segment-views route: the
 * query parses with `siteSegmentViewsQuerySchema` (a failure is a 400 with
 * `flatten()` naming the query, the service never called), the dto and the
 * user reach `SiteSegmentViewsService`, and the response is
 * `Cache-Control: no-store`. Vitest entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const SITE = "40000000-0000-4000-8000-000000000001";

function harness() {
  const calls: unknown[][] = [];
  const answer = { marker: "segment-views" };
  const controller = new SiteSegmentViewsController({
    forSite: async (...args: unknown[]) => {
      calls.push(args);
      return answer;
    },
  } as never);
  return { controller, calls, answer };
}

async function badRequest(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return err as BadRequestException;
  }
  throw new Error("resolved, expected a 400");
}

/** An unknown `range` is a 400 whose flattened body names `range`, and the service is not called. */
export async function aBadRangeIsA400NamingTheQuery(): Promise<void> {
  const h = harness();
  const err = await badRequest(h.controller.forSite(SITE, { range: "2w" }, USER));
  const body = err.getResponse() as { fieldErrors?: Record<string, unknown> };
  expect(Object.keys(body.fieldErrors ?? {})).toEqual(["range"]);
  expect(h.calls).toEqual([]);
}

/** `organizationId` is not a key of this query (`.strict()`): a 400 naming it, and the service is not called. */
export async function anOrganizationIdIsA400(): Promise<void> {
  const h = harness();
  const err = await badRequest(h.controller.forSite(SITE, { range: "24h", organizationId: SITE }, USER));
  const body = err.getResponse() as { formErrors?: string[] };
  expect(body.formErrors?.join(" ")).toContain("organizationId");
  expect(h.calls).toEqual([]);
}

/** The parsed dto and the user reach the service, and its answer is the response. */
export async function theDtoAndUserReachTheService(): Promise<void> {
  const h = harness();
  const query = { range: "30d", segment: "hvac", point: "kw", compare: "previous" };
  const out = await h.controller.forSite(SITE, query, USER);
  expect(h.calls).toEqual([[USER, SITE, query]]);
  expect(out).toBe(h.answer);
}

/** The route is scope-filtered, so no shared cache may keep it. */
export function theRouteSendsNoStore(): void {
  const headers =
    (Reflect.getMetadata(HEADERS_METADATA, SiteSegmentViewsController.prototype.forSite) as
      | Array<{ name: string; value: string }>
      | undefined) ?? [];
  expect(headers).toContainEqual({ name: "Cache-Control", value: "no-store" });
}
