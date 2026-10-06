import { z } from "zod";

import type { OnboardingProtocol } from "./index";
import { mqttDraftConfigSchema } from "./ingest-adapters/mqtt";

/**
 * The onboarding protocol catalog (ADR 0093 decisions 2 and 3, `F3.24a`).
 *
 * Code, not a table. `bms.protocol_catalog` was declared in Drizzle but never
 * created by any migration, and `OnboardingProtocolService.listCatalog` read it
 * as `[]` from ADR 0011 until this row; its declaration is deleted. An
 * admin-editable catalog needs a new ADR.
 *
 * One read-only entry per `onboardingProtocolSchema` value. `ingestWired` is
 * derived from `INGEST_WIRED_PROTOCOLS`, never written by hand, and
 * `apps/ingest/src/adapter/registry.ts` checks its adapter map against that
 * list at compile time — so the catalog cannot claim live ingest for a
 * protocol no adapter serves.
 *
 * No field name or example key is a credential: the model and the guided reply
 * echo these, and a credential goes on the RTU step, never in chat. The
 * catalog spec and `onboarding-protocol.service.spec.ts` gate that rule.
 *
 * Reached through `./ingest`, which re-exports it: enter the module tree there,
 * because `./ingest-adapters/mqtt` imports `./ingest` back at runtime.
 */

/**
 * Protocols an ingest adapter serves today. An adapter PR (`F1.2`–`F1.6`) adds
 * its code here and its factory to the registry in the same change.
 */
export const INGEST_WIRED_PROTOCOLS = ["mqtt"] as const;

export type IngestWiredProtocol = (typeof INGEST_WIRED_PROTOCOLS)[number];

/**
 * One catalog entry. A plain read-only type, not a wire contract: no HTTP route
 * returns it, and it carries a zod schema object no `z.infer` can express. If a
 * route ever serves the catalog, `ProtocolCatalogView` becomes `z.infer` of a
 * `.readonly()` schema in `contracts/` (ADR 0030).
 */
export type ProtocolCatalogEntry = {
  readonly code: OnboardingProtocol;
  readonly label: string;
  readonly description: string;
  readonly ingestWired: boolean;
  readonly supportsDiscovery: boolean;
  readonly requiredFields: readonly string[];
  readonly optionalFields: readonly string[];
  readonly exampleConfig: Readonly<Record<string, unknown>>;
  /**
   * The schema the validator and the tools apply to `rtus[].config`;
   * `z.record(z.unknown())` for a protocol with no adapter (decision 6).
   */
  readonly draftConfigSchema: z.ZodTypeAny;
};

/** An entry as the model sees it: everything but the schema object. */
export type ProtocolCatalogView = Omit<ProtocolCatalogEntry, "draftConfigSchema">;

/** Any config is accepted for a protocol nothing ingests (decision 6). */
const anyConfig = z.record(z.unknown());

function isWired(code: OnboardingProtocol): boolean {
  return (INGEST_WIRED_PROTOCOLS as readonly string[]).includes(code);
}

function entry(fields: Omit<ProtocolCatalogEntry, "ingestWired">): ProtocolCatalogEntry {
  return Object.freeze({ ...fields, ingestWired: isWired(fields.code) });
}

/** Keyed by code, so a missing or an extra protocol is a compile error. Declaration order is display order. */
const PROTOCOL_CATALOG_BY_CODE: Readonly<Record<OnboardingProtocol, ProtocolCatalogEntry>> = {
  mqtt: entry({
    code: "mqtt",
    label: "MQTT",
    description:
      "Subscribes to one device topic on an MQTT broker over TLS. The broker credentials are entered on the RTU step, never in chat.",
    supportsDiscovery: false,
    requiredFields: ["topic"],
    optionalFields: ["host", "port"],
    exampleConfig: { host: "phe.thinkiot.co.in", port: 8883, topic: "Airsprint-1051/Data/1051" },
    draftConfigSchema: mqttDraftConfigSchema,
  }),
  simulator: entry({
    code: "simulator",
    label: "Simulator",
    description: "Readings come from the built-in telemetry simulator; no device connection.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: [],
    exampleConfig: {},
    draftConfigSchema: anyConfig,
  }),
  catalog: entry({
    code: "catalog",
    label: "Catalog import",
    description: "Assets and points come from a catalog workbook; no live readings.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: [],
    exampleConfig: {},
    draftConfigSchema: anyConfig,
  }),
  modbus_tcp: entry({
    code: "modbus_tcp",
    label: "Modbus TCP",
    description: "Polls holding and input registers over TCP. Adapter F1.2 is not wired yet: config only.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: ["host", "port", "unitId", "pollIntervalMs"],
    exampleConfig: { host: "127.0.0.1", port: 502, unitId: 1, pollIntervalMs: 5000 },
    draftConfigSchema: anyConfig,
  }),
  bacnet: entry({
    code: "bacnet",
    label: "BACnet/IP",
    description: "Reads BACnet objects over IP. Adapter F1.3 is not wired yet: config only.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: ["host", "port", "deviceInstance"],
    exampleConfig: { host: "127.0.0.1", port: 47808, deviceInstance: 1 },
    draftConfigSchema: anyConfig,
  }),
  opc_ua: entry({
    code: "opc_ua",
    label: "OPC UA",
    description: "Browses and subscribes to OPC UA nodes. Adapter F1.4 is not wired yet: config only.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: ["endpointUrl", "nodePrefix"],
    exampleConfig: { endpointUrl: "opc.tcp://127.0.0.1:4840", nodePrefix: "ns=2;s=" },
    draftConfigSchema: anyConfig,
  }),
  snmp: entry({
    code: "snmp",
    label: "SNMP",
    description:
      "Polls SNMP OIDs. Adapter F1.5 is not wired yet: config only. The community string is a credential and goes on the RTU step.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: ["host", "port", "version"],
    exampleConfig: { host: "127.0.0.1", port: 161, version: "2c" },
    draftConfigSchema: anyConfig,
  }),
  rest_poller: entry({
    code: "rest_poller",
    label: "REST poller",
    description: "Polls a JSON HTTP endpoint. Adapter F1.5 is not wired yet: config only.",
    supportsDiscovery: false,
    requiredFields: [],
    optionalFields: ["baseUrl", "pollIntervalMs"],
    exampleConfig: { baseUrl: "https://127.0.0.1/api/readings", pollIntervalMs: 60000 },
    draftConfigSchema: anyConfig,
  }),
};

/** Every protocol, MQTT first, in display order. */
export const PROTOCOL_CATALOG: readonly ProtocolCatalogEntry[] = Object.freeze(Object.values(PROTOCOL_CATALOG_BY_CODE));

/** The entry for one protocol. */
export function protocolCatalogEntry(code: OnboardingProtocol): ProtocolCatalogEntry {
  return PROTOCOL_CATALOG_BY_CODE[code];
}

/** The JSON-safe view the model receives: the entry without its schema object. */
export function describeProtocol(catalogEntry: ProtocolCatalogEntry): ProtocolCatalogView {
  const { draftConfigSchema: _schema, ...view } = catalogEntry;
  void _schema;
  return view;
}
