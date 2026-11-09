import { colourProfileOrDefault, designSystemOrDefault, publicAppearanceDtoSchema } from "@bms/shared";
import type { PublicAppearanceDto } from "@bms/shared";

import { PORTAL_APPEARANCE_STORAGE_KEY } from "../lib/design";
import { previewDesign, previewProfile } from "../stores/theme-store";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.341` (ADR 0118 decision 12, Q5) — the portal default for the sign-in page, from the
 * unauthenticated `GET /api/v1/public/appearance`. No token is sent.
 */
export async function fetchPublicAppearance(): Promise<PublicAppearanceDto> {
  const res = await fetch(`${base}/api/v1/public/appearance`);
  if (!res.ok) throw new Error(`Public appearance failed (${res.status})`);
  return checkResponse(publicAppearanceDtoSchema, await res.json(), "public/appearance");
}

/**
 * Paints the sign-in page in the portal default and caches it as `bms.portal-appearance`, which the
 * boot script paints on the next load with no session. Only the attributes move: the user caches
 * (`bms.design`, `bms.profile`) and the theme store stay empty until `/auth/me` answers, so the
 * portal value is never mistaken for the user's. A storage that throws keeps the page painted.
 */
export function applyPortalAppearance(appearance: PublicAppearanceDto): void {
  previewDesign(designSystemOrDefault(appearance.designSystem));
  previewProfile(colourProfileOrDefault(appearance.colourProfile));
  try {
    localStorage.setItem(
      PORTAL_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ designSystem: appearance.designSystem, colourProfile: appearance.colourProfile }),
    );
  } catch {
    // The page is painted; the next load starts from the default until this read answers again.
  }
}
