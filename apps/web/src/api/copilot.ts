import {
  copilotConversationDetailDtoSchema,
  copilotConversationDtoSchema,
  copilotConversationListDtoSchema,
  copilotRejectResponseDtoSchema,
  copilotStatusDtoSchema,
  copilotTurnResponseDtoSchema,
} from "@bms/shared/contracts";
import type {
  CopilotConversationDetailDto,
  CopilotConversationDto,
  CopilotOpenWizard,
  CopilotRejectResponseDto,
  CopilotStatusDto,
  CopilotTurnResponseDto,
} from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { adminFetch } from "./admin/client";

/**
 * `GET /api/v1/copilot/status` (`F3.85`, ADR 0099 decision 5) — whether the
 * administrator copilot is available to the signed-in user here. An operator
 * or a viewer gets a 403, which `adminFetch` raises as an `ApiError`. The dock
 * reads it on mount; omit `organizationId` for the user's own organization, or
 * none for the global admin.
 */
export async function fetchCopilotStatus(organizationId?: string): Promise<CopilotStatusDto> {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  return adminFetch(`/copilot/status${query}`, copilotStatusDtoSchema);
}

/**
 * `POST /api/v1/copilot/conversations` (`F3.85` PR 5). A scoped administrator's
 * conversation is bound to the home organization whatever this says (plan Q9);
 * the global administrator passes `null` for a cross-organization conversation.
 */
export async function createCopilotConversation(
  organizationId: string | null,
): Promise<CopilotConversationDto> {
  return adminFetch("/copilot/conversations", copilotConversationDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

/**
 * `GET /api/v1/copilot/conversations` (`F4.292`, ADR 0099 Amendment 9 E7) — the
 * caller's conversations, newest turn first, at most 100.
 */
export async function fetchCopilotConversations(): Promise<CopilotConversationDto[]> {
  return adminFetch("/copilot/conversations", copilotConversationListDtoSchema);
}

/**
 * `GET /api/v1/copilot/conversations/:id` — the conversation and its messages, oldest first.
 * `F4.292`: with `page` the read is one page — `?limit=<n>[&before=<messageId>]`, the newest
 * `limit` messages older than `before` — and carries `hasEarlier`. Without it the read keeps
 * the old shape (every message, no `hasEarlier`).
 */
export async function fetchCopilotConversation(
  conversationId: string,
  page?: { before?: string; limit: number },
): Promise<CopilotConversationDetailDto> {
  const query =
    page === undefined
      ? ""
      : `?limit=${encodeURIComponent(String(page.limit))}${page.before !== undefined ? `&before=${encodeURIComponent(page.before)}` : ""}`;
  return adminFetch(
    `/copilot/conversations/${encodeURIComponent(conversationId)}${query}`,
    copilotConversationDetailDtoSchema,
  );
}

/**
 * `POST /api/v1/copilot/conversations/:id/turns` (`F3.85` PR 7, ADR 0099
 * decisions 1, 9, 10). The body is the message and, since `F4.245` (ADR 0099
 * Amendment 4), the wizards open on the user's screen (`[]` when none), so a
 * `fill_step` names a record the user has open. The organization a turn reads
 * and is counted against is still the conversation's own, read on the server;
 * the wizards are never an authorization input.
 *
 * **Files** (`F3.87` PR 8, ADR 0099 Amendment 3 A4, A7). With at least one
 * file the turn goes as `FormData` — `message`, `wizards` as a JSON string,
 * then one `files` entry per file — and sets **no `Content-Type`**: the browser writes the multipart
 * boundary, which a hand-set header would lack. With none it stays JSON. The
 * server re-checks every limit (count, type by magic bytes, size) and the
 * organization's switch; the dock's checks only spare a refused upload.
 */
export async function sendCopilotTurn(
  conversationId: string,
  message: string,
  files: readonly File[],
  // `F4.245` (critique F3): required, so a caller that drops the open wizards does not compile.
  wizards: readonly CopilotOpenWizard[],
): Promise<CopilotTurnResponseDto> {
  const path = `/copilot/conversations/${encodeURIComponent(conversationId)}/turns`;
  if (files.length > 0) {
    const form = new FormData();
    form.append("message", message);
    form.append("wizards", JSON.stringify(wizards));
    for (const file of files) form.append("files", file, file.name);
    return adminFetch(path, copilotTurnResponseDtoSchema, { method: "POST", body: form });
  }
  return adminFetch(path, copilotTurnResponseDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, wizards }),
  });
}

/**
 * `POST /api/v1/copilot/conversations/:id/skills/onboarding` (`F3.86` PR 5,
 * ADR 0099 decision 7) — starts the onboarding skill in this conversation. The
 * organization must be the conversation's own; the answer is the conversation
 * with the new session's state in `skill`. A role that may not onboard is 403.
 *
 * With `sessionId` (`F4.255`, ADR 0099 Amendment 2 A1) the route resumes that
 * draft instead of creating one, after the same checks as a start; a draft
 * that is no longer a draft is 409, one the caller may not read is 404. A
 * start sends no `sessionId` key at all.
 */
export async function startCopilotOnboardingSkill(
  conversationId: string,
  organizationId: string,
  sessionId?: string,
): Promise<CopilotConversationDetailDto> {
  const body = sessionId === undefined ? { organizationId } : { organizationId, sessionId };
  return adminFetch(
    `/copilot/conversations/${encodeURIComponent(conversationId)}/skills/onboarding`,
    copilotConversationDetailDtoSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/**
 * `DELETE /api/v1/copilot/conversations/:id/skills/onboarding` (`F3.86` PR 5)
 * — ends the skill here; the draft stays a session the dock lists and can
 * resume (`F4.255`, ADR 0099 Amendment 2 A1). The answer is the conversation
 * with `skill: null`.
 */
export async function endCopilotOnboardingSkill(conversationId: string): Promise<CopilotConversationDetailDto> {
  return adminFetch(
    `/copilot/conversations/${encodeURIComponent(conversationId)}/skills/onboarding`,
    copilotConversationDetailDtoSchema,
    { method: "DELETE" },
  );
}

/**
 * `POST /api/v1/copilot/changes/:id/reject` (`F3.85` PR 8, decision 4) — the
 * Confirm card's Reject. The change is never applied after this; `messages`
 * holds the `Rejected: …` line stored in its conversation. A change that is
 * no longer pending answers 409.
 */
export async function rejectCopilotChange(changeId: string): Promise<CopilotRejectResponseDto> {
  return adminFetch(`/copilot/changes/${encodeURIComponent(changeId)}/reject`, copilotRejectResponseDtoSchema, {
    method: "POST",
  });
}

/** A refused turn's daily limit (ADR 0099 Amendment 1): whose limit, and when it resets. */
export type CopilotLimit = { scope: "user" | "organization"; resetsAt: string };

/**
 * The daily limit a turn was refused on, or `null` when `err` is not that 429.
 *
 * `adminFetch` throws the raw response body as the message, so the body is
 * parsed here, under `api/`, and never at a render site (`tests/f4.204`). A
 * 429 whose body is not the server's JSON envelope — a proxy's HTML page, an
 * empty body, a `resetsAt` that is not a date — answers `null`, and the
 * caller falls back to `apiErrorMessage`.
 */
export function copilotLimitOf(err: unknown): CopilotLimit | null {
  if (!(err instanceof ApiError) || err.status !== 429) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(err.message);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { scope, resetsAt } = body as { scope?: unknown; resetsAt?: unknown };
  if ((scope !== "user" && scope !== "organization") || typeof resetsAt !== "string") {
    return null;
  }
  if (Number.isNaN(new Date(resetsAt).getTime())) {
    return null;
  }
  return { scope, resetsAt };
}
