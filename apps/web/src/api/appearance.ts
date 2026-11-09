import { adminOrganizationDtoSchema, portalAppearanceDtoSchema, setMyAppearanceBodySchema } from "@bms/shared/contracts";
import type {
  AdminOrganizationDto,
  PortalAppearanceDto,
  SetMyAppearanceBody,
  SetOrganizationAppearanceBody,
  SetPortalAppearanceBody,
} from "@bms/shared";

import { adminFetch } from "./admin/client";

const json = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** `F4.341` (ADR 0118 decision 10) — `GET /admin/portal-settings/appearance` (global admin). */
export function fetchPortalAppearance(): Promise<PortalAppearanceDto> {
  return adminFetch("/admin/portal-settings/appearance", portalAppearanceDtoSchema);
}

/** `PUT /admin/portal-settings/appearance` (global admin): both values, never empty. */
export function setPortalAppearance(body: SetPortalAppearanceBody): Promise<PortalAppearanceDto> {
  return adminFetch("/admin/portal-settings/appearance", portalAppearanceDtoSchema, json(body));
}

/** `PUT /admin/organizations/:id/appearance`: `null` inherits the portal default. */
export function setOrganizationAppearance(id: string, body: SetOrganizationAppearanceBody): Promise<AdminOrganizationDto> {
  return adminFetch(`/admin/organizations/${id}/appearance`, adminOrganizationDtoSchema, json(body));
}

/** `PUT /me/appearance`: the caller's own; `null` inherits the organization's (else the portal's). */
export function setMyAppearance(body: SetMyAppearanceBody): Promise<SetMyAppearanceBody> {
  return adminFetch("/me/appearance", setMyAppearanceBodySchema, json(body));
}
