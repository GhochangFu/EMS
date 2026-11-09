import type { OnboardingDraft } from "@bms/shared";
import { z, type ZodTypeAny } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import {
  CREDENTIAL_COPY_MAX_TARGETS,
  credentialCopyProposalSchema,
  type CredentialCopyProposal,
} from "./onboarding-credential-copy-state";
import { brokerOf, sameBroker } from "./onboarding-mqtt-broker";
import { ownBlobAt, readEncryptedCredentials, rtuSecretKey } from "./onboarding-redaction";
import { fail, succeed, type ToolOutcome, type ToolState } from "./onboarding-tool-outcome";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decision 2) — the onboarding agent's
 * `propose_credential_copy`. **It writes nothing**: it checks the copy the
 * user asked for and records a proposal; the server makes the Confirm card
 * after the turn (`copilot-onboarding-credential-copy.ts`), and the route
 * (`POST …/credentials/copy`) checks everything again at Confirm. No argument
 * and no result carries a credential (ADR 0022 decision 2): the stored,
 * encrypted blob is copied by the route, never by the model.
 *
 * A draft source only (ruling Q1), and never over a held credential (Q2).
 * Imported by `onboarding-agent-tools.ts`, never the reverse.
 */

/** The lead of the `propose_credential_copy` action line; the copilot reads it to know the turn proposed (never the model's text). */
export const CREDENTIAL_COPY_PROPOSED_LEAD = "Proposed credential copy from RTU ";

export const CREDENTIAL_COPY_TOOL_NO_CODE =
  "There is no RTU at one of those indexes with a code of its own. Give each RTU a distinct code first.";
export const CREDENTIAL_COPY_TOOL_NOT_MQTT = "Only MQTT RTUs share a stored credential: the source and every target must be MQTT RTUs.";
export const CREDENTIAL_COPY_TOOL_NO_CREDENTIAL =
  "The source RTU has no stored credential for its broker. Tell the user to enter it with Add credentials on the RTU step first.";
export const CREDENTIAL_COPY_TOOL_SELF = "The source RTU cannot be one of its own targets.";
export const CREDENTIAL_COPY_TOOL_OTHER_BROKER =
  "A target RTU is not on the source's broker (host, port and TLS). Only RTUs on the same broker share a credential.";
export const CREDENTIAL_COPY_TOOL_HELD =
  "A target RTU already holds a credential, and this copy never replaces one. Tell the user to change it on the RTU step.";
/** Review finding 2: one server-made card per turn, so a copy after a commit or discovery proposal would get none. */
export const CREDENTIAL_COPY_TOOL_ONE_CARD =
  "This turn already proposed a commit or a discovery, and a turn shows one card. Propose the copy on the next turn.";
export const CREDENTIAL_COPY_TOOL_UNSHOWABLE = "This copy cannot be shown on a card. Tell the user to use Same credentials as… on the RTU step.";

export const CREDENTIAL_COPY_TOOL_SCHEMAS = {
  propose_credential_copy: z
    .object({
      fromIndex: z.number().int().min(0),
      toIndexes: z
        .array(z.number().int().min(0))
        .min(1)
        .max(CREDENTIAL_COPY_MAX_TARGETS)
        .refine((indexes) => new Set(indexes).size === indexes.length, { message: "toIndexes must be distinct" }),
    })
    .strict(),
} as const satisfies Record<string, ZodTypeAny>;

export type CredentialCopyToolName = keyof typeof CREDENTIAL_COPY_TOOL_SCHEMAS;

export const CREDENTIAL_COPY_TOOL_DESCRIPTIONS: Record<CredentialCopyToolName, string> = {
  propose_credential_copy:
    "Proposes copying the stored credential of the MQTT RTU at `fromIndex` to the MQTT RTUs at `toIndexes` on the same broker " +
    "(host, port and TLS) that hold none yet. It writes nothing and no credential value is shown or sent: " +
    "the user confirms on the copilot's card.",
};

/** Whether `name` is the credential-copy tool. */
export function isCredentialCopyToolName(name: string): name is CredentialCopyToolName {
  return Object.prototype.hasOwnProperty.call(CREDENTIAL_COPY_TOOL_SCHEMAS, name);
}

/** Runs one validated credential-copy call. */
export function dispatchCredentialCopyTool(
  _name: CredentialCopyToolName,
  args: Record<string, unknown>,
  state: ToolState,
): ToolOutcome {
  return proposeCredentialCopy(args as z.infer<(typeof CREDENTIAL_COPY_TOOL_SCHEMAS)["propose_credential_copy"]>, state);
}

/** The proposal, or the fixed refusal. Every check is the route's, run early so the card is not made to fail. */
function checkedProposal(
  draft: OnboardingDraft,
  fromIndex: number,
  toIndexes: readonly number[],
  earned: ReadonlySet<string>,
): CredentialCopyProposal | string {
  const rtus = draft.rtus ?? [];
  const source = rtus[fromIndex];
  const fromCode = rtuSecretKey(draft, fromIndex);
  if (source === undefined || fromCode === null) return CREDENTIAL_COPY_TOOL_NO_CODE;
  if (source.protocol !== "mqtt") return CREDENTIAL_COPY_TOOL_NOT_MQTT;
  // `readEncryptedCredentials` honours the broker binding (review H1): a blob its RTU no longer serves is none.
  if (readEncryptedCredentials(draft, fromIndex) === null) return CREDENTIAL_COPY_TOOL_NO_CREDENTIAL;
  if (toIndexes.includes(fromIndex)) return CREDENTIAL_COPY_TOOL_SELF;
  const broker = brokerOf(source.config);
  const toCodes: string[] = [];
  for (const index of toIndexes) {
    const target = rtus[index];
    const code = rtuSecretKey(draft, index);
    if (target === undefined || code === null) return CREDENTIAL_COPY_TOOL_NO_CODE;
    if (target.protocol !== "mqtt") return CREDENTIAL_COPY_TOOL_NOT_MQTT;
    if (!sameBroker(broker, brokerOf(target.config))) return CREDENTIAL_COPY_TOOL_OTHER_BROKER;
    // Ruling Q2: the card never sends `replace`, so a held target would only answer 409 at Confirm.
    // Review finding 1: a discovered device's copy earned earlier this turn lands after the turn; it counts as held.
    if (ownBlobAt(draft, index) !== null || earned.has(code)) return CREDENTIAL_COPY_TOOL_HELD;
    toCodes.push(code);
  }
  return { fromIndex, toIndexes: [...toIndexes], fromCode, toCodes, host: broker.host, port: broker.port, tls: broker.tls };
}

function proposeCredentialCopy(
  args: z.infer<(typeof CREDENTIAL_COPY_TOOL_SCHEMAS)["propose_credential_copy"]>,
  state: ToolState,
): ToolOutcome {
  if (state.pendingProposal !== undefined || state.pendingDiscovery !== undefined) {
    return fail(CREDENTIAL_COPY_TOOL_ONE_CARD);
  }
  const earned = new Set((state.secretCopies ?? []).map((copy) => copy.to));
  const proposal = checkedProposal(state.working, args.fromIndex, args.toIndexes, earned);
  if (typeof proposal === "string") {
    return fail(proposal);
  }
  // The stored reader fails closed; a proposal it would drop (an over-long host) is refused here instead of silently.
  if (!credentialCopyProposalSchema.safeParse({ ...proposal, proposedAt: "" }).success) {
    return fail(CREDENTIAL_COPY_TOOL_UNSHOWABLE);
  }
  state.pendingCredentialCopy = proposal;
  const { shown, omitted } = echoedItems(proposal.toCodes.map((code) => quoteCell(code)));
  const targets = [...shown, moreTail(omitted, "RTUs")].filter(Boolean).join(", ");
  return succeed(
    {
      proposed: true,
      next: "The user confirms on the copilot's card. You cannot copy a credential, and no credential value is shown or sent.",
    },
    `${CREDENTIAL_COPY_PROPOSED_LEAD}${quoteCell(proposal.fromCode)} to ${proposal.toCodes.length === 1 ? "RTU" : "RTUs"} ${targets}`,
  );
}
