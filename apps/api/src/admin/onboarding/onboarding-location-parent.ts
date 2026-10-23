/**
 * `F4.243` (ADR 0098 Amendment 2) — where a new onboarding location goes in
 * the tree: the parent is named by its **code** in `location.parentCode`
 * (B2), asked for rather than defaulted while the organization has an active
 * location (B5), checked against the organization's locations before the
 * commit (B4) and asked in the guided chat as one step (B6).
 *
 * The field has three states and each one means something: absent is "not
 * chosen yet", `null` is "a root, by choice", and a code is the parent. The
 * code becomes an id only inside the commit transaction (B3); everything here
 * reads the `PlacementContext` the caller loaded once per request, so it runs
 * without a database.
 */
import type { OnboardingDraft } from "@bms/shared";

import { depthExceeded, refusalSentence } from "../locations/locations-tree-guards";
import { echoedItems, moreTail } from "../spreadsheet-guard";

/** One location of the organization, as validate and the guided step read it. `depth` is 1 for a root. */
export type ParentCandidate = {
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly depth: number;
};

/** The organization's locations, read once per request (`OnboardingInventoryService.listParentCandidates`). */
export type PlacementContext = { readonly candidates: readonly ParentCandidate[] };

/** An organization with no location: nothing to ask, and an absent parent is a root. */
export const EMPTY_PLACEMENT: PlacementContext = { candidates: [] };

/** The guided step's chip, and the reply that stores `null` (a top-level location). */
export const NO_PARENT_REPLY = "No parent";

/** B5 — the `location.parentCode` error while the choice is still open. */
export const PARENT_REQUIRED_MESSAGE =
  "Parent location is required: name an existing location code, or No parent for a top-level location";

/** B6 — the replies that mean "no parent", matched after `normalisedReply`. */
const NO_PARENT_WORDS: ReadonlySet<string> = new Set(["no parent", "none", "root", "top level", "top-level"]);

type DraftLocation = NonNullable<OnboardingDraft["location"]>;

/**
 * B5 — whether the draft still has to choose a parent: it has a location, the
 * key is absent, and the organization has at least one active location to
 * choose from. `null` is a choice; an organization with no active location is
 * not asked, and its absent key is a root at commit.
 */
export function parentChoicePending(
  location: Pick<DraftLocation, "parentCode"> | undefined,
  placement: PlacementContext,
): boolean {
  return (
    location !== undefined &&
    location.parentCode === undefined &&
    placement.candidates.some((candidate) => candidate.active)
  );
}

/**
 * B2 — the one case rule for a parent code, in every path: the candidate whose
 * code is equal, else the single candidate whose code is equal without regard
 * to case. Two candidates that differ only in case and match neither exactly
 * are no match. Validate and the commit resolve a stored code by this rule;
 * `set_location` and the guided step store the candidate's own code.
 */
export function findParentCandidate(
  parentCode: string,
  candidates: readonly ParentCandidate[],
): ParentCandidate | undefined {
  const exact = candidates.find((candidate) => candidate.code === parentCode);
  if (exact !== undefined) {
    return exact;
  }
  const folded = parentCode.toLowerCase();
  const matches = candidates.filter((candidate) => candidate.code.toLowerCase() === folded);
  return matches.length === 1 ? matches[0] : undefined;
}

/** B2 — a named code as the candidate's own code; absent, `null` and a code with no match are unchanged. */
export function canonicalParentCode<T extends string | null | undefined>(parentCode: T, placement: PlacementContext): T {
  if (typeof parentCode !== "string") {
    return parentCode;
  }
  return (findParentCandidate(parentCode, placement.candidates)?.code ?? parentCode) as T;
}

/**
 * B4 — the guard's own sentence for a named parent that the commit would
 * refuse, or `null`. Absent and `null` have no problem here. The order is the
 * commit's (`assertParentPlacement`): not found, then depth, then inactive.
 * The code is matched by `findParentCandidate`, as the commit resolves it, and
 * is never echoed (AGENTS.md §4.3).
 */
export function parentPlacementProblem(
  parentCode: string | null | undefined,
  placement: PlacementContext,
): string | null {
  if (parentCode === undefined || parentCode === null) {
    return null;
  }
  const parent = findParentCandidate(parentCode, placement.candidates);
  if (parent === undefined) {
    return refusalSentence("location_parent_not_found");
  }
  // A new node is a leaf: its height is 1.
  if (depthExceeded(parent.depth, 1)) {
    return refusalSentence("location_depth_exceeded");
  }
  if (!parent.active) {
    return refusalSentence("location_parent_inactive");
  }
  return null;
}

/**
 * B5 (F4.243 review #1) — whether the parent step is still open: the choice is
 * pending, or the stored code is one the commit would refuse (inactive,
 * deleted, too deep, unknown). The second keeps a draft whose parent went bad
 * after it was stored at `location`, as F4.162 does for a retired type, so the
 * guided step can repair it.
 */
export function parentChoiceOpen(
  location: Pick<DraftLocation, "parentCode"> | undefined,
  placement: PlacementContext,
): boolean {
  return (
    parentChoicePending(location, placement) ||
    (location !== undefined && parentPlacementProblem(location.parentCode, placement) !== null)
  );
}

/** B6 (F4.243 review #3) — the candidates a reply may choose: the ones the commit would accept as a parent. */
function choosableCandidates(placement: PlacementContext): ParentCandidate[] {
  return placement.candidates.filter((candidate) => parentPlacementProblem(candidate.code, placement) === null);
}

/**
 * B6 — the guided step's question and its chips: each code the commit would
 * accept as a parent (capped by the echo bound), then **No parent** and
 * **View draft**. A cut list says how many codes it left out, so the user
 * knows to type one. A stored `parentCode` the commit would refuse puts the
 * guard's sentence first; the code itself is not echoed (AGENTS.md §4.3).
 */
export function parentQuestion(
  name: string,
  placement: PlacementContext,
  storedParentCode?: string | null,
): { text: string; replies: string[] } {
  const codes = choosableCandidates(placement).map((candidate) => candidate.code);
  const { shown, omitted } = echoedItems(codes);
  const tail = omitted > 0 ? ` (${moreTail(omitted, "locations")}: type the code.)` : "";
  const problem = parentPlacementProblem(storedParentCode, placement);
  const lead = problem === null ? "" : `${problem}. `;
  return {
    text: `${lead}Which existing location is **${name}** under?${tail} Say **${NO_PARENT_REPLY}** for a top-level location.`,
    replies: [...shown, NO_PARENT_REPLY, "View draft"],
  };
}

/** Lower case, one space, no trailing `.!?` — the guided mode's reading of a typed reply. */
function normalisedReply(message: string): string {
  return message.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/**
 * B6 — what one reply to the parent question chooses, among the candidates
 * the commit would accept (`choosableCandidates`). A code wins over a name
 * and is matched by `findParentCandidate`; a name counts only when one
 * candidate has it, compared without regard to case. The stored value is the
 * candidate's own code. The "no parent" words choose a root. Anything else is
 * `unmatched`: the caller asks again and writes nothing.
 */
export function resolveParentTurn(
  message: string,
  placement: PlacementContext,
): { kind: "code"; code: string } | { kind: "root" } | { kind: "unmatched" } {
  const reply = normalisedReply(message);
  if (reply === "") {
    return { kind: "unmatched" };
  }
  const choosable = choosableCandidates(placement);
  const byCode = findParentCandidate(message.trim(), choosable) ?? findParentCandidate(reply, choosable);
  if (byCode !== undefined) {
    return { kind: "code", code: byCode.code };
  }
  const byName = choosable.filter((candidate) => normalisedReply(candidate.name) === reply);
  if (byName.length === 1) {
    return { kind: "code", code: byName[0].code };
  }
  if (NO_PARENT_WORDS.has(reply)) {
    return { kind: "root" };
  }
  return { kind: "unmatched" };
}
