import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RtusAdminController } from "./rtus.controller";
import { RTU_WILDCARD_TOPIC_MESSAGE } from "./rtus.schema";
import type { RtusAdminService } from "./rtus.service";

/**
 * `F4.221` — `POST /admin/rtus` and `PATCH /admin/rtus/:id` refuse an MQTT wildcard topic.
 *
 * Ingest refuses a `#` or `+` device topic and the host skips the RTU with
 * `invalid-device-config`, so an RTU saved with one never ingests. The admin routes now refuse
 * it at the door, for every RTU, with the same shared predicate (`mqttTopicHasWildcard`).
 *
 * The controller is built over a fake service that records calls, so each case can say both
 * what the route answered and whether the write was reached. Assertions live here;
 * `rtus.controller.wildcard-topic.test.ts` is the vitest entry point (ADR 0014).
 */

const JWT: JwtPayload = {
  sub: "44444444-4444-4444-8444-444444444444",
  email: "admin@bms.local",
  role: "admin",
} as JwtPayload;

const RTU_ID = "55555555-5555-4555-8555-555555555555";

type Recorded = { create: unknown[]; update: unknown[] };

function build(): { controller: RtusAdminController; calls: Recorded } {
  const calls: Recorded = { create: [], update: [] };
  const fake = {
    create: async (_user: JwtPayload, body: unknown) => {
      calls.create.push(body);
      return { id: RTU_ID };
    },
    update: async (_user: JwtPayload, _id: string, body: unknown) => {
      calls.update.push(body);
      return { id: RTU_ID };
    },
  } as unknown as RtusAdminService;
  return { controller: new RtusAdminController(fake), calls };
}

function createBody(mqttTopic: string): Record<string, unknown> {
  return {
    locationId: "66666666-6666-4666-8666-666666666666",
    code: "RTU-F4221",
    displayName: "F4.221 RTU",
    sourceType: "mqtt",
    mqttTopic,
  };
}

/** The first `mqttTopic` field error of a rejected call — a non-400 fails the case. */
async function mqttTopicError(call: Promise<unknown>): Promise<string | undefined> {
  const err = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  const response = (err as BadRequestException).getResponse() as {
    fieldErrors?: Record<string, string[] | undefined>;
  };
  return response.fieldErrors?.mqttTopic?.[0];
}

/** (1) POST with `plant/#` answers 400 with the sentence on `mqttTopic`. */
export async function createRefusesAWildcardTopicWithTheSentence(): Promise<void> {
  const { controller } = build();
  expect(await mqttTopicError(controller.create(createBody("plant/#"), JWT))).toBe(
    RTU_WILDCARD_TOPIC_MESSAGE,
  );
}

/** (2) PATCH with `plant/+` answers 400 with the sentence on `mqttTopic`. */
export async function updateRefusesAWildcardTopicWithTheSentence(): Promise<void> {
  const { controller } = build();
  expect(await mqttTopicError(controller.update(RTU_ID, { mqttTopic: "plant/+" }, JWT))).toBe(
    RTU_WILDCARD_TOPIC_MESSAGE,
  );
}

/** The sentence itself — a reworded or emptied message reddens here, not only by reference. */
export function theSentenceNamesBothWildcards(): void {
  expect(RTU_WILDCARD_TOPIC_MESSAGE).toBe(
    "MQTT topic must name one device; # and + are wildcards",
  );
}

/** (3) A refused wildcard never reaches the service — neither the create nor the update. */
export async function aRefusedWildcardNeverReachesTheService(): Promise<void> {
  const { controller, calls } = build();
  await controller.create(createBody("#"), JWT).catch(() => undefined);
  await controller.update(RTU_ID, { mqttTopic: "+" }, JWT).catch(() => undefined);
  expect(calls.create).toHaveLength(0);
  expect(calls.update).toHaveLength(0);
}

/** (4) Positive control for (3): an ordinary topic reaches the service once, unchanged. */
export async function anOrdinaryTopicReachesTheService(): Promise<void> {
  const { controller, calls } = build();
  await controller.update(RTU_ID, { mqttTopic: "plant/line1" }, JWT);
  expect(calls.update).toEqual([{ mqttTopic: "plant/line1" }]);
}

/** Positive control on POST: an ordinary topic creates. */
export async function createAcceptsAnOrdinaryTopic(): Promise<void> {
  const { controller, calls } = build();
  await controller.create(createBody("plant/line1"), JWT);
  expect(calls.create).toHaveLength(1);
}
