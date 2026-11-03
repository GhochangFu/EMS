import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { expect } from "vitest";

import { energyViewQuerySchema, type JwtPayload } from "@bms/shared";

import { REQUEST_SCHEMAS } from "../openapi/openapi-registry";
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
const CSV = "zone,Asia/Kolkata\n";
const XLSX_BODY = Buffer.from("PK-workbook");

function harness() {
  const viewCalls: unknown[][] = [];
  const optionCalls: unknown[] = [];
  const exportCalls: unknown[][] = [];
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
    // `F4.299`: the organization views service; these two routes never reach it.
    {} as never,
    // `F4.303` U3: the energy view export service.
    {
      csv: async (user: JwtPayload, dto: unknown) => {
        exportCalls.push(["csv", user, dto]);
        return CSV;
      },
      xlsx: async (user: JwtPayload, dto: unknown) => {
        exportCalls.push(["xlsx", user, dto]);
        return XLSX_BODY;
      },
    } as never,
  );
  return { controller, viewCalls, optionCalls, exportCalls, answer, options };
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

// ---------------------------------------------------------------------------
// `F4.303` U3 (ADR 0108 Amendment 6 item 3) — `energy/view/export.csv|.xlsx`
// on `energyViewQuerySchema` by identity, beside the read.
// ---------------------------------------------------------------------------

function fakeResponse() {
  const headers: Array<[string, string]> = [];
  const sent: unknown[] = [];
  const res = {
    setHeader: (name: string, value: string) => {
      headers.push([name, value]);
      return res;
    },
    send: (body: unknown) => {
      sent.push(body);
      return res;
    },
  };
  return { res: res as unknown as Response, headers, sent };
}

async function caughtFrom(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("resolved, expected a refusal");
}

const EXPORT_QUERY = { range: "7d", organizationId: ORG, locationIds: SITE, compare: "previous" };
const EXPORT_DTO = { range: "7d", organizationId: ORG, locationIds: [SITE], compare: "previous" };

/** C1: the CSV route parses the view's query, hands `(user, dto)` to the export service and returns its string. */
export async function theCsvRouteHandsTheDtoToTheExport(): Promise<void> {
  const h = harness();
  const out = await h.controller.energyViewCsv(USER, EXPORT_QUERY);
  expect(h.exportCalls).toEqual([["csv", USER, EXPORT_DTO]]);
  expect(out).toBe(CSV);
}

/** C1: a bad query on the CSV route is a 400 with `flatten()`, and the export is not called. */
export async function theCsvRouteRefusesABadQueryWithFlatten(): Promise<void> {
  const h = harness();
  const err = await caughtFrom(h.controller.energyViewCsv(USER, { range: "7d", window: "24h" }));
  expect(err).toBeInstanceOf(BadRequestException);
  const body = (err as BadRequestException).getResponse() as { formErrors?: string[]; fieldErrors?: unknown };
  expect(body.formErrors?.join(" ")).toContain("window");
  expect(body.fieldErrors).toBeDefined();
  expect(h.exportCalls).toEqual([]);
}

/** C1: the XLSX route hands `(user, dto)` to the export service and sends its buffer. */
export async function theXlsxRouteSendsTheExportsBuffer(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  await h.controller.energyViewXlsx(USER, EXPORT_QUERY, r.res);
  expect(h.exportCalls).toEqual([["xlsx", USER, EXPORT_DTO]]);
  expect(r.sent).toEqual([XLSX_BODY]);
}

/** C1: a bad query on the XLSX route is a 400 with `flatten()`, and nothing is sent. */
export async function theXlsxRouteRefusesABadQueryWithFlatten(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  const err = await caughtFrom(h.controller.energyViewXlsx(USER, { range: "7d", window: "24h" }, r.res));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(((err as BadRequestException).getResponse() as { fieldErrors?: unknown }).fieldErrors).toBeDefined();
  expect(h.exportCalls).toEqual([]);
  expect(r.sent).toEqual([]);
}

/** C2: the CSV route's three headers: the CSV type, the fixed file name, `no-store`. */
export function theCsvRouteSendsItsThreeHeaders(): void {
  const headers =
    (Reflect.getMetadata(HEADERS_METADATA, ReportsController.prototype.energyViewCsv) as
      | Array<{ name: string; value: string }>
      | undefined) ?? [];
  expect([...headers].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "Cache-Control", value: "no-store" },
    { name: "Content-Disposition", value: 'attachment; filename="energy-view.csv"' },
    { name: "Content-Type", value: "text/csv; charset=utf-8" },
  ]);
}

/** C2: the XLSX route sets the sheet type, the fixed file name and `no-store`. */
export async function theXlsxRouteSetsItsThreeHeaders(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  await h.controller.energyViewXlsx(USER, EXPORT_QUERY, r.res);
  expect(r.headers).toEqual([
    ["Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["Content-Disposition", 'attachment; filename="energy-view.xlsx"'],
    ["Cache-Control", "no-store"],
  ]);
}

/** C3: both keys are registered on the read's own query schema, by identity. */
export function bothExportKeysRegisterTheViewSchemaByIdentity(): void {
  expect(REQUEST_SCHEMAS.ReportsController_energyViewCsv).toBe(energyViewQuerySchema);
  expect(REQUEST_SCHEMAS.ReportsController_energyViewXlsx).toBe(energyViewQuerySchema);
}
