import { z } from "zod";

/**
 * `F4.310` (ADR 0110 decision 1) — the closed list of colour profiles an organization may choose.
 * `nexus` is today's colours and the default. A new name is a contract change and an amendment to
 * ADR 0110 (`F4.341`: ADR 0118 decision 13 added the last three). Migration `0133`'s CHECK and `apps/web/src/index.css`'s profile blocks are held to this
 * list by tests.
 */
export const COLOUR_PROFILES = ["nexus", "ocean", "lagoon", "indigo", "graphite", "high-contrast", "forest", "sand", "navy-pop"] as const;

export const colourProfileSchema = z
  .enum(COLOUR_PROFILES)
  .describe(
    "Colour profile of an organization (ADR 0110, ADR 0118 decision 13): nexus (default), ocean, lagoon, indigo, graphite, high-contrast, forest, sand or navy-pop.",
  );

/** `F4.310` — one of the nine names (`F4.341` added forest, sand and navy-pop). Exported from here: `src/index.ts` sits at the 1000-line cap. */
export type ColourProfile = z.infer<typeof colourProfileSchema>;

/**
 * `F4.310` — a stored value as a profile, or `nexus` when it is not one of the nine. The column's
 * CHECK forbids that case; a read path falls back to the default instead of throwing, so a bad row
 * can never fail `/auth/me` or the organization list (the F4.108 rule: a stored-data parse never
 * reaches the ZodError filter).
 */
export function colourProfileOrDefault(value: unknown): ColourProfile {
  const parsed = colourProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : "nexus";
}

/** `F4.310` (ADR 0110 decision 7) — the body of `PUT /admin/organizations/:id/colour-profile`. */
export const setOrganizationColourProfileBodySchema = z.object({ colourProfile: colourProfileSchema }).strict();
