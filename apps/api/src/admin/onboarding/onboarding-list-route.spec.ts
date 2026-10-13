import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { expect } from "vitest";

import type { JwtPayload, OnboardingDraftListDto } from "@bms/shared";

import { OnboardingController } from "./onboarding.controller";
import type { OnboardingService } from "./onboarding.service";

/**
 * `F4.255` (ADR 0099 Amendment 2 A1) — `GET /admin/onboarding/sessions?organizationId=…`:
 * the controller parses the organization id as a uuid (a 400 otherwise, and a
 * missing one too) and hands the caller and the id to `listDrafts`. Vitest
 * entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = { sub: "kc-1" } as JwtPayload;
const LIST: OnboardingDraftListDto = { items: [] };

function route() {
  const calls: unknown[][] = [];
  const service = {
    listDrafts: async (...args: unknown[]) => {
      calls.push(args);
      return LIST;
    },
  } as unknown as OnboardingService;
  return { controller: new OnboardingController(service), calls };
}

/** A uuid reaches `listDrafts(user, id)` and the route answers its list. */
export async function aUuidReachesTheList(): Promise<void> {
  const h = route();
  expect(await h.controller.listDrafts(ORG, USER)).toBe(LIST);
  expect(h.calls).toEqual([[USER, ORG]]);
}

/** A non-uuid organization id is a 400 before the service. */
export async function aNonUuidIsA400(): Promise<void> {
  const h = route();
  await expect(h.controller.listDrafts("not-a-uuid", USER)).rejects.toBeInstanceOf(BadRequestException);
  expect(h.calls).toEqual([]);
}

/**
 * The handler is mounted at `GET sessions` (the controller's `admin/onboarding`
 * prefix is unchanged). The direct calls above never read the decorators, so a
 * changed path stayed green.
 */
export function theHandlerIsMountedAtGetSessions(): void {
  const handler = OnboardingController.prototype.listDrafts;
  expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("sessions");
  expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
}

/** The first argument is the `organizationId` query key; a renamed key reached the handler as `undefined`. */
export function theOrganizationComesFromTheOrganizationIdQueryKey(): void {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, OnboardingController, "listDrafts") ?? {}) as Record<
    string,
    { index: number; data?: unknown }
  >;
  const queries = Object.entries(args)
    .filter(([key]) => key.startsWith(`${RouteParamtypes.QUERY}:`))
    .map(([, arg]) => ({ index: arg.index, data: arg.data }));
  expect(queries).toEqual([{ index: 0, data: "organizationId" }]);
}

/** A missing organization id is a 400 before the service. */
export async function aMissingOrganizationIsA400(): Promise<void> {
  const h = route();
  await expect(h.controller.listDrafts(undefined, USER)).rejects.toBeInstanceOf(BadRequestException);
  expect(h.calls).toEqual([]);
}
