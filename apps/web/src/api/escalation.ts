import {
  escalationDefaultsResponseSchema,
  escalationProfileDeletedResponseSchema,
  escalationProfileResponseSchema,
  escalationProfilesListResponseSchema,
} from "@bms/shared/contracts";
import type { EscalationDefaultsResponse, EscalationProfileDto } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

/**
 * `F3.10` escalation-profile client (ADR 0057 decision 11).
 *
 * Follows `notifications.ts`: response schemas from `@bms/shared/contracts`,
 * `withAuth` on every request, and `checkResponse` for every read.
 * `checkResponse` validates and returns the **original** payload — see
 * `validate.ts` for why it must never return `result.data`.
 */

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type EscalationProfilesResponse = { items: EscalationProfileDto[] };

/** One rung of the ladder, as the API takes it. `stepNo` is the position and
 *  is assigned by the server, so it is deliberately absent here. */
export type EscalationStepPayload = {
  afterMinutes: number;
  channelIds: string[];
};

/** The create shape (`createEscalationProfileBodySchema`). */
export type EscalationProfilePayload = {
  /**
   * Optional in the same sense the channel create body's is — a single-grant
   * `organization_admin` need not name its own organization — but with one
   * difference: `alarm_escalation_profiles.organization_id` is `NOT NULL`, so
   * there is no fleet-wide profile to fall back to and an `admin` who omits it
   * is answered 400 rather than given a global row.
   */
  organizationId?: string;
  code: string;
  name: string;
  steps: EscalationStepPayload[];
};

/**
 * The patch shape.
 *
 * `organizationId` and `code` are excluded from the **type**, not merely
 * omitted at the call site — `updateEscalationProfileBodySchema` carries
 * neither, so Zod would strip either silently, and a field that is accepted,
 * ignored and answered `200` is how a client comes to believe it can move a
 * profile between organizations or rename its code. This is the treatment
 * `updateNotificationChannel` already gives the same pair.
 */
export type EscalationProfilePatch = Omit<
  Partial<EscalationProfilePayload>,
  "organizationId" | "code"
>;

/** The severity map, replace-all: a severity absent from `items` is unmapped. */
export type EscalationDefaultsPayload = {
  organizationId?: string;
  items: Array<{ severity: string; profileId: string }>;
};

/** The server's message, when it sent one — a 409 on a mapped profile says so. */
async function failure(res: Response, label: string): Promise<Error> {
  clearSessionOnAuthFailure(res);
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return new Error(text || `${label} ${res.status}`);
}

/** GET /api/v1/admin/escalation-profiles */
export async function fetchEscalationProfiles(): Promise<EscalationProfilesResponse> {
  const res = await fetch(`${base}/api/v1/admin/escalation-profiles`, withAuth());
  if (!res.ok) throw await failure(res, "escalation-profiles");
  return checkResponse(
    escalationProfilesListResponseSchema,
    await res.json(),
    "admin/escalation-profiles",
  );
}

/** POST /api/v1/admin/escalation-profiles */
export async function createEscalationProfile(
  payload: EscalationProfilePayload,
): Promise<EscalationProfileDto> {
  const res = await fetch(`${base}/api/v1/admin/escalation-profiles`, {
    ...withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  if (!res.ok) throw await failure(res, "escalation-profile-create");
  return checkResponse(
    escalationProfileResponseSchema,
    await res.json(),
    "admin/escalation-profiles",
  );
}

/** PATCH /api/v1/admin/escalation-profiles/:id — `steps` replaces the ladder. */
export async function updateEscalationProfile(input: {
  id: string;
  patch: EscalationProfilePatch;
}): Promise<EscalationProfileDto> {
  const res = await fetch(`${base}/api/v1/admin/escalation-profiles/${input.id}`, {
    ...withAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.patch),
    }),
  });
  if (!res.ok) throw await failure(res, "escalation-profile-update");
  return checkResponse(
    escalationProfileResponseSchema,
    await res.json(),
    "admin/escalation-profiles/:id",
  );
}

/**
 * DELETE /api/v1/admin/escalation-profiles/:id
 *
 * A profile a severity still maps to is refused 409 by the `NO ACTION` parent
 * leg (plan D11). The refusal carries the server's message, which is what the
 * screen renders — unmapping first is the operator's move, and a silent failure
 * would leave them without one.
 */
export async function deleteEscalationProfile(id: string): Promise<{ deleted: true }> {
  const res = await fetch(`${base}/api/v1/admin/escalation-profiles/${id}`, {
    ...withAuth({ method: "DELETE" }),
  });
  if (!res.ok) throw await failure(res, "escalation-profile-delete");
  return checkResponse(
    escalationProfileDeletedResponseSchema,
    await res.json(),
    "admin/escalation-profiles/:id",
  );
}

/**
 * GET /api/v1/admin/escalation-defaults?organizationId=…
 *
 * The organization is always named. `resolveTargetOrg` answers an `admin` who
 * omits it with a 400 — the map is per organization by ADR 0057 decision 7 and
 * there is no fleet-wide one to fall back to.
 */
export async function fetchEscalationDefaults(
  organizationId: string,
): Promise<EscalationDefaultsResponse> {
  const params = new URLSearchParams({ organizationId });
  const res = await fetch(`${base}/api/v1/admin/escalation-defaults?${params}`, withAuth());
  if (!res.ok) throw await failure(res, "escalation-defaults");
  return checkResponse(
    escalationDefaultsResponseSchema,
    await res.json(),
    "admin/escalation-defaults",
  );
}

/** PUT /api/v1/admin/escalation-defaults — the whole map, not a delta. */
export async function setEscalationDefaults(
  payload: EscalationDefaultsPayload,
): Promise<EscalationDefaultsResponse> {
  const res = await fetch(`${base}/api/v1/admin/escalation-defaults`, {
    ...withAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });
  if (!res.ok) throw await failure(res, "escalation-defaults-set");
  return checkResponse(
    escalationDefaultsResponseSchema,
    await res.json(),
    "admin/escalation-defaults",
  );
}
