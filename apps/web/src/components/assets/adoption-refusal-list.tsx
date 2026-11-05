import type { TemplateAdoptionRefusalDto } from "@bms/shared";

import { adoptionRefusalSentence } from "../../lib/template-adoption";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1 decision 2) — adoption refusals, one
 * sentence each, naming the asset code and the point key
 * (`adoptionRefusalSentence`). Renders nothing for an empty list. `label` names
 * the list: the preview's on the Assets step, the 409's beside the card.
 */
export function AdoptionRefusalList({
  refusals,
  label,
}: {
  refusals: readonly TemplateAdoptionRefusalDto[];
  label: string;
}) {
  if (refusals.length === 0) return null;
  return (
    <ul aria-label={label} className="list-disc space-y-1 pl-4 text-xs text-critical-ink">
      {refusals.map((refusal, index) => (
        <li key={`${refusal.assetId}-${refusal.pointKey ?? ""}-${index}`}>{adoptionRefusalSentence(refusal)}</li>
      ))}
    </ul>
  );
}
