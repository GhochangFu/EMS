import { createHash } from "node:crypto";

import type { OnboardingDraft } from "@bms/shared";
import { z } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { exceedsDepth, isJsonContainer } from "../stack-safe-json";
import { MAX_ONBOARDING_DRAFT_DEPTH } from "./onboarding.schema";
import {
  draftTemplateCode,
  draftTemplateRef,
  resolveTemplateForAsset,
  templateSourceKey,
  type ValidateTemplateContext,
} from "./onboarding-template-refs";

/**
 * The commit proposal (`F3.21`, ADR 0090 decision 5): **the model cannot
 * commit.** `propose_commit` records a proposal; server code commits only when
 * the next user turn is the confirm phrase (or the Commit button), and only when
 * the stored draft still hashes to the value the proposal was bound to.
 *
 * The proposal lives at the top level of `onboarding_sessions.draft`, beside
 * `_secrets`, so it needs no migration. Neither producer of a draft can forge
 * it: `onboardingDraftSchema` declares no such key and strips unknown keys, so a
 * `PATCH :id/draft` body cannot carry one, and no tool argument schema declares
 * it either. `OnboardingService.chat` is its only writer, and
 * `OnboardingChatService.mergeDraft` removes it on every write, so any draft
 * change clears it.
 */

export const CONFIRM_COMMIT_PHRASE = "confirm commit";

export const COMMIT_PROPOSAL_KEY = "_commitProposal";

/** Bounds the stored summary; `commitSummary` stays far below it. */
export const MAX_COMMIT_SUMMARY_CHARS = 4_000;

/**
 * True in both modes (code review): in the guided mode, the default, nothing
 * can propose, so the reply points at the Commit button first.
 */
export const NO_PROPOSAL_REPLY =
  "Nothing has been proposed for commit. Open the preview and use the **Commit** button to commit the draft. " +
  "When the AI assistant is on, it can also propose the commit for you to confirm here.";

export const STALE_PROPOSAL_REPLY =
  "The draft changed after the commit was proposed, so I have not committed it. Ask me to propose the commit again.";

export const commitProposalSchema = z
  .object({
    draftHash: z.string().regex(/^[0-9a-f]{64}$/),
    summary: z.string().max(MAX_COMMIT_SUMMARY_CHARS),
    proposedAt: z.string(),
  })
  .strict();

export type CommitProposal = z.infer<typeof commitProposalSchema>;

/**
 * Exact, after trim and case-folding. No prefix, no markdown stripping, no
 * regex: a near-miss is an ordinary turn and goes to the model, which cannot
 * commit.
 */
export function isConfirmCommitPhrase(message: string): boolean {
  return message.trim().toLowerCase() === CONFIRM_COMMIT_PHRASE;
}

/** A shallow copy of `draft` without the proposal key. */
export function withoutCommitProposal<T>(draft: T): T {
  if (!isJsonContainer(draft) || Array.isArray(draft)) {
    return draft;
  }
  const copy = { ...(draft as Record<string, unknown>) };
  delete copy[COMMIT_PROPOSAL_KEY];
  return copy as T;
}

/** A shallow copy of `draft` carrying `proposal`. The caller's object is untouched. */
export function attachCommitProposal<T extends object>(draft: T, proposal: CommitProposal): T {
  return { ...draft, [COMMIT_PROPOSAL_KEY]: proposal };
}

/** The stored proposal, or `null` for anything that does not parse (fail closed). */
export function readCommitProposal(draft: unknown): CommitProposal | null {
  if (!isJsonContainer(draft) || Array.isArray(draft)) {
    return null;
  }
  const parsed = commitProposalSchema.safeParse((draft as Record<string, unknown>)[COMMIT_PROPOSAL_KEY]);
  return parsed.success ? parsed.data : null;
}

/**
 * SHA-256 of the draft without its proposal, as hex, or `null` when the draft
 * is deeper than a stored draft may be.
 *
 * **Keys are sorted** because jsonb does not keep key order: the merged draft
 * in memory and the same row read back on the next turn serialise differently
 * otherwise, and every proposal would read as stale.
 *
 * `_secrets` is **inside** the hash on purpose: setting a credential after a
 * proposal changes what would be committed, so the proposal goes stale.
 *
 * `JSON.stringify` recurses, so the depth is checked first with the iterative
 * walk; a draft over the bound never hashes and so never matches.
 */
export function draftHash(draft: unknown): string | null {
  const value = withoutCommitProposal(draft);
  if (exceedsDepth(value, MAX_ONBOARDING_DRAFT_DEPTH)) {
    return null;
  }
  const canonical = JSON.stringify(value, (_key, node: unknown) => {
    if (!isJsonContainer(node) || Array.isArray(node)) {
      return node;
    }
    const record = node as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
  return createHash("sha256").update(canonical ?? "null").digest("hex");
}

/** "1 RTU", "2 RTUs": the one plural rule for code-written summaries and action lines. */
export function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * What a commit of `draft` creates, in one line, written by code — never by the
 * model. RTU codes are bounded in count (`echoedItems`) and each name in length
 * (`quoteCell`), the two axes `F4.105` bounds every echoed list on.
 *
 * `F3.22` (ADR 0091 decision 8): a draft with templates or templated assets
 * also names each publish and the counts instantiation will create. `templates`
 * is required, as `validate`'s is: the counts read the organization's versions.
 */
export function commitSummary(draft: OnboardingDraft, templates: ValidateTemplateContext): string {
  const rtus = draft.rtus ?? [];
  const { shown, omitted } = echoedItems(rtus.map((rtu) => quoteCell(rtu.code)));
  const codes = [...shown, moreTail(omitted, "RTUs")].filter(Boolean).join(", ");
  const parts = [
    `location ${quoteCell(draft.location?.name ?? "")}`,
    rtus.length > 0 ? `${countOf(rtus.length, "RTU")} (${codes})` : countOf(0, "RTU"),
    draft.onboardingMeta?.useExistingPointKeys && (draft.pointKeys?.length ?? 0) === 0
      ? "the existing point-key catalog"
      : countOf(draft.pointKeys?.length ?? 0, "point key"),
    countOf(draft.assets?.length ?? 0, "asset"),
    countOf(draft.assetPoints?.length ?? 0, "mapping"),
  ];
  if ((draft.templates?.length ?? 0) > 0 || (draft.assets ?? []).some((asset) => asset.template)) {
    parts.push(...templateSummaryParts(draft, templates));
  }
  return parts.join(", ");
}

/** The most draft templates the summary names; the rest are counted. */
const SUMMARY_TEMPLATE_LINES = 10;

/**
 * Decision 8. Each draft template is published as version 1 — validation
 * refuses a code the organization holds in any version (decision 6) — and a
 * published version cannot be edited, so the line says so. The counts mirror
 * the instantiate core: an asset point per measured point whose pattern
 * resolves to a non-empty key (`resolveSourceDataKey`), a seeded rule per
 * alarm per asset, and a dashboard per view per asset (the ref's
 * `dashboardCount`). That last one is the unit the confirm line prints from the
 * core's `dashboardCount`, so the operator confirms the number they will see;
 * widget rows (`dashboardWidgetCount`) are the bound's unit, not this line's.
 */
function templateSummaryParts(draft: OnboardingDraft, ctx: ValidateTemplateContext): string[] {
  const entries = draft.templates ?? [];
  const lines = entries.map((entry) => {
    const points = draftTemplateRef(entry, ctx)?.points.length ?? 0;
    return `will publish ${quoteCell(draftTemplateCode(entry))} v1 (cannot be edited afterwards), ${countOf(points, "point")}`;
  });
  const { shown, omitted } = echoedItems(lines, SUMMARY_TEMPLATE_LINES);
  const parts =
    entries.length > 0
      ? [`${countOf(entries.length, "template")}: ${[...shown, moreTail(omitted, "templates")].filter(Boolean).join("; ")}`]
      : [];

  let templated = 0;
  let assetPoints = 0;
  let rules = 0;
  let dashboards = 0;
  for (const asset of draft.assets ?? []) {
    if (!asset.template) {
      continue;
    }
    templated += 1;
    const resolved = resolveTemplateForAsset(draft, asset.template, ctx);
    if ("problem" in resolved) {
      continue;
    }
    const vars = asset.template.sourceDataKeyVars ?? {};
    assetPoints += resolved.ref.points.filter(
      (point) =>
        point.kind === "measured" &&
        point.sourceDataKeyPattern !== null &&
        templateSourceKey(point.sourceDataKeyPattern, vars, asset.code).outcome === "key",
    ).length;
    rules += resolved.ref.alarmCount;
    dashboards += resolved.ref.dashboardCount;
  }
  return [
    ...parts,
    countOf(templated, "templated asset"),
    countOf(assetPoints, "asset point"),
    countOf(rules, "seeded rule"),
    countOf(dashboards, "dashboard"),
  ];
}
