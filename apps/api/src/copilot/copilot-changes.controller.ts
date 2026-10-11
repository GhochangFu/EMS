import { ConflictException, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";

import type { CopilotRejectResponseDto } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CopilotAccessGuard, CopilotIdentity } from "./copilot-access.guard";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/** One answer for "not yours", "not found" and "not pending", so the route tells a caller nothing about other rows. */
export const CHANGE_NOT_PENDING = "This copilot change is no longer waiting for a decision";

/**
 * `F3.85` PR 8 / ADR 0099 decision 4 — the Reject button of a Confirm card.
 *
 * `pending` → `rejected` in one compare-and-set (`CopilotPendingChangesService.reject`),
 * then a `Rejected: …` action line in the change's conversation, with the
 * change's organization as its provenance (the summary names its target).
 * Nothing else is written: no audit row, no resource. The change is never
 * applied after this — the interceptor's claim needs `pending`.
 *
 * Guarded like the conversations: `JwtAuthGuard` and `CopilotAccessGuard`.
 * Every query runs in `withUser`, so another user's id is the same 409 as a
 * finished change. On the catalog's exclusion list: a proposal never rejects.
 */
@Controller("copilot/changes")
@UseGuards(JwtAuthGuard, CopilotAccessGuard)
export class CopilotChangesController {
  constructor(
    private readonly pendingChanges: CopilotPendingChangesService,
    private readonly conversations: CopilotConversationsService,
  ) {}

  @Post(":id/reject")
  @HttpCode(200)
  async reject(@Param("id") id: string, @CopilotIdentity() identity: ResolvedIdentity): Promise<CopilotRejectResponseDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new ConflictException(CHANGE_NOT_PENDING);
    const rejected = await this.pendingChanges.reject(identity.id, parsed.data);
    if (rejected === null) throw new ConflictException(CHANGE_NOT_PENDING);
    const messages =
      rejected.conversationId === null
        ? []
        : await this.conversations.appendTurn(identity.id, rejected.conversationId, [
            { role: "action", content: `Rejected: ${rejected.summary}`, organizationIds: [rejected.organizationId] },
          ]);
    return { id: parsed.data, status: "rejected", messages };
  }
}
