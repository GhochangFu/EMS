import {
  copilotConversationDetailDtoSchema,
  copilotConversationDtoSchema,
  copilotStatusDtoSchema,
  copilotTurnResponseDtoSchema,
} from "@bms/shared/contracts";
import type {
  CopilotConversationDetailDto,
  CopilotConversationDto,
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

/** `GET /api/v1/copilot/conversations/:id` — the conversation and its messages, oldest first. */
export async function fetchCopilotConversation(conversationId: string): Promise<CopilotConversationDetailDto> {
  return adminFetch(
    `/copilot/conversations/${encodeURIComponent(conversationId)}`,
    copilotConversationDetailDtoSchema,
  );
}

/**
 * `POST /api/v1/copilot/conversations/:id/turns` (`F3.85` PR 7, ADR 0099
 * decisions 1, 9, 10). The body is the message only: the organization a turn
 * reads and is counted against is the conversation's own, read on the server.
 */
export async function sendCopilotTurn(conversationId: string, message: string): Promise<CopilotTurnResponseDto> {
  return adminFetch(
    `/copilot/conversations/${encodeURIComponent(conversationId)}/turns`,
    copilotTurnResponseDtoSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
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
