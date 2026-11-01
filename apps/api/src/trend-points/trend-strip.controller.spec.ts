import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { SiteTrendStripController } from "./trend-strip.controller";

/**
 * `F4.301` U3 (ADR 0108 Amendment 2 item 3) — the trend strip route: the
 * query parses with `siteTrendStripQuerySchema` (a failure is a 400 with
 * `flatten()`, the service never called), the dto and the user reach
 * `SiteTrendStripService`, and the response is `Cache-Control: no-store`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const SITE = "40000000-0000-4000-8000-000000000001";
const GROUP = "50000000-0000-4000-8000-000000000001";

function harness() {
  const calls: unknown[][] = [];
  const answer = { marker: "strip" };
  const controller = new SiteTrendStripController({
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

/** `range=1y` is a 400 carrying the flattened error, and the service is not called. */
export async function anUnknownRangeIsA400WithFlatten(): Promise<void> {
  const h = harness();
  const err = await badRequest(h.controller.forSite(SITE, { range: "1y" }, USER));
  const body = err.getResponse() as { formErrors?: string[]; fieldErrors?: Record<string, unknown> };
  expect(Object.keys(body.fieldErrors ?? {})).toEqual(["range"]);
  expect(h.calls).toEqual([]);
}

/** An unknown query key (the schema is `.strict()`) is a 400 naming it, and the service is not called. */
export async function anUnknownKeyIsA400(): Promise<void> {
  const h = harness();
  const err = await badRequest(h.controller.forSite(SITE, { range: "24h", window: "7d" }, USER));
  const body = err.getResponse() as { formErrors?: string[] };
  expect(body.formErrors?.join(" ")).toContain("window");
  expect(h.calls).toEqual([]);
}

/** The parsed dto and the user reach the service, and its answer is the response. */
export async function theDtoAndUserReachTheService(): Promise<void> {
  const h = harness();
  const out = await h.controller.forSite(SITE, { range: "7d", assetGroupId: GROUP }, USER);
  expect(h.calls).toEqual([[USER, SITE, { range: "7d", assetGroupId: GROUP }]]);
  expect(out).toBe(h.answer);
}

/** The route is scope-filtered, so no shared cache may keep it. */
export function theRouteSendsNoStore(): void {
  const headers =
    (Reflect.getMetadata(HEADERS_METADATA, SiteTrendStripController.prototype.forSite) as
      | Array<{ name: string; value: string }>
      | undefined) ?? [];
  expect(headers).toContainEqual({ name: "Cache-Control", value: "no-store" });
}
