/**
 * `F4.255` onboarding draft list (ADR 0099 Amendment 2 A1) — the response
 * types, each `z.infer`red from its schema in `../contracts/onboarding` (ADR
 * 0030 decision 2). `tests/adr-0030-contract-derivation.test.ts` scans this
 * directory under the same no-hand-written-type rule.
 */
import type { z } from "zod";

import type * as C from "../contracts/onboarding";

export type OnboardingDraftSummaryDto = z.infer<typeof C.onboardingDraftSummaryDtoSchema>;
export type OnboardingDraftListDto = z.infer<typeof C.onboardingDraftListDtoSchema>;
