import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { LocationTypesVocabularyAdminController } from "./location-types.controller";
import type { LocationTypesVocabularyAdminService } from "./location-types.service";

/**
 * `F4.282` (ADR 0030) — the controller's parse boundary, with no database. The
 * two bodies now come from `@bms/shared`, while `toBadRequest` still asks
 * `err instanceof ZodError` with the api's own `zod`: the cross-package identity
 * hazard `asset-roles.schema.ts` records. `asset-roles.controller.spec.ts` is the
 * model. A malformed body must stay a 400 carrying `flatten()`, never a raw
 * `ZodError` (a 500), and the service must not see it.
 */

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

const ROW = { code: "pump_station", label: "Pump station", sortOrder: 40, active: true };

function stubService(): { service: LocationTypesVocabularyAdminService; calls: unknown[] } {
  const calls: unknown[] = [];
  const service = {
    async create(_jwt: JwtPayload, body: unknown) {
      calls.push(body);
      return ROW;
    },
    async update(_jwt: JwtPayload, code: string, body: unknown) {
      calls.push({ code, body });
      return ROW;
    },
  } as unknown as LocationTypesVocabularyAdminService;
  return { service, calls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

function fieldErrorsOf(err: unknown): Record<string, string[]> | undefined {
  return ((err as BadRequestException).getResponse() as { fieldErrors?: Record<string, string[]> }).fieldErrors;
}

/** A create body with an upper-case code is a 400 naming `code`, before the service is called. */
export async function aMalformedCreateBodyIsABadRequest(): Promise<void> {
  const { service, calls } = stubService();
  const err = await rejects(() => new LocationTypesVocabularyAdminController(service).create({ code: "BAD", label: "x" }, JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(fieldErrorsOf(err)?.code?.length ?? 0).toBeGreaterThan(0);
  expect(calls).toEqual([]);
}

/** The positive control: a valid create body reaches the service. */
export async function aValidCreateBodyReachesTheService(): Promise<void> {
  const { service, calls } = stubService();
  await new LocationTypesVocabularyAdminController(service).create({ code: "pump_station", label: "Pump station" }, JWT);
  expect(calls).toEqual([{ code: "pump_station", label: "Pump station" }]);
}

/** A PATCH body naming `code` (not editable, `.strict()`) is a 400, before the service is called. */
export async function aPatchBodyNamingCodeIsABadRequest(): Promise<void> {
  const { service, calls } = stubService();
  const err = await rejects(() => new LocationTypesVocabularyAdminController(service).update("pump_station", { code: "x" }, JWT));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(((err as BadRequestException).getResponse() as { formErrors?: string[] }).formErrors?.length ?? 0).toBeGreaterThan(0);
  expect(calls).toEqual([]);
}
