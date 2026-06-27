import type {
  OnboardingChatResponseDto,
  OnboardingCommitResponseDto,
  OnboardingSessionDto,
  OnboardingValidateResponseDto,
} from "@bms/shared";

import { adminFetch } from "./client";

/** Starts a new onboarding session for an organization. */
export async function createOnboardingSession(
  organizationId: string,
): Promise<OnboardingChatResponseDto> {
  return adminFetch("/admin/onboarding/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

/** Loads an onboarding session. */
export async function fetchOnboardingSession(
  sessionId: string,
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}`);
}

/** Sends a chat message to the onboarding bot. */
export async function sendOnboardingChat(
  sessionId: string,
  message: string,
): Promise<OnboardingChatResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

/** Patches draft from inline editor. */
export async function patchOnboardingDraft(
  sessionId: string,
  draft: OnboardingSessionDto["draft"],
): Promise<OnboardingSessionDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/draft`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft }),
  });
}

/** Validates the current draft. */
export async function validateOnboardingSession(
  sessionId: string,
): Promise<OnboardingValidateResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/validate`, {
    method: "POST",
  });
}

/** Commits the onboarding draft to master data. */
export async function commitOnboardingSession(
  sessionId: string,
): Promise<OnboardingCommitResponseDto> {
  return adminFetch(`/admin/onboarding/sessions/${sessionId}/commit`, {
    method: "POST",
  });
}
