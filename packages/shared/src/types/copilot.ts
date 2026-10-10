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
