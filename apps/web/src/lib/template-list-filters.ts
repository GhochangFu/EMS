/**
 * Organization and domain filters for the Templates list (`F2.21` part 2).
 *
 * The owner's report on 2026-09-04 was that the list is "very difficult to find
 * from" with many templates across multiple organizations and categories. The
 * page already searched code, name and asset type and filtered by status;
 * neither of those addresses the two axes the list is actually spread across.
 *
 * **Organization is the axis nothing addressed at all.** A global admin sees
 * every organization's templates in one list, and `organizationCode` was
 * rendered on each group header but was not selectable.
 *
 * ## Why this filters GROUPS, not rows
 *
 * `groupTemplateVersions` filters rows before grouping, and says why: a group
 * whose every version is hidden should disappear rather than render an empty
 * header. That is right for a *status* filter, where the versions of one
 * template genuinely differ.
 *
 * Domain is different. `domain` is per-summary, so a template's v1 can carry
 * `electrical` while its v3 carries `hvac`. Filtering rows on domain would
 * split one template into two headers under two different domains — one
 * template rendered as two, matching nothing on screen and giving two
 * Instantiate buttons for the same code.
 *
 * So both filters run over groups, and domain reads `group.latest.domain`,
 * which is the value the header prints. `latest` is defined by
 * `template-list-grouping.ts` as "the highest **visible** version — the row the
 * group's summary line shows", so filtering on it is the only choice that
 * cannot show a group whose own summary contradicts the active filter.
 *
 * **The consequence, stated because it is surprising**: a template whose v1 was
 * `electrical` and whose v3 is `hvac` appears under `hvac` only. Its
 * `electrical` v1 is still listed, inside that group. The template moved
 * domain; the list follows the move rather than reporting the template twice.
 *
 * Kept pure and in `lib/` for the reason `vocabulary.ts` records — the coverage
 * gate reaches `apps/web/src/lib/**` and nothing above it.
 */
import type { AssetDomainDto } from "@bms/shared";

import type { TemplateVersionGroup } from "./template-list-grouping";
import { labelFor } from "./vocabulary";

/** `""` is "no filter", matching the empty `<option>` both selects render. */
export type TemplateListFilters = {
  organizationId: string;
  domain: string;
};

export const NO_TEMPLATE_LIST_FILTERS: TemplateListFilters = {
  organizationId: "",
  domain: "",
};

/** One selectable value, with the text the `<option>` shows. */
export type TemplateFilterOption = {
  value: string;
  label: string;
};

/**
 * Applies both filters. `""` on either axis means "every value".
 *
 * Order is preserved — `groupTemplateVersions` already sorted by
 * `(organizationCode, code)` and a filter must not reorder what it keeps,
 * or clearing it would appear to shuffle the list.
 */
export function filterTemplateGroups(
  groups: readonly TemplateVersionGroup[],
  filters: TemplateListFilters,
): TemplateVersionGroup[] {
  return groups.filter(
    (group) =>
      (filters.organizationId === "" || group.organizationId === filters.organizationId) &&
      (filters.domain === "" || group.latest.domain === filters.domain),
  );
}

/**
 * The organizations PRESENT in the list, sorted by code.
 *
 * Present, never the full organization list. `groupStockByDomain` states the
 * same rule for its own headings: offering a value that selects nothing is a
 * dead end the reader has to discover by trying it. It also keeps the control
 * honest for a location-scoped admin, whose list holds one organization and
 * whose picker therefore holds one entry rather than the whole fleet.
 *
 * Derived from the UNFILTERED groups by the caller, so choosing one
 * organization does not empty the other picker.
 */
export function templateOrganizationOptions(
  groups: readonly TemplateVersionGroup[],
): TemplateFilterOption[] {
  const byId = new Map<string, string>();
  for (const group of groups) {
    if (!byId.has(group.organizationId)) {
      byId.set(group.organizationId, group.organizationCode);
    }
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/**
 * The domains PRESENT in the list, in the vocabulary's `sortOrder`.
 *
 * Same axis and same fallbacks as `groupStockByDomain`, deliberately: the two
 * controls sit on the same screen, so a domain must not order one way in the
 * stock accordion and another way here. A domain the vocabulary does not carry
 * still gets an option — dropping it would hide its templates behind a filter
 * with no way to select them — labelled with its bare code, and sorted after
 * every known domain.
 *
 * `labelFor` supplies the bare code as its own fallback, so a vocabulary that
 * has not loaded yet yields a usable picker rather than a set of blanks.
 */
export function templateDomainOptions(
  groups: readonly TemplateVersionGroup[],
  domains: readonly AssetDomainDto[] | undefined,
): TemplateFilterOption[] {
  const present = new Set<string>();
  for (const group of groups) {
    if (group.latest.domain) {
      present.add(group.latest.domain);
    }
  }

  const knownSortOrder = new Map<string, number>();
  domains?.forEach((row) => knownSortOrder.set(row.code, row.sortOrder));

  return [...present]
    .map((code) => ({ value: code, label: labelFor(domains, code) }))
    .sort((a, b) => {
      const aOrder = knownSortOrder.get(a.value);
      const bOrder = knownSortOrder.get(b.value);
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) {
        return -1;
      }
      if (bOrder !== undefined) {
        return 1;
      }
      return a.value.localeCompare(b.value);
    });
}

/**
 * The subtitle the Templates card shows.
 *
 * "showing 6 of 42" whenever anything is hidden, and a plain count otherwise.
 * A filtered list that reports only its filtered count reads as a catalog that
 * shrank, which is the failure this exists to prevent — it is the difference
 * between "we have six templates" and "six of yours match".
 *
 * `shown` and `total` are both counts of GROUPS, i.e. of templates, not of
 * versions, matching what the list renders one row per.
 */
export function templateListSubtitle(shown: number, total: number): string {
  const noun = total === 1 ? "template" : "templates";
  if (shown === total) {
    return `${total} ${noun}`;
  }
  return `showing ${shown} of ${total} ${noun}`;
}
