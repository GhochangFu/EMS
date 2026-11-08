import { mqttPayloadFormatCodeSchema } from "../../ingest-adapters/mqtt-payload-format";
import {
  createMqttPayloadFormatBodySchema,
  updateMqttPayloadFormatBodySchema,
} from "../../contracts/mqtt-payload-formats";
import { emptyBody, fieldList, quoted, text } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F4.334` / ADR 0099 Amendment 17 decision 1 — the MQTT payload format
 * catalog (`/admin/mqtt-payload-formats`, ADR 0116). `bms.mqtt_payload_formats`
 * has no organization, so the create is a `fleet` target and the edit and the
 * delete a `vocabulary` row named by its `code`, on the location-type
 * precedent: offered to the global admin alone, a conversation bound to no
 * organization refused at propose. The route stays the guard at Confirm: the
 * built-in row 409, a format in use 409 on delete, the definition schema 400.
 *
 * The edit takes the row's `updatedAt` as its precondition (the table has the
 * column). The edit and delete summaries say how many RTUs of the bound
 * organization use the format, because an edit changes ingest for all of them
 * at the next reload (ADR 0116 decision 6).
 */
const FORMAT: CatalogTarget = { kind: "vocabulary", of: "mqttPayloadFormat", param: "code" };

function inUse(organizationName: string, usageCount: number | undefined): string {
  const count = usageCount ?? "an unknown number of";
  return organizationName === ""
    ? `${count} RTU(s)`
    : `${count} RTU(s) in ${organizationName} (other organizations' RTUs are not counted)`;
}

export const MQTT_PAYLOAD_FORMAT_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "mqttPayloadFormat.create",
    title: "Add an MQTT payload format",
    method: "POST",
    path: "/admin/mqtt-payload-formats",
    params: {},
    body: createMqttPayloadFormatBodySchema,
    bodyName: "createMqttPayloadFormatBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "create",
    target: { kind: "fleet" },
    refs: [],
    formulas: [],
    steps: [
      { id: "format", title: "Format", fields: ["code", "name", "description"] },
      { id: "definition", title: "Definition", fields: ["definition"] },
    ],
    summary: ({ body }) =>
      `Add the payload format ${quoted(text(body, "code"))} (${text(body, "name")}) to the platform-wide ` +
      "MQTT payload format catalog. No RTU uses it until one names it.",
  },
  {
    id: "mqttPayloadFormat.update",
    title: "Edit an MQTT payload format",
    method: "PUT",
    path: "/admin/mqtt-payload-formats/:code",
    params: { code: mqttPayloadFormatCodeSchema },
    body: updateMqttPayloadFormatBodySchema,
    bodyName: "updateMqttPayloadFormatBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "edit",
    precondition: "updatedAt",
    target: FORMAT,
    refs: [],
    formulas: [],
    steps: [
      { id: "format", title: "Format", fields: ["name", "description"] },
      { id: "definition", title: "Definition", fields: ["definition"] },
    ],
    summary: ({ body, params, targetName, organizationName, usageCount }) =>
      `Change ${fieldList(body)} of the platform-wide payload format ${quoted(targetName)} (${params.code ?? ""}), ` +
      `used by ${inUse(organizationName, usageCount)}. A definition change reaches ingest for every RTU on it at the next reload.`,
  },
  {
    id: "mqttPayloadFormat.delete",
    title: "Delete an MQTT payload format",
    method: "DELETE",
    path: "/admin/mqtt-payload-formats/:code",
    params: { code: mqttPayloadFormatCodeSchema },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "deactivate",
    red: true,
    target: FORMAT,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ params, targetName, organizationName, usageCount }) =>
      `Delete the platform-wide payload format ${quoted(targetName)} (${params.code ?? ""}), used by ` +
      `${inUse(organizationName, usageCount)}. A format any RTU or open draft names is refused. This cannot be undone.`,
  },
];

/** `F4.334`: the test route decodes and stores nothing — the read tool `decode_payload_sample` is its twin. */
export const MQTT_PAYLOAD_FORMAT_PENDING: readonly ExcludedRoute[] = [
  {
    method: "POST",
    path: "/admin/mqtt-payload-formats/test",
    reason: "a decode that stores nothing; the read tool decode_payload_sample is its twin",
  },
];
