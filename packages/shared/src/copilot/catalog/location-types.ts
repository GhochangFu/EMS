import { locationTypeCodeSchema } from "../../contracts/location-types";
import { createLocationTypeBodySchema, updateLocationTypeBodySchema } from "../../contracts/location-type-writes";
import { emptyBody, fieldList, quoted, text } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F4.282` (ADR 0099 Amendment 8, Q17) — the location-type vocabulary
 * (`admin/vocabularies/location-types`, `F4.162`). `bms.location_types` has no
 * organization, so a create is a `fleet` target and every other write a
 * `vocabulary` row named by its `code`: the change lives in the conversation's
 * bound organization, and a conversation bound to none is refused at propose
 * time (ruling Q1). Offered to the global admin alone; the resolver's
 * `mayManageFleet` and the service's `requireGlobalAdmin` stay the second and
 * third lines.
 *
 * No `precondition`: the table has no `updated_at` (decision 4.9's residual,
 * bounded by the 15-minute expiry). The summaries call the vocabulary
 * fleet-wide and name the code beside the label.
 */
const LOCATION_TYPE: CatalogTarget = { kind: "vocabulary", of: "locationType", param: "code" };

export const LOCATION_TYPE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "locationType.create",
    title: "Add a location type",
    method: "POST",
    path: "/admin/vocabularies/location-types",
    params: {},
    body: createLocationTypeBodySchema,
    bodyName: "createLocationTypeBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "create",
    target: { kind: "fleet" },
    refs: [],
    formulas: [],
    steps: [{ id: "type", title: "Type", fields: ["code", "label", "sortOrder"] }],
    summary: ({ body }) =>
      `Add the location type ${quoted(text(body, "code"))} (${text(body, "label")}) to the fleet-wide location-type vocabulary.`,
  },
  {
    id: "locationType.update",
    title: "Edit a location type",
    method: "PATCH",
    path: "/admin/vocabularies/location-types/:code",
    params: { code: locationTypeCodeSchema },
    body: updateLocationTypeBodySchema,
    bodyName: "updateLocationTypeBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "edit",
    target: LOCATION_TYPE,
    refs: [],
    formulas: [],
    steps: [{ id: "type", title: "Type", fields: ["label", "sortOrder"] }],
    summary: ({ body, params, targetName }) =>
      `Change ${fieldList(body)} of the fleet-wide location type ${quoted(targetName)} (${params.code ?? ""}).`,
  },
  {
    id: "locationType.deactivate",
    title: "Deactivate a location type",
    method: "POST",
    path: "/admin/vocabularies/location-types/:code/deactivate",
    params: { code: locationTypeCodeSchema },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "deactivate",
    target: LOCATION_TYPE,
    refs: [],
    formulas: [],
    steps: [],
    // The copilot's count is the bound organization's only (decision 10 keeps other tenants'
    // figures from the model), so its card names that organization; the page passes "" and a
    // fleet-wide count.
    summary: ({ params, targetName, organizationName, usageCount }) =>
      `Deactivate the fleet-wide location type ${quoted(targetName)} (${params.code ?? ""}), used by ${
        usageCount ?? "an unknown number of"
      } location(s)${
        organizationName === "" ? "" : ` in ${organizationName} (other organizations' locations are not counted)`
      }: every Type dropdown stops offering it; those locations keep it.`,
  },
  {
    id: "locationType.reactivate",
    title: "Reactivate a location type",
    method: "POST",
    path: "/admin/vocabularies/location-types/:code/reactivate",
    params: { code: locationTypeCodeSchema },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "edit",
    target: LOCATION_TYPE,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ params, targetName }) =>
      `Reactivate the fleet-wide location type ${quoted(targetName)} (${params.code ?? ""}): every Type dropdown offers it again.`,
  },
];

/** `F4.282`: every location-type write route is an entry; nothing waits on a later PR. */
export const LOCATION_TYPE_PENDING: readonly ExcludedRoute[] = [];
