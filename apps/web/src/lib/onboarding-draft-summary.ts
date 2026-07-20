import type { OnboardingDraft, OnboardingFieldError } from "@bms/shared";

/** Formats validation errors for the preview panel. */
export function formatOnboardingValidationErrors(errors: OnboardingFieldError[]): string {
  if (errors.length === 0) {
    return "No validation issues — draft is ready to commit.";
  }
  return errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

/** Human-readable draft layout showing RTU → asset → mapping relationships. */
export function formatOnboardingDraftSummary(draft: OnboardingDraft): string {
  const lines: string[] = [];
  if (draft.location?.name) {
    lines.push(`Location: ${draft.location.name} (${draft.location.code})`);
  }
  if (draft.rtus?.length) {
    lines.push("RTUs:");
    draft.rtus.forEach((rtu, index) => {
      lines.push(
        `  ${index + 1}. ${rtu.displayName} · ${rtu.protocol} · topic ${String(rtu.config.topic ?? "-")}`,
      );
    });
  }
  if (draft.assets?.length) {
    lines.push("Assets:");
    draft.assets.forEach((asset) => {
      const rtuName = draft.rtus?.[asset.rtuIndex]?.displayName ?? `RTU ${asset.rtuIndex}`;
      lines.push(`  - ${asset.name} (${asset.code}) on ${rtuName}`);
    });
  }
  if (draft.pointKeys?.length) {
    lines.push(`Point keys: ${draft.pointKeys.map((pk) => pk.code).join(", ")}`);
  } else if (draft.onboardingMeta?.useExistingPointKeys) {
    lines.push("Point keys: using existing organization catalog");
  }
  if (draft.assetPoints?.length) {
    lines.push(`Mappings: ${draft.assetPoints.length} asset-point row(s)`);
  }
  return lines.length > 0 ? lines.join("\n") : "Draft is empty.";
}
