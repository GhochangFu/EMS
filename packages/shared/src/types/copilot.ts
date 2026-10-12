/**
 * `F3.85` administrator copilot (ADR 0099) — the response types, each
 * `z.infer`red from its schema in `../contracts/copilot` (ADR 0030 decision 2).
 * `tests/adr-0030-contract-derivation.test.ts` scans this directory under the
 * same no-hand-written-type rule.
 */
import type { z } from "zod";

import type * as C from "../contracts/copilot";

export type CopilotAvailabilityReason = z.infer<typeof C.copilotAvailabilityReasonSchema>;
export type CopilotSwitchableRole = z.infer<typeof C.copilotSwitchableRoleSchema>;
export type CopilotStatusDto = z.infer<typeof C.copilotStatusDtoSchema>;
export type CopilotUserOverrideDto = z.infer<typeof C.copilotUserOverrideDtoSchema>;
export type CopilotAccessDto = z.infer<typeof C.copilotAccessDtoSchema>;
export type CopilotChangeRisk = z.infer<typeof C.copilotChangeRiskSchema>;
export type CopilotPendingChangeDto = z.infer<typeof C.copilotPendingChangeDtoSchema>;
export type CopilotMessageRole = z.infer<typeof C.copilotMessageRoleSchema>;
export type CopilotConversationDto = z.infer<typeof C.copilotConversationDtoSchema>;
export type CopilotMessageDto = z.infer<typeof C.copilotMessageDtoSchema>;
export type CopilotConversationDetailDto = z.infer<typeof C.copilotConversationDetailDtoSchema>;
export type CopilotCreateConversationBody = z.infer<typeof C.copilotCreateConversationBodySchema>;
export type CopilotTurnBody = z.infer<typeof C.copilotTurnBodySchema>;
export type CopilotTurnOutcome = z.infer<typeof C.copilotTurnOutcomeSchema>;
export type CopilotTurnResponseDto = z.infer<typeof C.copilotTurnResponseDtoSchema>;
export type CopilotFillStepDto = z.infer<typeof C.copilotFillStepDtoSchema>;
export type CopilotRejectResponseDto = z.infer<typeof C.copilotRejectResponseDtoSchema>;
export type CopilotSkillStateDto = z.infer<typeof C.copilotSkillStateDtoSchema>;
export type CopilotStartOnboardingSkillBody = z.infer<typeof C.copilotStartOnboardingSkillBodySchema>;
