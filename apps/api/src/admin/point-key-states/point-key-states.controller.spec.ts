import { BadRequestException, HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";
import { z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { PointKeyStatesAdminController } from "./point-key-states.controller";
import type { PointKeyStatesAdminService } from "./point-key-states.service";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 1 (plan C6) — the four routes, constructed directly
 * with a stubbed service (AGENTS.md §4.6: no Nest module in a test). The service owns the gate
 * order (403 → body → 404 → 409, plan C7), so the controller hands it the raw body and turns a
 * `ZodError` into a 400. The `.test.ts` sibling runs these.
 */

const JWT = { sub: "u", email: "admin@bms.local", role: "admin" } as unknown as JwtPayload;
const ID = "00000000-0000-4000-8000-000000000001";

function controllerWith(calls: string[], fail?: unknown): PointKeyStatesAdminController {
  const answer = async (call: string): Promise<{ call: string }> => {
    calls.push(call);
    if (fail !== undefined) throw fail;
    return { call };
  };
  const service = {
    list: (jwt: JwtPayload) => answer(`list ${jwt.email}`),
    create: (_jwt: JwtPayload, body: unknown) => answer(`create ${JSON.stringify(body)}`),
    update: (_jwt: JwtPayload, id: string, body: unknown) => answer(`update ${id} ${JSON.stringify(body)}`),
    remove: async (_jwt: JwtPayload, id: string) => {
      await answer(`remove ${id}`);
    },
  };
  return new PointKeyStatesAdminController(service as unknown as PointKeyStatesAdminService);
}

const outcome = (run: Promise<unknown>): Promise<unknown> =>
  run.then(
    (value) => value,
    (err: unknown) => (err instanceof BadRequestException ? "400" : err),
  );

/** Mounted at `admin/point-key-states`, with `DELETE :id` answering 204. */
export function theRoutesAreMountedWithA204Delete(): void {
  expect(Reflect.getMetadata(PATH_METADATA, PointKeyStatesAdminController)).toBe("admin/point-key-states");
  const proto = PointKeyStatesAdminController.prototype;
  expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.remove)).toBe(HttpStatus.NO_CONTENT);
  expect(Reflect.getMetadata(PATH_METADATA, proto.update)).toBe(":id");
  expect(Reflect.getMetadata(PATH_METADATA, proto.remove)).toBe(":id");
}

/** `GET` lists for the caller. */
export async function theListRouteCallsList(): Promise<void> {
  const calls: string[] = [];
  expect(await controllerWith(calls).list(JWT)).toEqual({ call: "list admin@bms.local" });
  expect(calls).toEqual(["list admin@bms.local"]);
}

/** `POST` hands the raw body to the service, which parses it after its gate. */
export async function theCreateRoutePassesTheRawBody(): Promise<void> {
  const calls: string[] = [];
  const body = { pointKey: "breaker_aux", value: 2, label: "EARTHED", tone: "open", extra: true };
  await controllerWith(calls).create(body, JWT);
  expect(calls).toEqual([`create ${JSON.stringify(body)}`]);
}

/** A `ZodError` the service throws (a body refused after the gate) is a 400, on both writes. */
export async function aZodErrorFromTheServiceIsA400(): Promise<void> {
  const zodError = z.object({ label: z.string() }).safeParse({}).error;
  expect(await outcome(controllerWith([], zodError).create({}, JWT))).toBe("400");
  expect(await outcome(controllerWith([], zodError).update(ID, {}, JWT))).toBe("400");
  // Anything else passes through untouched (a 403 stays a 403).
  const other = new Error("not a zod error");
  expect(await outcome(controllerWith([], other).create({}, JWT))).toBe(other);
}

/** A malformed `:id` is a 400 on `PATCH` and `DELETE`, and the service is never reached. */
export async function aMalformedIdIsA400BeforeTheService(): Promise<void> {
  const calls: string[] = [];
  expect(await outcome(controllerWith(calls).update("not-a-uuid", { label: "X" }, JWT))).toBe("400");
  expect(await outcome(controllerWith(calls).remove("not-a-uuid", JWT))).toBe("400");
  expect(calls).toEqual([]);
}

/** `PATCH :id` and `DELETE :id` reach `update` and `remove` with the id; `DELETE` answers no body. */
export async function theIdRoutesCallTheirOwnMethods(): Promise<void> {
  const calls: string[] = [];
  await controllerWith(calls).update(ID, { tone: "shut" }, JWT);
  expect(await controllerWith(calls).remove(ID, JWT)).toBeUndefined();
  expect(calls).toEqual([`update ${ID} {"tone":"shut"}`, `remove ${ID}`]);
}
