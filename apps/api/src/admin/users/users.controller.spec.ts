import "reflect-metadata";

import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { AssetGroupsAdminController } from "../asset-groups/asset-groups.controller";
import { UsersAdminController } from "./users.controller";
import type { UsersService } from "./users.service";

/**
 * `F3.78` / ADR 0089 decision 1 — every users route is behind `JwtAuthGuard`
 * (the `system-status.controller.spec.ts` shape: read the class-level guard
 * metadata the router reads), and the handlers pass the request through to
 * the service unchanged. Assertions here; `users.controller.test.ts` runs them.
 */

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

/** Positive control: the read finds `JwtAuthGuard` on a neighbour admin controller. */
export function assertGuardReadFindsTheNeighbourGuard(): void {
  expect(guardsOf(AssetGroupsAdminController)).toContain(JwtAuthGuard);
}

export function assertUsersControllerIsBehindJwtAuthGuard(): void {
  expect(guardsOf(UsersAdminController)).toContain(JwtAuthGuard);
}

export function assertUsersControllerPathIsAdminUsers(): void {
  expect(Reflect.getMetadata(PATH_METADATA, UsersAdminController)).toBe("admin/users");
}

/** Every handler hands the service the caller, the id and the raw body, and returns its answer. */
export async function assertHandlersPassThroughToTheService(): Promise<void> {
  const calls: string[] = [];
  const answer = { user: null, followUp: null };
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push(`${name}:${args.slice(1).map((arg) => JSON.stringify(arg)).join(",")}`);
      return answer;
    };
  const service = {
    list: record("list"),
    create: record("create"),
    update: record("update"),
    deactivate: record("deactivate"),
    reactivate: record("reactivate"),
    temporaryPassword: record("temporaryPassword"),
  } as unknown as UsersService;
  const controller = new UsersAdminController(service);
  const jwt = { sub: "s", email: "e", name: "n", role: "admin" } as JwtPayload;
  const id = "6f1c2c1e-9a4b-4c3e-8d2f-0a1b2c3d4e5f";
  await controller.list(jwt);
  await controller.create({ a: 1 }, jwt);
  await controller.update(id, { b: 2 }, jwt);
  await controller.deactivate(id, jwt);
  await controller.reactivate(id, jwt);
  const returned = await controller.temporaryPassword(id, { c: 3 }, jwt);
  expect(returned).toBe(answer);
  expect(calls).toEqual([
    "list:",
    'create:{"a":1}',
    `update:"${id}",{"b":2}`,
    `deactivate:"${id}"`,
    `reactivate:"${id}"`,
    `temporaryPassword:"${id}",{"c":3}`,
  ]);
}

/** A malformed `:id` is a 400 before the service runs. */
export async function assertAMalformedIdIs400(): Promise<void> {
  let reached = false;
  const service = {
    deactivate: async () => {
      reached = true;
    },
  } as unknown as UsersService;
  const controller = new UsersAdminController(service);
  const jwt = { sub: "s", email: "e", name: "n", role: "admin" } as JwtPayload;
  await expect(controller.deactivate("not-a-uuid", jwt)).rejects.toMatchObject({ status: 400 });
  expect(reached).toBe(false);
}
