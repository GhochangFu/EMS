import { expect } from "vitest";

import { parseMqttEnvelope } from "./mqtt-envelope";

/**
 * `F3.24b` — the ThinkIoT envelope parse, moved here from
 * `apps/ingest/src/adapters/mqtt.ts` so the discovery collector and the ingest
 * adapter read one function. The seven cases are the ingest spec's
 * `parsePayload` cases; that spec stays in place and unchanged, which is what
 * shows the move was faithful. Vitest entry point: the sibling `.test.ts`.
 */

export function theNestedValuesObjectIsUsed(): void {
  const parsed = parseMqttEnvelope(
    JSON.stringify({ dev_id: "RTU-1", values: { flow: 1 }, ts: 1_754_390_000_000 }),
  );
  expect(parsed.devId).toBe("RTU-1");
  expect(parsed.values.flow).toBe(1);
  expect(parsed.at?.getTime()).toBe(1_754_390_000_000);
}

export function aFlatPayloadIsItsOwnValueBag(): void {
  expect(parseMqttEnvelope(JSON.stringify({ dev_id: "RTU-1", flow: 2 })).values.flow).toBe(2);
}

export function aMissingTsLeavesAtUnset(): void {
  expect(parseMqttEnvelope(JSON.stringify({ dev_id: "RTU-1", values: { flow: 1 } })).at).toBeUndefined();
}

export function aNonNumericTsLeavesAtUnset(): void {
  expect(
    parseMqttEnvelope(JSON.stringify({ dev_id: "RTU-1", values: {}, ts: "nonsense" })).at,
  ).toBeUndefined();
}

export function aNullValuesFallsBackToTheBody(): void {
  expect(
    parseMqttEnvelope(JSON.stringify({ dev_id: "RTU-1", values: null, flow: 5 })).values.flow,
  ).toBe(5);
}

export function aTopLevelReadingBesideValuesIsReachable(): void {
  const parsed = parseMqttEnvelope(
    JSON.stringify({
      dev_id: "861736076104923",
      ts: "1782472726000",
      rssi: "29",
      values: { di1: "1", s09_r01: "10.81" },
    }),
  );
  expect(parsed.values.rssi).toBe("29");
  expect(parsed.values.s09_r01).toBe("10.81");
}

export function theEnvelopeFieldsAreNeverReadings(): void {
  const parsed = parseMqttEnvelope(
    JSON.stringify({ dev_id: "861736076104923", ts: 1_782_472_726_000, values: { flow: 1 } }),
  );
  expect(parsed.values.ts).toBeUndefined();
  expect(parsed.values.dev_id).toBeUndefined();
  expect(parsed.at?.getTime()).toBe(1_782_472_726_000);
}

export function theNestedBlockWinsACollision(): void {
  const parsed = parseMqttEnvelope(
    JSON.stringify({ dev_id: "RTU-1", flow: 99, values: { flow: 1 } }),
  );
  expect(parsed.values.flow).toBe(1);
}
