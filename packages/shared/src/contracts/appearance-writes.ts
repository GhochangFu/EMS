import { z } from "zod";

import { colourProfileSchema } from "./colour-profile";
import { designSystemSchema } from "./design-system";

/**
 * `F4.341` (ADR 0118 decision 10) — the three appearance write bodies. Each is `.strict()` and
 * names both keys. The portal body takes values only (the portal level is never empty); the
 * organization and user bodies take `null` for "inherit from the next level".
 */
export const setPortalAppearanceBodySchema = z
  .object({ designSystem: designSystemSchema, colourProfile: colourProfileSchema })
  .strict()
  .describe("The portal default design system and colour profile; both required, neither nullable.");

export const setOrganizationAppearanceBodySchema = z
  .object({
    designSystem: designSystemSchema.nullable().describe("The organization's design system, or null to use the portal default."),
    colourProfile: colourProfileSchema.nullable().describe("The organization's colour profile, or null to use the portal default."),
  })
  .strict()
  .describe("An organization's appearance; a null value inherits the portal default.");

export const setMyAppearanceBodySchema = z
  .object({
    designSystem: designSystemSchema.nullable().describe("The caller's own design system, or null to use the organization's."),
    colourProfile: colourProfileSchema.nullable().describe("The caller's own colour profile, or null to use the organization's."),
  })
  .strict()
  .describe("The caller's own appearance; a null value inherits the home organization's (else the portal's).");
