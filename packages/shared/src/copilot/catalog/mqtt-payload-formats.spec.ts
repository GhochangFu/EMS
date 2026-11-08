import { expect } from "vitest";

import {
  createMqttPayloadFormatBodySchema,
  setRtuPayloadFormatBodySchema,
  updateMqttPayloadFormatBodySchema,
} from "../../contracts/mqtt-payload-formats";
import { COPILOT_CATALOG, DELETE_ALLOWANCE, EXCLUDED_ROUTES } from "./index";

/**
 * `F4.334` / ADR 0099 Amendment 17 decisions 1, 4 and 5 — the payload format
 * entries and `rtu.setPayloadFormat`. Vitest entry point: the sibling `.test.ts`.
 */

const byId = (id: string) => {
  const entry = COPILOT_CATALOG.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no catalog entry ${id}`);
  return entry;
};

export function theThreeFormatEntriesAreTheGlobalAdmins(): void {
  const create = byId("mqttPayloadFormat.create");
  const update = byId("mqttPayloadFormat.update");
  const remove = byId("mqttPayloadFormat.delete");
  expect(create.body).toBe(createMqttPayloadFormatBodySchema);
  expect(update.body).toBe(updateMqttPayloadFormatBodySchema);
  for (const entry of [create, update, remove]) {
    expect(entry.offeredTo).toEqual(["admin"]);
  }
  expect(create.target).toEqual({ kind: "fleet" });
  expect(update.target).toEqual({ kind: "vocabulary", of: "mqttPayloadFormat", param: "code" });
  expect(remove.target).toEqual(update.target);
  expect(update.precondition).toBe("updatedAt");
  expect(remove.red).toBe(true);
  expect(create.steps.map((s) => s.id)).toEqual(["format", "definition"]);
}

export function theSummariesSayPlatformWideAndCountTheRtus(): void {
  const update = byId("mqttPayloadFormat.update").summary({
    body: { description: "x" },
    params: { code: "thinkiot-register-array" },
    targetName: "ThinkIoT register array",
    organizationName: "BCPL",
    usageCount: 21,
  });
  expect(update).toContain("platform-wide");
  expect(update).toContain("21 RTU(s) in BCPL");
  const remove = byId("mqttPayloadFormat.delete").summary({
    body: {},
    params: { code: "acme" },
    targetName: "Acme",
    organizationName: "",
    usageCount: 0,
  });
  expect(remove).toContain("cannot be undone");
}

export function theRtuEntryNamesTheOldAndNewFormat(): void {
  const entry = byId("rtu.setPayloadFormat");
  expect(entry.body).toBe(setRtuPayloadFormatBodySchema);
  expect(entry.target).toEqual({ kind: "rtu", param: "id" });
  const text = entry.summary({
    body: { payloadFormat: "thinkiot-register-array" },
    params: { id: "x" },
    targetName: "BCPL_LAKWA_02",
    organizationName: "BCPL",
    payloadFormat: null,
  });
  expect(text).toContain('"BCPL_LAKWA_02"');
  expect(text).toContain("the built-in ThinkIoT envelope");
  expect(text).toContain('"thinkiot-register-array"');
}

export function onlyTheTestRouteStaysExcluded(): void {
  const mqtt = EXCLUDED_ROUTES.filter((r) => r.path.startsWith("/admin/mqtt-payload-formats") || r.path.endsWith("/payload-format"));
  expect(mqtt.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /admin/mqtt-payload-formats/test"]);
  expect(DELETE_ALLOWANCE).toContainEqual({ method: "DELETE", path: "/admin/mqtt-payload-formats/:code" });
}
