/**
 * `F4.312` (ADR 0109 Amendment 1) — the template-adoption body and response
 * types, each `z.infer`red from its schema in `../contracts/template-adoption`
 * (ADR 0030 decision 2). Re-exported by `index.ts` (§4.5: that file is at the
 * cap).
 */
import type { z } from "zod";

import type * as TA from "../contracts/template-adoption";

export type AdoptAssetsBody = z.infer<typeof TA.adoptAssetsBodySchema>;
export type TemplateAdoptionRefusalReason = z.infer<typeof TA.templateAdoptionRefusalReasonSchema>;
export type TemplateAdoptionRefusalDto = z.infer<typeof TA.templateAdoptionRefusalDtoSchema>;
export type TemplateAdoptionAddedPointDto = z.infer<typeof TA.templateAdoptionAddedPointDtoSchema>;
export type TemplateAdoptionAssetPlanDto = z.infer<typeof TA.templateAdoptionAssetPlanDtoSchema>;
export type TemplateAdoptionPreviewResponse = z.infer<
  typeof TA.templateAdoptionPreviewResponseSchema
>;
export type TemplateAdoptionResultResponse = z.infer<
  typeof TA.templateAdoptionResultResponseSchema
>;
