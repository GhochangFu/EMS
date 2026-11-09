import type { z } from "zod";

import type * as A from "../contracts/appearance";
import type * as W from "../contracts/appearance-writes";

/** `F4.341` (ADR 0118) — derived from the schemas, never written by hand (ADR 0030). */
export type AppearanceLevel = z.infer<typeof A.appearanceLevelSchema>;
export type EffectiveAppearance = z.infer<typeof A.effectiveAppearanceSchema>;
export type PortalAppearanceDto = z.infer<typeof A.portalAppearanceDtoSchema>;
export type PublicAppearanceDto = z.infer<typeof A.publicAppearanceDtoSchema>;
export type SetPortalAppearanceBody = z.infer<typeof W.setPortalAppearanceBodySchema>;
export type SetOrganizationAppearanceBody = z.infer<typeof W.setOrganizationAppearanceBodySchema>;
export type SetMyAppearanceBody = z.infer<typeof W.setMyAppearanceBodySchema>;
