import { commitOnboardingBodySchema } from "../../contracts/onboarding";
import {
  MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS,
  MQTT_DISCOVERY_SHARED_USER_WARNING,
  startOnboardingDiscoveryBodySchema,
} from "../../contracts/onboarding-discovery";
import { plural, quoted, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/** The draft sections the commit summary reads (a subset of the onboarding draft). */
export type OnboardingCommitDraft = {
  readonly location?: { readonly name?: string | null } | null;
  readonly rtus?: readonly unknown[] | null;
  readonly assets?: readonly unknown[] | null;
  readonly assetPoints?: readonly unknown[] | null;
};

/** The site name a commit card names: the draft's location, or a placeholder for a draft that has none yet. */
export function onboardingCommitSiteName(draft: OnboardingCommitDraft): string {
  const name = draft.location?.name;
  return typeof name === "string" && name.trim() !== "" ? name : "(no name yet)";
}

/**
 * What one onboarding commit creates, in one sentence, from the draft: the
 * server-made card (`F3.86` PR 6) and the drawer's wizard Review read the
 * same words. Counts only; the names are in the draft preview.
 */
export function onboardingCommitCounts(draft: OnboardingCommitDraft): string {
  return (
    `It creates ${plural(draft.rtus?.length ?? 0, "RTU")}, ${plural(draft.assets?.length ?? 0, "asset")} ` +
    `and ${plural(draft.assetPoints?.length ?? 0, "mapping")}.`
  );
}

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the onboarding
 * skill's commit (decision 7). One file per area, so the wizard PRs never
 * edit the same catalog file (plan §4.5).
 *
 * `onboarding.commit` (PR 6, plan §8.2) is made by the **server**, never the
 * model (`proposer: "server"`, so no propose tool exists for it): after a
 * skill turn whose onboarding agent proposed the commit, the copilot stores
 * one pending change whose body is `{ draftHash }` — the hash of the draft
 * that very turn stored. Confirm sends it with the `X-Copilot-Change` header;
 * the route commits through `commitProposed`, so a draft changed since the
 * proposal answers 400 `PROPOSED_DRAFT_CHANGED` and writes nothing. The
 * drawer's own Commit is this entry's wizard, which sends the same body
 * without the header. The Draft step describes the draft and holds the hash
 * (no input), the PR 10a precedent for a field with no input.
 *
 * The target is the session the path names; the resolver never resolves it
 * (a server-made change has no propose tool), and the route's own checks run
 * at Confirm.
 */
export const ONBOARDING_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "onboarding.commit",
    title: "Commit the onboarding draft",
    method: "POST",
    path: "/admin/onboarding/sessions/:id/commit",
    params: { id: uuidParam },
    body: commitOnboardingBodySchema,
    bodyName: "commitOnboardingBodySchema",
    clientOnly: [],
    proposer: "server",
    risk: "create",
    target: { kind: "onboardingSession", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "draft", title: "Draft", fields: ["draftHash"] }],
    summary: ({ targetName }) => `Commit the onboarding draft for site ${quoted(targetName)}.`,
  },
  /**
   * `F3.24b` (ADR 0103 decision 2) — one bounded, read-only MQTT listening
   * job on the broker of a draft RTU. Made by the **server** after a turn
   * whose onboarding agent proposed it (`propose_discovery`), as
   * `onboarding.commit` is; the drawer's Discover button is its wizard and
   * sends the same body without the header. `expected` is the broker the
   * card showed, inside the hash (security review H3): the route answers 409
   * when the draft's RTU host or port changed since. TLS is always on
   * (decisions Q5), so the card has no TLS field to show.
   */
  {
    id: "onboarding.discovery",
    title: "Discover the devices on an RTU's broker",
    method: "POST",
    path: "/admin/onboarding/sessions/:id/discovery",
    params: { id: uuidParam },
    body: startOnboardingDiscoveryBodySchema,
    bodyName: "startOnboardingDiscoveryBodySchema",
    clientOnly: [],
    proposer: "server",
    risk: "create",
    target: { kind: "onboardingSession", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "discovery", title: "Discovery", fields: ["rtuCode", "expected", "topicPrefix", "windowSeconds"] }],
    summary: ({ body, targetName }) => {
      const b = body as { rtuCode?: unknown; topicPrefix?: unknown; windowSeconds?: unknown };
      const seconds = typeof b.windowSeconds === "number" ? b.windowSeconds : MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS;
      return (
        `Listen on the broker of RTU ${quoted(String(b.rtuCode ?? ""))} of the draft for site ${quoted(targetName)} ` +
        `on ${quoted(`${String(b.topicPrefix ?? "")}/#`)} for ${seconds} s, with TLS. ${MQTT_DISCOVERY_SHARED_USER_WARNING}`
      );
    },
  },
];

const DRAFT = "a draft step writes no master data (decision 7)";
const CREDENTIAL = "a credential route (ADR 0022)";

/** The area's write routes that are not entries, excluded for good (with the reason). */
export const ONBOARDING_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/onboarding/sessions", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/upload", reason: DRAFT },
  { method: "PATCH", path: "/admin/onboarding/sessions/:id/draft", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/credentials", reason: CREDENTIAL },
  { method: "POST", path: "/admin/onboarding/sessions/:id/rollback", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/validate", reason: DRAFT },
];
