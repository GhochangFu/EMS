import type { OnboardingDraft, OnboardingFieldError } from "@bms/shared";

/** Formats validation errors for the preview panel. */
export function formatOnboardingValidationErrors(errors: OnboardingFieldError[]): string {
  if (errors.length === 0) {
    return "No validation issues — draft is ready to commit.";
  }
  return errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

/**
 * F4.234: the topic as the API's `rtuTopic` reads it � the first key that is a
 * string, `topic` then `mqttTopic`, else "" � shown as "-" when empty. Web cannot
 * import apps/api, so the rule is repeated here.
 */
function topicOf(config: Record<string, unknown>): string {
  const topic = [config.topic, config.mqttTopic].find((value) => typeof value === "string");
  return typeof topic === "string" && topic !== "" ? topic : "-";
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
        `  ${index + 1}. ${rtu.displayName} · ${rtu.protocol} · topic ${topicOf(rtu.config)}`,
      );
    });
  }
  if (draft.assets?.length) {
    lines.push("Assets:");
    draft.assets.forEach((asset) => {
      const rtuName = draft.rtus?.[asset.rtuIndex]?.displayName ?? `RTU ${asset.rtuIndex}`;
      const from = asset.template
        ? ` · from template ${asset.template.code}${
            asset.template.version === undefined ? "" : ` v${asset.template.version}`
          }`
        : "";
      lines.push(`  - ${asset.name} (${asset.code}) on ${rtuName}${from}`);
    });
  }
  if (draft.templates?.length) {
    // F3.22 (ADR 0091 Consequences, code review): a published template cannot
    // be edited, and the user who reads this preview is the guard on what is
    // published, so every authored point and every stock pattern is listed —
    // not a count. The draft schema caps both lists.
    lines.push("Templates:");
    draft.templates.forEach((entry) => {
      if ("stockCode" in entry) {
        lines.push(`  - ${entry.stockCode} (stock)`);
        Object.entries(entry.patterns ?? {}).forEach(([pointKey, pattern]) => {
          lines.push(`      ${pointKey} · ${pattern}`);
        });
        return;
      }
      lines.push(`  - ${entry.code} (authored, ${entry.points.length} points)`);
      entry.points.forEach((point) => {
        const pattern = point.sourceDataKeyPattern ? point.sourceDataKeyPattern : "no pattern";
        lines.push(`      ${point.pointKey} · ${pattern} · ${point.required === false ? "optional" : "required"}`);
      });
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
