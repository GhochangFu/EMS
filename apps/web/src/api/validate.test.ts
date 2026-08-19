import {
  alarmListItemSchema,
  alarmsListResponseSchema,
  locationDashboardDtoSchema,
} from "@bms/shared/contracts";
import { describe, expect, it, vi } from "vitest";

import { ResponseContractError, checkResponse, readJson } from "./validate";

/**
 * ADR 0030 decision 5 — the response validator.
 *
 * These run under vitest, where this repo reports `{ DEV: true, MODE: "test" }`
 * — verified, not assumed — so `checkResponse` is in its **throwing** branch
 * throughout. The log-and-pass branch cannot be exercised from here without
 * faking `import.meta.env`, so the case that covers it asserts the property
 * that actually matters and is environment-independent: **the value comes back
 * unchanged either way.**
 */

const validAlarm = {
  id: "a1",
  assetId: "as1",
  ruleKey: null,
  ruleId: null,
  severity: "warning",
  message: "Temperature high",
  raisedAt: "2026-08-15T10:00:00Z",
  acknowledgedAt: null,
  acknowledgedBy: null,
  assetCode: "AHU-1",
  assetName: "Air Handler 1",
  siteName: "Campus",
};

describe("checkResponse", () => {
  it("returns the payload unchanged when it matches", () => {
    const out = checkResponse(alarmListItemSchema, validAlarm, "alarms");
    expect(out).toBe(validAlarm);
  });

  it("does NOT strip fields the schema has not caught up with", () => {
    // The single most important property here. Zod strips unknown keys on
    // parse, so returning `result.data` would silently delete a field the
    // server has newly added — a client one version behind would erase data
    // rather than ignore it. The identity assertion above proves the value is
    // not re-created; this proves the consequence a reader would care about.
    const withNewField = { ...validAlarm, acknowledgedByName: "R. Patel" };
    const out = checkResponse(alarmListItemSchema, withNewField, "alarms");
    expect(out).toHaveProperty("acknowledgedByName", "R. Patel");
    expect(Object.keys(out)).toHaveLength(Object.keys(withNewField).length);
  });

  it("throws in dev and test when a field drifts", () => {
    const drifted = { ...validAlarm, raisedAt: 1_723_723_200 };
    expect(() => checkResponse(alarmListItemSchema, drifted, "alarms")).toThrow(
      ResponseContractError,
    );
  });

  it("throws when a declared field is missing entirely", () => {
    const { siteName, ...missing } = validAlarm;
    void siteName;
    expect(() => checkResponse(alarmListItemSchema, missing, "alarms")).toThrow(
      ResponseContractError,
    );
  });

  it("reports the path and code, and NEVER the received value", () => {
    // AGENTS.md §9.6. Zod's own `message` for an enum or literal mismatch
    // embeds the received value ("…received 'x'"), and `issue.received` holds
    // it outright — so a naive `JSON.stringify(error.issues)` would publish
    // whatever the server sent into a shared workstation's console. The
    // reduction to `{ path, code }` is what stops that, and this is the test
    // that would fail if someone "improved" the diagnostics.
    const secretish = "operator@ion-exchange.example";
    const drifted = { ...validAlarm, severity: 42, assetName: secretish };

    let caught: ResponseContractError | undefined;
    try {
      checkResponse(alarmListItemSchema, drifted, "alarms");
    } catch (e) {
      caught = e as ResponseContractError;
    }

    expect(caught).toBeInstanceOf(ResponseContractError);
    expect(caught?.issues).toEqual([{ path: "severity", code: "invalid_type" }]);

    const serialised = JSON.stringify(caught?.issues) + String(caught?.message);
    expect(serialised).not.toContain(secretish);
    expect(serialised).not.toContain("42");
  });

  it("names a nested path so a deep drift is findable", () => {
    // The envelope schema is exercised through the same helper the api layer
    // uses, so the reported path is the one a developer would grep for.
    const wrapper = { items: [validAlarm, { ...validAlarm, id: 9 }], nextCursor: null };
    let caught: ResponseContractError | undefined;
    try {
      checkResponse(alarmsListResponseSchema, wrapper, "alarms");
    } catch (e) {
      caught = e as ResponseContractError;
    }
    expect(caught?.issues.map((i) => i.path)).toContain("items.1.id");
  });

  it("accepts a real intersection payload rather than tripping on it", () => {
    // `LocationDashboardDto` is `LocationKpiSummary & { … }`, encoded with
    // `z.intersection` per ADR 0030 Amendment 1. Zod validates both halves and
    // merges — worth a live case, because an intersection that spuriously
    // failed would throw on GOOD data in development, which is the one
    // outcome worse than not validating at all.
    const dashboard = {
      id: "l1",
      name: "Campus",
      type: "smoc_campus",
      province: null,
      organization: { id: "o1", code: "IONX", name: "Ion Exchange" },
      rtuCount: 1,
      assetCount: 1,
      freshAssetCount: 1,
      totalKw: 5.5,
      openAlarms: 0,
      criticalAlarms: 0,
      scopeLabel: "full",
      rtus: [],
      assets: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      topAssets: [],
      workOrdersOpen: 0,
    };
    expect(() =>
      checkResponse(locationDashboardDtoSchema, dashboard, "dashboard/locations/:id"),
    ).not.toThrow();
  });
});

describe("readJson", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  it("checks a successful body", async () => {
    await expect(readJson(jsonResponse(validAlarm), alarmListItemSchema, "alarms")).resolves.toBe(
      validAlarm,
    );
  });

  it("refuses a non-2xx response instead of contract-checking an error body", async () => {
    // The guard-ordering hazard, made loud. Every reader in this directory
    // calls `clearSessionOnAuthFailure` before touching the body; handing a 401
    // here would skip that and report the error envelope as contract drift —
    // which the production branch would then swallow. A comment would not have
    // caught it; this does.
    //
    // And it must refuse WITHOUT reading the body: a 401 envelope is not a
    // contract, and parsing it is the step that would have skipped the session
    // clear. The spy proves the refusal happens first rather than after.
    const json = vi.fn(async () => ({ message: "Unauthorized" }));
    const res = { ok: false, status: 401, json } as unknown as Response;

    await expect(readJson(res, alarmListItemSchema, "alarms")).rejects.toThrow(
      /Handle `!res.ok` first/,
    );
    expect(json).not.toHaveBeenCalled();
  });
});
