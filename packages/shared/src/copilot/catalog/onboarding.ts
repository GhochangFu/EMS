import { commitOnboardingBodySchema, copyOnboardingCredentialsBodySchema } from "../../contracts/onboarding";
import {
  MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS,
  MQTT_DISCOVERY_SHARED_USER_WARNING,
  MQTT_PLAIN_TLS_OFF_SENTENCE,
  startOnboardingDiscoveryBodySchema,
} from "../../contracts/onboarding-discovery";
import { plural, quoted, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogSummaryInput, ExcludedRoute } from "./types";

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

/** The copy's summary is the same with or without the "No credential value" tail; the tail is ADR 0022 decision 2. */
const NO_VALUE_SENTENCE = "No credential value is shown or sent.";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decision 1) — the copy card's words:
 * codes and the broker from the stored proposal the server passes
 * (`credentialCopy`), never a credential. Without that data (a fixture) the
 * body's indexes stand in.
 */
function credentialCopySummary({ body, credentialCopy }: CatalogSummaryInput): string {
  if (credentialCopy) {
    const to = credentialCopy.toCodes.map(quoted).join(", ");
    const broker = `${credentialCopy.host ?? "(default host)"}:${credentialCopy.port ?? "(default port)"}`;
    return (
      `Copy the stored credentials of RTU ${quoted(credentialCopy.fromCode)} to ${credentialCopy.toCodes.length === 1 ? "RTU" : "RTUs"} ${to} ` +
      `(same broker ${broker}, TLS ${credentialCopy.tls ? "on" : "off"}). ${NO_VALUE_SENTENCE}`
    );
  }
  const b = body as { from?: { rtuIndex?: unknown }; toRtuIndexes?: unknown };
  const to = Array.isArray(b.toRtuIndexes) ? b.toRtuIndexes.map(String) : [];
  return (
    `Copy the stored credentials of the RTU at index ${String(b.from?.rtuIndex ?? "")} to the ${to.length === 1 ? "RTU" : "RTUs"} ` +
    `at index ${to.join(", ")} (same broker). ${NO_VALUE_SENTENCE}`
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
   * when the draft's RTU host or port changed since. `F4.326` (ADR 0114 R5, R6):
   * `expected.tls` binds the TLS choice the same way, and the summary prints
   * `TLS: on.` or the TLS-off sentence from it.
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
    // F3.24b U4: the server-made card shows the broker (host, port), the TLS choice (F4.326), the filter,
    // the window and the shared-user warning, all from the hashed body — what Confirm sends is what it shows.
    summary: ({ body, targetName }) => {
      const b = body as {
        rtuCode?: unknown;
        topicPrefix?: unknown;
        windowSeconds?: unknown;
        expected?: { host?: unknown; port?: unknown; tls?: unknown };
      };
      const seconds = typeof b.windowSeconds === "number" ? b.windowSeconds : MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS;
      return (
        `Listen on the broker of RTU ${quoted(String(b.rtuCode ?? ""))} of the draft for site ${quoted(targetName)}. ` +
        `Host: ${quoted(String(b.expected?.host ?? ""))}. Port: ${String(b.expected?.port ?? "")}. ${b.expected?.tls === false ? `${MQTT_PLAIN_TLS_OFF_SENTENCE} ` : "TLS: on. "}` +
        `Topic filter: ${quoted(`${String(b.topicPrefix ?? "")}/#`)}. Window: ${seconds} s. ${MQTT_DISCOVERY_SHARED_USER_WARNING}`
      );
    },
  },
  /**
   * `F4.339` PR 9 (ADR 0099 Amendment 18 decisions 1–3) — copies one draft
   * RTU's stored, encrypted credential to other MQTT RTUs of the draft on the
   * same broker. Made by the **server** after a turn whose onboarding agent
   * proposed it (`propose_credential_copy`). The card's body is
   * `{ from: { rtuIndex }, toRtuIndexes, draftHash }`: a draft source only
   * (Q1), never `replace` (Q2), bound to the draft hash (Q3), so a draft
   * changed since answers 400 and copies nothing. The drawer's select sends
   * the same route without the header or the hash. `edit` (Q4): it changes a
   * draft RTU's credential and creates no row.
   */
  {
    id: "onboarding.credentials.copy",
    title: "Copy an RTU's stored credentials to other RTUs",
    method: "POST",
    path: "/admin/onboarding/sessions/:id/credentials/copy",
    params: { id: uuidParam },
    body: copyOnboardingCredentialsBodySchema,
    bodyName: "copyOnboardingCredentialsBodySchema",
    clientOnly: [],
    proposer: "server",
    risk: "edit",
    target: { kind: "onboardingSession", param: "id" },
    refs: [],
    formulas: [],
    // A canvas entry (`CANVAS_ENTRY_IDS`): its human form is the drawer's "Same credentials as…"
    // select, a plain form and no stepper (Amendment 18 consequences), so it has no steps.
    steps: [],
    summary: credentialCopySummary,
  },
];

const DRAFT = "a draft step writes no master data (decision 7)";
const CREDENTIAL = "a credential route (ADR 0022)";
const LOCK = "a global-admin lock is a human act (ADR 0117 decision 9)";

/** The area's write routes that are not entries, excluded for good (with the reason). */
export const ONBOARDING_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/onboarding/sessions", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/upload", reason: DRAFT },
  { method: "PATCH", path: "/admin/onboarding/sessions/:id/draft", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/credentials", reason: CREDENTIAL },
  { method: "POST", path: "/admin/onboarding/sessions/:id/rollback", reason: DRAFT },
  { method: "POST", path: "/admin/onboarding/sessions/:id/validate", reason: DRAFT },
  // F4.339 (ADR 0117 decision 9): never a copilot card.
  { method: "POST", path: "/admin/onboarding/sessions/:id/lock", reason: LOCK },
  { method: "POST", path: "/admin/onboarding/sessions/:id/unlock", reason: LOCK },
];
