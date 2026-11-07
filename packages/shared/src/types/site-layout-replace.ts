import type { z } from "zod";

import type * as S from "../contracts/site-layout";

/** `F4.320` PR 2 (ADR 0087 Amendment 4) — derived from the schemas, never written by hand (ADR 0030). */
export type SiteLayoutReplaceResultDto = z.infer<typeof S.siteLayoutReplaceResultDtoSchema>;

/** Why the bulk Replace skipped a site. */
export type SiteLayoutReplaceSkipReason = z.infer<typeof S.siteLayoutReplaceSkipReasonSchema>;

/** The bulk Replace's answer. */
export type SiteLayoutBulkReplaceResultDto = z.infer<typeof S.siteLayoutBulkReplaceResultDtoSchema>;

/** The edit flag of one copy (decision 9). */
export type SiteLayoutCopyEdits = z.infer<typeof S.siteLayoutCopyEditsSchema>;

/** The template copy a site holds now. */
export type SiteLayoutHeldCopy = z.infer<typeof S.siteLayoutHeldCopySchema>;

/** What Replace would do at one site. */
export type SiteLayoutReplaceOutcome = z.infer<typeof S.siteLayoutReplaceOutcomeSchema>;

/** One site of the Replace preview. */
export type SiteLayoutReplacePreviewSite = z.infer<typeof S.siteLayoutReplacePreviewSiteSchema>;

/** The Replace preview the confirm step reads. */
export type SiteLayoutReplacePreviewDto = z.infer<typeof S.siteLayoutReplacePreviewDtoSchema>;
