import { eq } from "drizzle-orm";

import { organizations, portalSettings, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { DESIGN_SYSTEMS, COLOUR_PROFILES } from "@bms/shared";
import type { AppearanceLevel, ColourProfile, DesignSystem, EffectiveAppearance } from "@bms/shared";


/**
 * `F4.341` (ADR 0118 decision 8) — the stored appearance values at each level, as read. `null` for
 * a level means there is no row (no home organization); a `null` value means "inherit".
 */
export type StoredAppearance = { designSystem: string | null; colourProfile: string | null };
export type AppearanceLevels = {
  user: StoredAppearance | null;
  organization: StoredAppearance | null;
  portal: { designSystem: string; colourProfile: string };
};

function pick<T extends string>(
  list: readonly T[],
  fallback: T,
  values: Array<[AppearanceLevel, string | null | undefined]>,
): { value: T; from: AppearanceLevel } {
  for (const [from, value] of values) {
    if (value != null && (list as readonly string[]).includes(value)) return { value: value as T, from };
  }
  return { value: fallback, from: "portal" };
}

/**
 * The effective design system and colour profile: each resolves on its own as the user's value,
 * else the home organization's, else the portal's. A stored value outside its closed list (a CHECK
 * forbids it) counts as empty, and a bad portal value falls to today's look, so `/auth/me` never
 * fails on stored data (the F4.108 rule).
 */
export function resolveAppearance(levels: AppearanceLevels): EffectiveAppearance {
  const chain = (key: keyof StoredAppearance): Array<[AppearanceLevel, string | null | undefined]> => [
    ["user", levels.user?.[key]],
    ["organization", levels.organization?.[key]],
    ["portal", levels.portal[key]],
  ];
  return {
    designSystem: pick<DesignSystem>(DESIGN_SYSTEMS, "nexus-soft", chain("designSystem")),
    colourProfile: pick<ColourProfile>(COLOUR_PROFILES, "nexus", chain("colourProfile")),
  };
}

/**
 * The three stored levels, read, then resolved. The user's own two columns are read on `authDb`
 * (`bms_auth` holds a column grant on them, migration 0134), and only for a provisioned row:
 * `userId` is `null` for a subject `resolveIdentity` found no row for (an OIDC `sub` is a UUID too,
 * so the id's shape proves nothing). The organization and portal rows are read on
 * `fleetDb`: `bms_auth` holds no grant on either, and the organization id comes from the user's own
 * row, the pre-tenant scope-resolution shape (ADR 0043 Amendment 2/3). A missing row is empty.
 */
export async function readEffectiveAppearance(
  authDb: BmsDb,
  fleetDb: BmsDb,
  userId: string | null,
  organizationId: string | null,
): Promise<EffectiveAppearance> {
  const [own] = userId !== null
    ? await authDb
        .select({ designSystem: users.designSystem, colourProfile: users.colourProfile })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    : [];
  const [organization] =
    organizationId === null
      ? []
      : await fleetDb
          .select({ designSystem: organizations.designSystem, colourProfile: organizations.colourProfile })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
  const [portal] = await fleetDb
    .select({ designSystem: portalSettings.designSystem, colourProfile: portalSettings.colourProfile })
    .from(portalSettings)
    .where(eq(portalSettings.id, 1))
    .limit(1);
  return resolveAppearance({
    user: own ?? null,
    organization: organization ?? null,
    portal: portal ?? { designSystem: "nexus-soft", colourProfile: "nexus" },
  });
}
