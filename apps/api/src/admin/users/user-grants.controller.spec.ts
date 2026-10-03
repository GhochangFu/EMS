import "reflect-metadata";

import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { UserGrantsAdminController } from "./user-grants.controller";
import type { UserGrantsService } from "./user-grants.service";

/**
 * `F3.78` / ADR 0089 decision 12 — the grants routes are behind
 * `JwtAuthGuard` (the `users.controller.spec.ts` shape) and hand the request
 * to the service unchanged. Assertions here; `user-grants.controller.test.ts`
 * runs them.
 */

const ID = "6f1c2c1e-9a4b-4c3e-8d2f-0a1b2c3d4e5f";
const GRANT = "7a2d3d2f-0b5c-4d4f-9e3a-1b2c3d4e5f60";
const jwt = { sub: "s", email: "e", name: "n", role: "admin" } as JwtPayload;

export function assertGrantsControllerIsBehindJwtAuthGuard(): void {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, UserGrantsAdminController) as unknown[] | undefined) ?? [];
  expect(guards).toContain(JwtAuthGuard);
}

/** The three routes: `GET`/`POST :id/grants`, `DELETE :id/grants/:kind/:grantId`, under `admin/users`. */
export function assertGrantsRoutesAreTheThreeOfDecision12(): void {
  const proto = UserGrantsAdminController.prototype as unknown as Record<string, object>;
  const route = (name: string) => [
    RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name]) as number],
    Reflect.getMetadata(PATH_METADATA, proto[name]),
  ];
  expect(Reflect.getMetadata(PATH_METADATA, UserGrantsAdminController)).toBe("admin/users");
  expect([route("list"), route("add"), route("remove")]).toEqual([
    ["GET", ":id/grants"],
    ["POST", ":id/grants"],
    ["DELETE", ":id/grants/:kind/:grantId"],
  ]);
}

export async function assertGrantsHandlersPassThroughToTheService(): Promise<void> {
  const calls: unknown[][] = [];
  const answer = { items: [] };
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.slice(1)]);
      return answer;
    };
  const service = { list: record("list"), add: record("add"), remove: record("remove") } as unknown as UserGrantsService;
  const controller = new UserGrantsAdminController(service);
  await controller.list(ID, jwt);
  await controller.add(ID, { kind: "location" }, jwt);
  expect(await controller.remove(ID, "location", GRANT, jwt)).toBe(answer);
  expect(calls).toEqual([
    ["list", ID],
    ["add", ID, { kind: "location" }],
    ["remove", ID, "location", GRANT],
  ]);
}

/** A malformed `:id` or `:grantId` is a 400 before the service runs. */
export async function assertAMalformedGrantIdIs400(): Promise<void> {
  let reached = false;
  const service = {
    remove: async () => {
      reached = true;
    },
  } as unknown as UserGrantsService;
  const controller = new UserGrantsAdminController(service);
  await expect(controller.remove(ID, "location", "not-a-uuid", jwt)).rejects.toMatchObject({ status: 400 });
  await expect(controller.remove("not-a-uuid", "location", GRANT, jwt)).rejects.toMatchObject({ status: 400 });
  expect(reached).toBe(false);
}
