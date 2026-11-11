import { DROP_REASONS } from "../device-health";
import {
  deviceHealthResponseSchema,
  rtuDropHistoryResponseSchema,
  rtuHealthDtoSchema,
} from "./device-health";

/**
 * `F3.16` / ADR 0127 decisions 7, 8, 17 and 19 — the device-health read
 * contracts. Assertions live here; `device-health.test.ts` is the vitest entry
 * point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const first = {
  assetId: "a1",
  assetCode: "INV-1",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  pointKey: "ac_power",
  sourceKey: null,
};

const item = {
  rtuId: "r1",
  state: "online",
  lastSeenAt: "2026-11-11T10:00:00.000Z",
  windowSeconds: 25,
  clockSkewSeconds: -3,
  clockSkewAt: "2026-11-11T10:00:00.000Z",
  edgeServed: false,
  drops24h: [{ reason: "badQuality", count: 4, firstAt: "2026-11-11T09:00:00.000Z", first }],
};

const response = {
  ingestHost: { state: "ok", lastBeatAt: "2026-11-11T10:00:05.000Z" },
  items: [item],
  unattributed: [
    {
      hostKey: "h1",
      endpointKey: "mqtts://broker:8883",
      reason: "unknownDevice",
      count: 2,
      firstDeviceKey: "dev-9",
      firstSourceKey: null,
    },
  ],
};

const history = {
  items: [
    {
      bucket: "2026-11-11T09:00:00.000Z",
      reason: "outOfRange",
      count: 1,
      first: null,
    },
  ],
};

/** A full fixture of each response parses, including every nullable at null. */
export function runFullFixturesParseTest(): void {
  assert(
    deviceHealthResponseSchema.safeParse(response).success,
    "a full health response must parse",
  );
  assert(
    rtuDropHistoryResponseSchema.safeParse(history).success,
    "a full drop history must parse",
  );
  const nulls = {
    ...item,
    state: "not_monitored",
    lastSeenAt: null,
    clockSkewSeconds: null,
    clockSkewAt: null,
    edgeServed: true,
    drops24h: [],
  };
  assert(
    rtuHealthDtoSchema.safeParse(nulls).success,
    "an unmonitored RTU with nulls must parse",
  );
  assert(
    deviceHealthResponseSchema.safeParse({
      ...response,
      ingestHost: { state: "never", lastBeatAt: null },
      unattributed: [],
    }).success,
    "a never-beat host with no unattributed rows must parse",
  );
}

/** An unknown RTU state or host state is refused. */
export function runUnknownStateRefusedTest(): void {
  assert(
    !rtuHealthDtoSchema.safeParse({ ...item, state: "down" }).success,
    "an unknown RTU state must be refused",
  );
  assert(
    !deviceHealthResponseSchema.safeParse({
      ...response,
      ingestHost: { state: "down", lastBeatAt: null },
    }).success,
    "an unknown host state must be refused",
  );
}

/** The closed list is six reasons: a seventh is refused everywhere a reason appears. */
export function runSeventhReasonRefusedTest(): void {
  assert(DROP_REASONS.length === 6, "DROP_REASONS holds six reasons");
  const bad = {
    ...item,
    drops24h: [{ reason: "seventh", count: 1, first: null }],
  };
  assert(
    !rtuHealthDtoSchema.safeParse(bad).success,
    "a seventh reason on an RTU must be refused",
  );
  assert(
    !rtuDropHistoryResponseSchema.safeParse({
      items: [{ ...history.items[0], reason: "seventh" }],
    }).success,
    "a seventh reason in the history must be refused",
  );
  assert(
    !deviceHealthResponseSchema.safeParse({
      ...response,
      unattributed: [{ ...response.unattributed[0], reason: "seventh" }],
    }).success,
    "a seventh reason in unattributed must be refused",
  );
}

/** `edgeServed` is required on every item. */
export function runEdgeServedRequiredTest(): void {
  const { edgeServed: _edgeServed, ...without } = item;
  assert(
    !rtuHealthDtoSchema.safeParse(without).success,
    "an item without edgeServed must be refused",
  );
}
