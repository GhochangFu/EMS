import type {
  AdminAssetDto,
  AssetTemplatesListResponse,
  TemplateAdoptionAssetPlanDto,
  TemplateAdoptionPreviewResponse,
  TemplateAdoptionRefusalDto,
} from "@bms/shared";
import { TEMPLATE_ADOPTION_MAX_ASSETS, templateAdoptionRefusalDtoSchema } from "@bms/shared/contracts";

import { ApiError } from "./api-error";

/**
 * `F4.312` PR 3 (ADR 0109 Amendment 1, A1 and decisions 2, 3 and 5) — the
 * rules behind **Adopt a template**: which versions the picker offers, whether
 * the bulk action may open, how one asset's plan reads, the refusal sentences,
 * and the adopt 409's body. In `lib/` because the coverage gate reaches
 * `src/lib/**` (the reason `template-version-migration.ts` gives).
 *
 * As migrate: **`canApply` is the server's verdict and is never recomputed**
 * from `refusals` — the list is capped at 50, and the apply re-plans anyway.
 */

type VersionRow = AssetTemplatesListResponse["items"][number];
type AdoptingAsset = Pick<AdminAssetDto, "code" | "organizationCode" | "domain" | "templateId">;

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * A1: a **published** version of the assets' **own organization** and the
 * **same domain**. A batch must share both, or nothing is offered and
 * `reason` says why; `reason` is also set when nothing matches.
 */
export function adoptionVersionChoices<V extends VersionRow>(
  assets: readonly AdoptingAsset[],
  versions: readonly V[],
): { versions: V[]; reason: string | null } {
  if (assets.length === 0) return { versions: [], reason: "Select the assets to adopt a template." };
  const organizations = distinct(assets.map((asset) => asset.organizationCode ?? "no organization"));
  if (organizations.length > 1) {
    return {
      versions: [],
      reason:
        `The selected assets belong to ${organizations.length} organizations (${organizations.join(", ")}); ` +
        "a batch adopts one organization's version.",
    };
  }
  const domains = distinct(assets.map((asset) => asset.domain));
  if (domains.length > 1) {
    return {
      versions: [],
      reason:
        `The selected assets span ${domains.length} domains (${domains.join(", ")}); ` +
        "a batch adopts one domain's version.",
    };
  }
  const organization = assets[0]!.organizationCode;
  const domain = assets[0]!.domain;
  const offered = versions.filter(
    (row) => row.status === "published" && row.organizationCode === organization && row.domain === domain,
  );
  return {
    versions: offered,
    reason:
      offered.length > 0
        ? null
        : `${organization ?? "This organization"} has no published template version for the ${domain} domain.`,
  };
}

/** The asset list's **Adopt a template for N selected**: every selected asset template-less, within the cap. */
export function adoptionBulkState(assets: readonly AdoptingAsset[]): { enabled: boolean; reason: string | null } {
  if (assets.length === 0) return { enabled: false, reason: "Select the assets to adopt a template." };
  if (assets.length > TEMPLATE_ADOPTION_MAX_ASSETS) {
    return {
      enabled: false,
      reason:
        `A template can be adopted by at most ${TEMPLATE_ADOPTION_MAX_ASSETS} assets at once; ` +
        `${assets.length} are selected.`,
    };
  }
  const pinned = assets.filter((asset) => asset.templateId !== null).map((asset) => asset.code);
  if (pinned.length > 0) {
    return {
      enabled: false,
      reason: `${pinned.join(", ")} already ${pinned.length === 1 ? "has" : "have"} a template; only template-less assets can adopt one.`,
    };
  }
  return { enabled: true, reason: null };
}

export type AdoptionGroup = {
  kind: "kept" | "added" | "converted" | "skipped";
  label: string;
  keys: string[];
};

/** One asset's plan as the Assets step lists it: non-empty groups in a fixed order, and the inherited-defaults notices. */
export function adoptionPlanSections(plan: TemplateAdoptionAssetPlanDto): {
  groups: AdoptionGroup[];
  notices: string[];
} {
  const groups: AdoptionGroup[] = [
    { kind: "kept", label: "Kept", keys: plan.kept },
    { kind: "added", label: "Added (unmapped)", keys: plan.added.map((point) => point.pointKey) },
    { kind: "converted", label: "Converted (standalone calc → template override)", keys: plan.converted },
    { kind: "skipped", label: "Skipped", keys: plan.skipped },
  ];
  return {
    groups: groups.filter((group) => group.keys.length > 0),
    notices: plan.inheritsDefaults.map(
      (entry) => `${entry.pointKey} reads ${entry.fields.join(", ")} from the template version until the asset sets them.`,
    ),
  };
}

/** Decision 2: every refusal names the asset code and, where there is one, the point key — then the server's sentence verbatim. */
export function adoptionRefusalSentence(refusal: TemplateAdoptionRefusalDto): string {
  const where = refusal.pointKey === null ? refusal.assetCode : `${refusal.assetCode} · ${refusal.pointKey}`;
  return `${where}: ${refusal.message}`;
}

/** Whether Confirm is clickable: a preview, and the server's `canApply`. */
export function adoptActionState(
  preview: TemplateAdoptionPreviewResponse | null,
): { enabled: boolean; message: string | null } {
  if (preview === null) return { enabled: false, message: "Preview the adoption before confirming it." };
  if (!preview.canApply) {
    return {
      enabled: false,
      message:
        preview.refusalCount === 1
          ? "This adoption is refused. See the reason below."
          : `This adoption is refused for ${preview.refusalCount} reasons. See below.`,
    };
  }
  return { enabled: true, message: null };
}

export type AdoptionRefusedBody = {
  message: string;
  refusals: TemplateAdoptionRefusalDto[];
  refusalCount: number;
};

/**
 * The adopt 409 `{ message, refusals, refusalCount }` (migrate's shape) from a
 * thrown `ApiError`, whose message is the response text; `null` for any other
 * error, including the plain-message 409s (stale plan, unpublished version).
 */
export function adoptionRefusedBody(cause: unknown): AdoptionRefusedBody | null {
  if (!(cause instanceof ApiError) || cause.status !== 409) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cause.message);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const body = parsed as Record<string, unknown>;
  const refusals = templateAdoptionRefusalDtoSchema.array().safeParse(body.refusals);
  if (typeof body.message !== "string" || typeof body.refusalCount !== "number" || !refusals.success) return null;
  return { message: body.message, refusals: refusals.data, refusalCount: body.refusalCount };
}
