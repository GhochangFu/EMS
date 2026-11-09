import { MQTT_DISCOVERY_HOST_MAX, ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";
import { z } from "zod";

/**
 * `F4.339` PR 9 (ADR 0099 Amendment 18 decision 2) — the draft key a
 * `propose_credential_copy` turn writes, beside `_discoveryProposal`: server
 * state, outside the commit hash, cleared by every draft write and by a
 * restore, never sent to the client or the model. Its own leaf module, so the
 * hash, the redaction and the checkpoints read the key without the tool.
 */
export const CREDENTIAL_COPY_PROPOSAL_KEY = "_credentialCopyProposal";

/** The most targets one copy names: the route's `toRtuIndexes` bound. */
export const CREDENTIAL_COPY_MAX_TARGETS = 100;

const codeSchema = z.string().min(1).max(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]);

/**
 * The stored proposal: the indexes the card's body carries, and the codes and
 * the broker the card's words show (display data, never a credential). Strict
 * and bounded, so a malformed blob reads as none.
 */
export const credentialCopyProposalSchema = z
  .object({
    fromIndex: z.number().int().min(0),
    toIndexes: z.array(z.number().int().min(0)).min(1).max(CREDENTIAL_COPY_MAX_TARGETS),
    fromCode: codeSchema,
    toCodes: z.array(codeSchema).min(1).max(CREDENTIAL_COPY_MAX_TARGETS),
    host: z.string().min(1).max(MQTT_DISCOVERY_HOST_MAX).nullable(),
    port: z.number().int().min(1).max(65_535).nullable(),
    tls: z.boolean(),
    proposedAt: z.string(),
  })
  .strict();

export type StoredCredentialCopyProposal = z.infer<typeof credentialCopyProposalSchema>;

/** What the tool records in the turn; the turn's end stamps `proposedAt`. */
export type CredentialCopyProposal = Omit<StoredCredentialCopyProposal, "proposedAt">;

/** A shallow copy of `draft` carrying `proposal` as `_credentialCopyProposal`. */
export function attachCredentialCopyProposal<T extends object>(draft: T, proposal: StoredCredentialCopyProposal): T {
  return { ...draft, [CREDENTIAL_COPY_PROPOSAL_KEY]: proposal };
}

/** The stored credential-copy proposal, or `null`. Fails closed. */
export function readCredentialCopyProposal(draft: unknown): StoredCredentialCopyProposal | null {
  if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
    return null;
  }
  const parsed = credentialCopyProposalSchema.safeParse((draft as Record<string, unknown>)[CREDENTIAL_COPY_PROPOSAL_KEY]);
  return parsed.success ? parsed.data : null;
}
