import type {
  SiteLayoutCopyEdits,
  SiteLayoutHeldCopy,
  SiteLayoutReplaceOutcome,
  SiteLayoutReplaceSkipReason,
} from "@bms/shared";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 5, 6, 8 and 9) — the sentences the two Replace
 * screens show: the per-site wizard's confirm step and the apply-to-sites dialog's bulk Replace.
 * Pure, so a node spec holds the exact text.
 */

/** Decision 6 — what a Replace discards, shown on every confirm step before Submit. */
export const REPLACE_LOSES =
  "Replace deletes the copy and makes it again from the published version. Every builder edit on the copy " +
  "is lost: its widgets and tabs come back as the version has them. A drawn mimic is detached and comes back " +
  "as the version's preset; the drawn layout is kept, so you can switch the widget back in the builder.";

/** A local calendar date, `YYYY-MM-DD` (the ADR's form: "last on 2026-11-06"). */
function localDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Decision 9 — the edit flag: "Edited 3 times since the copy, last on 2026-11-06 by
 * phe-admin@bms.local", with no "by" when the API sent no actor (a `location_admin`, or an unknown
 * actor), or "No recorded edit since the copy". Advice only: Replace never refuses an edited copy.
 */
export function editFlagText(edits: SiteLayoutCopyEdits | null): string {
  if (edits === null || edits.count === 0) return "No recorded edit since the copy";
  const times = `${edits.count} time${edits.count === 1 ? "" : "s"}`;
  const when = edits.lastEditedAt === null ? "" : `, last on ${localDate(edits.lastEditedAt)}`;
  const by = typeof edits.lastEditedBy === "string" && edits.lastEditedBy !== "" ? ` by ${edits.lastEditedBy}` : "";
  return `Edited ${times} since the copy${when}${by}`;
}

/** The copy a site holds, in one phrase: "pump-station-standard v1". */
export function heldCopyText(held: SiteLayoutHeldCopy | null): string {
  return held === null ? "No template copy" : `${held.templateCode} v${held.version}`;
}

/** Decision 8 — what the bulk Replace will do at one site, before the confirm. A closed record. */
export const REPLACE_OUTCOME_LABELS: Record<SiteLayoutReplaceOutcome, string> = {
  replace: "Will be deleted and made again",
  no_copy: "Skipped — the site holds no site-template copy",
  other_template: "Skipped — the copy was made from another site template",
  same_version: "Skipped — the copy already holds this version",
};

/** Decision 5 — why the bulk Replace left a site as it was. A closed record, so a new reason fails to compile. */
export const REPLACE_SKIP_REASON_LABELS: Record<SiteLayoutReplaceSkipReason, string> = {
  no_copy: "The site holds no site-template copy to replace",
  other_template: "The site's copy was made from another site template; delete it and use Make site layout",
  same_version: "The site's copy already holds this version",
  ambiguous: "A tab matches two or more asset groups — replace this site's layout on its site page to choose",
  no_assets: "The site has no assets to bind",
  slug_taken: "Another site already holds this dashboard slug",
};
