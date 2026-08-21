/**
 * Collapsing template *versions* into one row per template (`F2.5`, ADR 0038
 * decision 1 — Unit 6).
 *
 * ADR 0015 makes a row a version, not a template: `CHILLER v1`, `v2` and `v3`
 * are three rows. `GET /admin/asset-templates` returns all of them, so a list
 * that rendered the response directly would show the same template three times
 * and give an author no way to see which version is current.
 *
 * Kept pure and in `lib/` for the reason `vocabulary.ts` records — the coverage
 * gate reaches `apps/web/src/lib/**` and nothing above it.
 */
import type { AdminAssetTemplateSummaryDto, AssetTemplateStatus } from "@bms/shared";

/** `"all"` is the list page's default: no status filter. */
export type TemplateStatusFilter = AssetTemplateStatus | "all";

export type TemplateVersionGroup = {
  organizationId: string;
  organizationCode: string;
  /** The template code shared by every version in this group. */
  code: string;
  /** Every **visible** version, newest first. Never empty. */
  versions: AdminAssetTemplateSummaryDto[];
  /**
   * The highest visible version — the row the group's summary line shows.
   *
   * "Visible", not "newest overall": under a `draft` filter this is the newest
   * draft, which is what the author filtered for. A group therefore never
   * summarises itself with a row the filter just hid.
   */
  latest: AdminAssetTemplateSummaryDto;
};

/**
 * Groups by `(organizationId, code)`, **not by `code`**.
 *
 * A global admin sees every organization at once, and two organizations may
 * each own a `CHILLER`. Grouping on `code` alone would merge them into one
 * fictional template whose versions interleave — and the resulting Instantiate
 * would cross an org boundary, which the API refuses ("Template belongs to a
 * different organization than the target").
 *
 * The filter runs **before** grouping, so a group whose every version is hidden
 * disappears rather than rendering as an empty header. An empty header reads as
 * "this template has no versions", which is a different and alarming statement.
 *
 * Versions sort by `version` descending — the column ADR 0015 makes
 * monotonic per `(organizationId, code)`. Not by `createdAt`: the two agree in
 * any fixture worth writing, so a `createdAt` sort would pass its test and
 * still be wrong the first time a clock skews or two versions land in the same
 * millisecond.
 *
 * Groups sort by `(organizationCode, code)` so the rendered order does not
 * depend on the API's row order.
 */
export function groupTemplateVersions(
  summaries: readonly AdminAssetTemplateSummaryDto[],
  filter: TemplateStatusFilter = "all",
): TemplateVersionGroup[] {
  const visible = summaries.filter((row) => filter === "all" || row.status === filter);

  const byKey = new Map<string, AdminAssetTemplateSummaryDto[]>();
  for (const row of visible) {
    // `\u0000` cannot appear in an identifier, so the composite key is
    // unambiguous. A plain `-` would let an org id ending in a dash collide
    // with a code beginning with one.
    const key = `${row.organizationId}\u0000${row.code}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      byKey.set(key, [row]);
    }
  }

  const groups: TemplateVersionGroup[] = [];
  for (const versions of byKey.values()) {
    const ordered = [...versions].sort((a, b) => b.version - a.version);
    groups.push({
      organizationId: ordered[0].organizationId,
      organizationCode: ordered[0].organizationCode,
      code: ordered[0].code,
      versions: ordered,
      latest: ordered[0],
    });
  }

  return groups.sort(
    (a, b) => a.organizationCode.localeCompare(b.organizationCode) || a.code.localeCompare(b.code),
  );
}
