import { NotFoundException } from "@nestjs/common";
import { expect, vi } from "vitest";
import { ZodError } from "zod";

import type { AlarmRootCauseSuggestionsResponse, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { AlarmRootCauseController } from "./alarm-root-cause.controller";
import type { AlarmRootCauseService } from "./alarm-root-cause.service";

/**
 * `E2.3` / ADR 0136 (plan §6 T1.3) — `GET /alarms/:id/root-cause-suggestions`
 * with stub services: the id is parsed before the scope is resolved, the scope
 * reaches the service unchanged, and the service's 404 is the route's 404.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ALARM_ID = "5b0c1a52-7d0e-4c55-9a51-3f1f3b2b6c01";
const USER = { sub: "00000000-0000-4000-8000-0000000000e2", role: "viewer" } as unknown as JwtPayload;
const ANSWER: AlarmRootCauseSuggestionsResponse = { computedAt: "2026-11-17T10:00:00.000Z", candidates: [], context: [] };

function harness(readable: string[] | null, get: AlarmRootCauseService["get"] = async () => ANSWER) {
  const readableAssetIds = vi.fn(async () => readable);
  const serviceGet = vi.fn(get);
  const controller = new AlarmRootCauseController(
    { get: serviceGet } as unknown as AlarmRootCauseService,
    { readableAssetIds } as unknown as AccessControlService,
  );
  return { controller, readableAssetIds, serviceGet };
}

/** A non-UUID id is a `ZodError` (the global filter's 400), before the scope is read or the service is called. */
export async function aNonUuidIdIsRefusedBeforeAnyRead(): Promise<void> {
  for (const id of ["not-a-uuid", "", "1; DROP TABLE x", `${ALARM_ID}x`]) {
    const { controller, readableAssetIds, serviceGet } = harness(["a"]);
    await expect(controller.rootCauseSuggestions(id, USER)).rejects.toBeInstanceOf(ZodError);
    expect(readableAssetIds).not.toHaveBeenCalled();
    expect(serviceGet).not.toHaveBeenCalled();
  }
}

/** The service receives `readableAssetIds`' value unchanged — an array, `[]` and `null` — and a clock. */
export async function theServiceReceivesTheScopeUnchanged(): Promise<void> {
  const ids = ["7d6d5b9e-34b8-4b52-8f64-3c86bb0a4e11", "0a9b7c2e-55f1-4d6a-9d2b-8e7f6a5b4c32"];
  for (const readable of [ids, [], null]) {
    const { controller, readableAssetIds, serviceGet } = harness(readable);
    await expect(controller.rootCauseSuggestions(ALARM_ID, USER)).resolves.toBe(ANSWER);
    expect(readableAssetIds).toHaveBeenCalledExactlyOnceWith(USER);
    expect(serviceGet).toHaveBeenCalledTimes(1);
    const [alarmId, assetIds, now] = serviceGet.mock.calls[0]!;
    expect(alarmId).toBe(ALARM_ID);
    expect(assetIds).toBe(readable);
    expect(now).toBeInstanceOf(Date);
  }
}

/** The scope is resolved before the service runs. */
export async function theScopeIsResolvedBeforeTheService(): Promise<void> {
  const order: string[] = [];
  const readableAssetIds = vi.fn(async () => {
    order.push("readableAssetIds");
    return null;
  });
  const controller = new AlarmRootCauseController(
    {
      get: vi.fn(async () => {
        order.push("service.get");
        return ANSWER;
      }),
    } as unknown as AlarmRootCauseService,
    { readableAssetIds } as unknown as AccessControlService,
  );
  await controller.rootCauseSuggestions(ALARM_ID, USER);
  expect(order).toEqual(["readableAssetIds", "service.get"]);
}

/** The service's `NotFoundException` passes through with its message. */
export async function theServicesNotFoundPassesThrough(): Promise<void> {
  const notFound = new NotFoundException("Alarm not found or outside your access scope");
  const { controller } = harness([], async () => {
    throw notFound;
  });
  await expect(controller.rootCauseSuggestions(ALARM_ID, USER)).rejects.toBe(notFound);
}
