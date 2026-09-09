import {
  onboardingChatResponseDtoSchema,
  onboardingCommitResponseDtoSchema,
  onboardingSessionDtoSchema,
  onboardingValidateResponseDtoSchema,
} from "@bms/shared/contracts";
import type {
  OnboardingChatResponseDto,
  OnboardingCommitResponseDto,
  OnboardingSessionDto,
  OnboardingValidateResponseDto,
} from "@bms/shared";

import { adminFetch, getAdminAuthHeaders } from "./client";
import { clearSessionOnAuthFailure } from "../http";
import { readJson } from "../validate";
import { apiErrorMessage } from "../../lib/api-error-message";
import { describeOnboardingUploadError } from "../../lib/onboarding-upload-error";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** Starts a new onboarding session for an organization. */
export async function createOnboardingSession(
  organizationId: string,
): Promise<OnboardingChatResponseDto> {
  return adminFetch("/admin/onboarding/sessions", onboardingChatResponseDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

/** Loads an onboarding session. */
export async function fetchOnboardingSession(
  sessionId: string,
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}`, onboardingSessionDtoSchema);
}

/** Sends a chat message to the onboarding bot. */
export async function sendOnboardingChat(
  sessionId: string,
  message: string,
): Promise<OnboardingChatResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/chat`, onboardingChatResponseDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

/**
 * Stores RTU credentials for a draft session (ADR 0022).
 *
 * The only path credentials may take. They are never typed into the chat: the
 * server refuses a turn that looks like it carries one, because the transcript
 * is persisted and previously reached the LLM.
 */
export async function setOnboardingCredentials(
  sessionId: string,
  rtuIndex: number,
  credentials: Record<string, string>,
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/credentials`, onboardingSessionDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rtuIndex, credentials }),
  });
}

/**
 * Downloads the Excel onboarding template.
 *
 * The refusal path had two gaps `F4.106` closes. It never called
 * `clearSessionOnAuthFailure`, unlike both of its telemetry siblings, so a 401
 * here left a dead token in place; and it discarded the response body, so a
 * refusal with a reason showed a bare status instead. The status line survives
 * as the fallback for a genuinely blank body.
 *
 * **The session clear comes first, before the body is read.** `res.text()` on a
 * broken stream rejects, and an ordering that read the body first would skip
 * the clear on exactly the failures that most need it.
 */
export async function downloadOnboardingTemplate(): Promise<void> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(`${base}/api/v1/admin/onboarding/template.xlsx`, { headers });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(
      text.trim() === "" ? `Template download failed (${res.status})` : apiErrorMessage(text),
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bms-onboarding-template.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Uploads a filled Excel workbook into the session draft.
 *
 * The `!res.ok` block is now the exact shape of its telemetry sibling
 * (`telemetry-import.ts`), which had all three of these since `F1.9`:
 *
 * - `clearSessionOnAuthFailure`, which this path never called, so a 401 left a
 *   dead token in place until the next `adminFetch` happened to notice;
 * - a described refusal instead of `text || …`, which put the raw response body
 *   on the wizard's screen;
 * - `readJson` rather than `checkResponse(…, await res.json(), …)`, which puts
 *   the call inside `readJson`'s loud post-guard assertion instead of outside
 *   it.
 *
 * **The session clear comes first, before the body is read**, for the reason
 * `readJson`'s own docblock gives: an error body is not a response contract,
 * and any ordering that touches the body first can skip the clear.
 *
 * It throws a plain `Error` rather than `ApiError`. Both siblings do, no caller
 * branches on the class, and `lib/query-retry.ts` reads a status on queries
 * while this is a raw promise chain. That leaves one file throwing two error
 * classes, which is recorded as a residual rather than settled here.
 */
export async function uploadOnboardingExcel(
  sessionId: string,
  file: File,
): Promise<OnboardingChatResponseDto> {
  const headers = await getAdminAuthHeaders();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${base}/api/v1/admin/onboarding/sessions/${sessionId}/upload`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(describeOnboardingUploadError(res.status, await res.text()));
  }
  return readJson(res, onboardingChatResponseDtoSchema, "admin onboarding upload");
}

/** Patches draft from inline editor. */
export async function patchOnboardingDraft(
  sessionId: string,
  draft: OnboardingSessionDto["draft"],
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/draft`, onboardingSessionDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
}

/** Validates the current draft. */
export async function validateOnboardingSession(
  sessionId: string,
): Promise<OnboardingValidateResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/validate`, onboardingValidateResponseDtoSchema, {
    method: "POST",
  });
}

/** Commits the onboarding draft to master data. */
export async function commitOnboardingSession(
  sessionId: string,
): Promise<OnboardingCommitResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/commit`, onboardingCommitResponseDtoSchema, {
    method: "POST",
  });
}
