import { z } from "zod";

import { colourProfileSchema } from "./colour-profile";
import { designSystemSchema } from "./design-system";

/**
 * `F4.341` (ADR 0118 decisions 8, 10 and 12) — the appearance a user sees: a design system and a
 * colour profile, each resolved **user > home organization > portal**. An empty (NULL) value at a
 * level falls through to the next; the portal level is never empty.
 */
export const appearanceLevelSchema = z
  .enum(["user", "organization", "portal"])
  .describe("The level an effective appearance value came from: the user's own, the home organization's, or the portal default.");

const effectiveDesignSystemSchema = z
  .object({ value: designSystemSchema, from: appearanceLevelSchema })
  .strict()
  .describe("The effective design system and the level it came from.");

const effectiveColourProfileSchema = z
  .object({ value: colourProfileSchema, from: appearanceLevelSchema })
  .strict()
  .describe("The effective colour profile and the level it came from.");

/** `GET /auth/me`'s `appearance`. */
export const effectiveAppearanceSchema = z
  .object({ designSystem: effectiveDesignSystemSchema, colourProfile: effectiveColourProfileSchema })
  .strict()
  .describe("The effective appearance of the signed-in user (ADR 0118 decision 8).");

/** `GET`/`PUT /admin/portal-settings/appearance` — the portal default (one row, never empty). */
export const portalAppearanceDtoSchema = z
  .object({
    designSystem: designSystemSchema,
    colourProfile: colourProfileSchema,
    updatedAt: z.string().nullable().describe("When the portal default last changed; null before the first change."),
    updatedBy: z.string().uuid().nullable().describe("The user who last changed it; null before the first change."),
  })
  .strict()
  .describe("The portal's default design system and colour profile (ADR 0118 decision 9).");

/**
 * `GET /public/appearance` — unauthenticated, for the sign-in page (ADR 0118 decision 12). Exactly
 * two enum strings: nothing about an organization, a user or the deployment.
 */
export const publicAppearanceDtoSchema = z
  .object({ designSystem: designSystemSchema, colourProfile: colourProfileSchema })
  .strict()
  .describe("The portal default appearance, shown on the sign-in page (ADR 0118 Q5).");
