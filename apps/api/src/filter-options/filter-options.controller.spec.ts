import "reflect-metadata";

import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";

import type { JwtPayload } from "@bms/shared";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FilterOptionsController } from "./filter-options.controller";
import type { FilterOptionsService } from "./filter-options.service";

/**
 * `F4.361` U3 — the `GET /filter-options` route's wiring, with no database:
 * it is behind `JwtAuthGuard` and answers the service's read for the caller.
 * `filter-options.controller.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };

/** The route is `filter-options` and every handler sits behind `JwtAuthGuard`. */
export function assertTheRouteIsGuarded(): void {
  const path: unknown = Reflect.getMetadata(PATH_METADATA, FilterOptionsController);
  assert(path === "filter-options", `the controller path is ${String(path)}`);
  const guards = (Reflect.getMetadata(GUARDS_METADATA, FilterOptionsController) ?? []) as unknown[];
  assert(guards.includes(JwtAuthGuard), "FilterOptionsController is not behind JwtAuthGuard");
}

/** The handler answers the service's read for the signed-in caller. */
export async function assertTheHandlerAnswersTheCallersOptions(): Promise<void> {
  const answer = { organizations: [], locations: [], assetGroups: [], assets: [] };
  const seen: JwtPayload[] = [];
  const service = {
    options: async (user: JwtPayload) => {
      seen.push(user);
      return answer;
    },
  } as unknown as FilterOptionsService;
  const result = await new FilterOptionsController(service).list(USER);
  assert(result === answer, "the handler did not return the service's answer");
  assert(seen.length === 1 && seen[0] === USER, "the service was not asked for the signed-in caller");
}
