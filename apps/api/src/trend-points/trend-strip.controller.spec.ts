import { BadRequestException } from "@nestjs/common";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { expect } from "vitest";
import { ZodError } from "zod";

import { siteTrendStripQuerySchema, type JwtPayload } from "@bms/shared";

import { REQUEST_SCHEMAS } from "../openapi/openapi-registry";
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

const CSV = "zone,Asia/Kolkata\n";
const XLSX_BODY = Buffer.from("PK-workbook");

function harness() {
  const calls: unknown[][] = [];
  const exportCalls: unknown[][] = [];
  const answer = { marker: "strip" };
  const controller = new SiteTrendStripController({
    forSite: async (...args: unknown[]) => {
      calls.push(args);
      return answer;
    },
    // `F4.303` U4: the two export methods.
    exportCsv: async (...args: unknown[]) => {
      exportCalls.push(["csv", ...args]);
      return CSV;
    },
    exportXlsx: async (...args: unknown[]) => {
      exportCalls.push(["xlsx", ...args]);
      return XLSX_BODY;
    },
  } as never);
  return { controller, calls, exportCalls, answer };
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

// ---------------------------------------------------------------------------
// `F4.303` U4 (ADR 0108 Amendment 6 item 3) — `…/trend-strip/export.csv|.xlsx`
// on `siteTrendStripQuerySchema` by identity, beside the read.
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

const EXPORT_QUERY = { range: "7d", assetGroupId: GROUP };

/** The CSV route hands `(user, id, dto)` to the export and returns its string. */
export async function theCsvExportHandsTheDtoToTheService(): Promise<void> {
  const h = harness();
  const out = await h.controller.exportCsv(SITE, EXPORT_QUERY, USER);
  expect(h.exportCalls).toEqual([["csv", USER, SITE, EXPORT_QUERY]]);
  expect(out).toBe(CSV);
}

/** A bad query on the CSV route is a 400 with `flatten()` naming `range`, and the export is not called. */
export async function theCsvExportRefusesABadQueryWithFlatten(): Promise<void> {
  const h = harness();
  const err = await badRequest(h.controller.exportCsv(SITE, { range: "1y" }, USER));
  const body = err.getResponse() as { fieldErrors?: Record<string, unknown> };
  expect(Object.keys(body.fieldErrors ?? {})).toEqual(["range"]);
  expect(h.exportCalls).toEqual([]);
}

/** The id is parsed before the query: a bad id with a bad query is the id's `ZodError`, not the query's 400. */
export async function theExportParsesTheIdBeforeTheQuery(): Promise<void> {
  const h = harness();
  const err = await caughtFrom(h.controller.exportCsv("not-a-uuid", { range: "1y" }, USER));
  expect(err).toBeInstanceOf(ZodError);
  expect(h.exportCalls).toEqual([]);
}

/** The XLSX route hands `(user, id, dto)` to the export and sends its buffer. */
export async function theXlsxExportSendsTheServicesBuffer(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  await h.controller.exportXlsx(SITE, EXPORT_QUERY, USER, r.res);
  expect(h.exportCalls).toEqual([["xlsx", USER, SITE, EXPORT_QUERY]]);
  expect(r.sent).toEqual([XLSX_BODY]);
}

/** A bad query on the XLSX route is a 400 with `flatten()`, and nothing is sent. */
export async function theXlsxExportRefusesABadQueryWithFlatten(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  const err = await badRequest(h.controller.exportXlsx(SITE, { range: "1y" }, USER, r.res));
  expect((err.getResponse() as { fieldErrors?: unknown }).fieldErrors).toBeDefined();
  expect(h.exportCalls).toEqual([]);
  expect(r.sent).toEqual([]);
}

/** The CSV route's three headers: the CSV type, the fixed file name, `no-store`. */
export function theCsvExportSendsItsThreeHeaders(): void {
  const headers =
    (Reflect.getMetadata(HEADERS_METADATA, SiteTrendStripController.prototype.exportCsv) as
      | Array<{ name: string; value: string }>
      | undefined) ?? [];
  expect([...headers].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "Cache-Control", value: "no-store" },
    { name: "Content-Disposition", value: 'attachment; filename="trend-strip.csv"' },
    { name: "Content-Type", value: "text/csv; charset=utf-8" },
  ]);
}

/** The XLSX route sets the sheet type, the fixed file name and `no-store`. */
export async function theXlsxExportSetsItsThreeHeaders(): Promise<void> {
  const h = harness();
  const r = fakeResponse();
  await h.controller.exportXlsx(SITE, EXPORT_QUERY, USER, r.res);
  expect(r.headers).toEqual([
    ["Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["Content-Disposition", 'attachment; filename="trend-strip.xlsx"'],
    ["Cache-Control", "no-store"],
  ]);
}

/** The registry holds both export keys on the read's own query schema, by identity. */
export function theRegistryHoldsBothExportKeysByIdentity(): void {
  expect(REQUEST_SCHEMAS.SiteTrendStripController_exportCsv).toBe(siteTrendStripQuerySchema);
  expect(REQUEST_SCHEMAS.SiteTrendStripController_exportXlsx).toBe(siteTrendStripQuerySchema);
}
