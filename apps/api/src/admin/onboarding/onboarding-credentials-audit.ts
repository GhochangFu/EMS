import type { JwtPayload } from "@bms/shared";

import type { AuditInput } from "../master-data-audit.service";
import { ownBlobAt, rtuSecretKey } from "./onboarding-redaction";

/** `F4.333` (ADR 0129 decision 1, ruling Q5): the draft credential write's audit action. */
export const CREDENTIALS_SET_ACTION = "master.onboarding.credentials.set";

/**
 * `F4.333` (security review M2): the 409 when the RTU at the posted index no
 * longer has the code the form was opened for — a reorder or removal since.
 */
export const CREDENTIALS_RTU_MOVED =
  "The draft changed: that RTU is no longer at this position. Nothing was stored. Reopen the form and try again.";

/**
 * The audit entry for one `POST sessions/:id/credentials`. Built from the
 * drafts before and after the merge, never from the request body, so no value
 * and no key name can reach the row (AGENTS.md §9.6, ADR 0021 decision 6).
 * `replaced` says whether the RTU's code held a blob before this write;
 * `keyVersion` is the version the new blob was written at.
 */
export function credentialsSetAudit(input: {
  actor: JwtPayload;
  sessionId: string;
  organizationId: string;
  rtuIndex: number;
  before: unknown;
  after: unknown;
}): AuditInput {
  return {
    actor: input.actor,
    action: CREDENTIALS_SET_ACTION,
    entityType: "onboarding_session",
    entityId: input.sessionId,
    organizationId: input.organizationId,
    payload: {
      sessionId: input.sessionId,
      rtuCode: rtuSecretKey(input.after, input.rtuIndex),
      replaced: ownBlobAt(input.before, input.rtuIndex) !== null,
      keyVersion: ownBlobAt(input.after, input.rtuIndex)?.v ?? null,
    },
  };
}
