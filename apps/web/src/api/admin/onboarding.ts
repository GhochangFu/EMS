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
import { checkResponse } from "../validate";

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

/** Downloads the Excel onboarding template. */
export async function downloadOnboardingTemplate(): Promise<void> {
  const headers = await getAdminAuthHeaders();
  const res = await fetch(`${base}/api/v1/admin/onboarding/template.xlsx`, { headers });
  if (!res.ok) {
    throw new Error(`Template download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bms-onboarding-template.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Uploads a filled Excel workbook into the session draft. */
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
    const text = await res.text();
    throw new Error(text || `Upload failed (${res.status})`);
  }
  return checkResponse(onboardingChatResponseDtoSchema, await res.json(), "admin onboarding upload");
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
