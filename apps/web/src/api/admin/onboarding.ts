import {
  onboardingChatResponseDtoSchema,
  onboardingCommitResponseDtoSchema,
  onboardingDraftListDtoSchema,
  onboardingSessionDtoSchema,
  onboardingValidateResponseDtoSchema,
} from "@bms/shared/contracts";
import type {
  OnboardingChatResponseDto,
  OnboardingCommitResponseDto,
  OnboardingDraftListDto,
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

/**
 * `F4.255` (ADR 0099 Amendment 2 A1): the organization's open drafts, newest
 * update first. Each item names the draft's location, phase and author, never
 * the draft itself. The copilot dock lists them beside "Onboard a site".
 *
 * With no `organizationId` the request carries no query string, and the server
 * answers for the caller's home organization — the one a scoped
 * administrator's copilot conversation is bound to. A global administrator
 * must name one (400).
 */
export async function fetchOnboardingDrafts(organizationId?: string): Promise<OnboardingDraftListDto> {
  const query = organizationId === undefined ? "" : `?organizationId=${encodeURIComponent(organizationId)}`;
  return adminFetch(`/admin/onboarding/sessions${query}`, onboardingDraftListDtoSchema);
}

/** Loads an onboarding session. */
export async function fetchOnboardingSession(
  sessionId: string,
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}`, onboardingSessionDtoSchema);
}

/**
 * F3.25 (ADR 0094 decision 6): rolls the draft back to a checkpoint. Bound to the
 * checkpoint id and the draft hash this client last saw; a stale hash is a 409.
 */
export async function rollbackOnboardingSession(
  sessionId: string,
  checkpointId: string,
  draftHash: string,
): Promise<OnboardingChatResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/rollback`, onboardingChatResponseDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId, draftHash }),
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
  const sent = { headers };
  const res = await fetch(`${base}/api/v1/admin/onboarding/template.xlsx`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
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
  const sent = {
    method: "POST",
    headers,
    body: form,
  };
  const res = await fetch(`${base}/api/v1/admin/onboarding/sessions/${sessionId}/upload`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
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

/**
 * `F3.86` PR 6 — commits only the draft `draftHash` names: the `onboarding.commit`
 * wizard's Submit. The route commits through `commitProposed`, so a draft that
 * changed since the hash was read answers 400 `PROPOSED_DRAFT_CHANGED` and
 * writes nothing. The hash is required: the route answers 400 to an empty body.
 * No `X-Copilot-Change` header — a wizard is not a copilot change.
 */
export async function commitOnboardingDraft(
  sessionId: string,
  draftHash: string,
): Promise<OnboardingCommitResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/commit`, onboardingCommitResponseDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftHash }),
  });
}
