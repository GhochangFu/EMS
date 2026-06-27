import type { OnboardingAutoOpenReason } from "@bms/shared";

export type PreviewAutoOpenInput = {
  autoOpenPreview?: boolean;
  autoOpenReason?: OnboardingAutoOpenReason;
  dismissedReason?: OnboardingAutoOpenReason | null;
};

/** Returns whether the preview drawer should open for this trigger. */
export function shouldAutoOpenPreview(input: PreviewAutoOpenInput): boolean {
  if (!input.autoOpenPreview || !input.autoOpenReason) {
    return false;
  }
  return input.dismissedReason !== input.autoOpenReason;
}
