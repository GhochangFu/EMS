import { randomUUID } from "node:crypto";

import type { OnboardingDraft } from "@bms/shared";
import { z } from "zod";

import { echoedItems, moreTail, quoteCell } from "../spreadsheet-guard";
import { cloneJson } from "../stack-safe-json";
import { COMMIT_PROPOSAL_KEY } from "./onboarding-commit-proposal";
import { cutToBound } from "./onboarding-draft-caps";
import { DRAFT_SECTIONS } from "./onboarding-draft-merge";
import { reconcileSecrets, type EncryptedBlob } from "./onboarding-redaction";

/**
 * Draft checkpoints and the step undo (`F3.25`, ADR 0094 decisions 3 and 5).
 * Pure: no Nest, no database. `OnboardingService` reads and writes the ring in
 * `bms.onboarding_sessions.checkpoints`; this module owns its shape and every
 * rule over it.
 *
 * A checkpoint is the seven draft sections as they were **before** a chat turn
 * changed them. It never holds `_secrets` or `_commitProposal` (those are
 * server state, not sections), and it never reaches a client or a prompt — only
 * `checkpointSummary` does.
 *
 * **The restore is wholesale.** `mergeDraftPatch` merges `location` and
 * `onboardingMeta` field by field and keeps any section a patch leaves out, so
 * restoring through it would keep a location `type` or a `useExistingPointKeys`
 * the undone step added. `restoreSections` assigns each section from the
 * checkpoint or deletes it.
 */

export const MAX_ONBOARDING_CHECKPOINTS = 10;

/**
 * Bounds `JSON.stringify(ring)`. One snapshot can approach 1 MB at the draft
 * caps, and the column rides in every `loadSession` read (ADR 0094, plan Q2).
 */
export const MAX_CHECKPOINT_RING_BYTES = 2_000_000;

export const MAX_CHECKPOINT_LABEL_CHARS = 200;

/** How many action lines a label names before its tail. */
const MAX_LABEL_LINES = 3;

const LABEL_SEPARATOR = "; ";

export const UNDO_PHRASE = "undo";

export const NOTHING_TO_UNDO_REPLY =
  "There is no step to undo. Undo goes back one chat step that changed the draft, " +
  "and a manual edit or a workbook upload clears the undo history.";

/**
 * Exact, after trim and case-folding — as `isConfirmCommitPhrase`. `undo.` and
 * `undo last` are ordinary turns.
 */
export function isUndoPhrase(message: string): boolean {
  return message.trim().toLowerCase() === UNDO_PHRASE;
}

/** The action line a rollback appends. Code-written; the label is code-written too. */
export function undidActionLine(label: string): string {
  return `Undid: ${label}`;
}

/**
 * The reply to an undo. Lost RTU codes are draft data, so each goes through
 * `quoteCell`, and the list is bounded by `echoedItems` (AGENTS.md §4.3).
 */
export function undoReply(label: string, credentialsLost: readonly string[]): string {
  const head = `${undidActionLine(label)}.`;
  if (credentialsLost.length === 0) {
    return head;
  }
  const { shown, omitted } = echoedItems(credentialsLost);
  const tail = moreTail(omitted);
  const codes = `${shown.map((code) => quoteCell(code)).join(", ")}${tail ? ` ${tail}` : ""}`;
  return `${head} The stored credentials for ${codes} were removed with the step. Enter the credentials again on the RTU step.`;
}

const sectionsSchema = z
  .object({
    location: z.unknown().optional(),
    rtus: z.unknown().optional(),
    pointKeys: z.unknown().optional(),
    assets: z.unknown().optional(),
    assetPoints: z.unknown().optional(),
    templates: z.unknown().optional(),
    onboardingMeta: z.unknown().optional(),
  })
  .strict();

/**
 * One stored checkpoint. `sections` is a byte copy of values their producers
 * already validated, written only by the server, so each is `unknown` here;
 * `.strict()` makes a `_secrets` or `_commitProposal` key a parse failure.
 */
export const checkpointSchema = z
  .object({
    id: z.string().uuid(),
    seq: z.number().int().min(1),
    takenAt: z.string(),
    label: z.string().max(MAX_CHECKPOINT_LABEL_CHARS),
    userMessageId: z.string(),
    sections: sectionsSchema,
  })
  .strict();

export type Checkpoint = z.infer<typeof checkpointSchema>;

export type CheckpointSummary = Pick<Checkpoint, "id" | "seq" | "label" | "takenAt">;

const ringSchema = z.array(checkpointSchema);

/** The stored ring, or `[]` for anything that does not parse (fail closed). */
export function readCheckpoints(column: unknown): Checkpoint[] {
  const parsed = ringSchema.safeParse(column);
  return parsed.success ? parsed.data : [];
}

/**
 * A checkpoint of the seven sections of `draft`, cloned. The label is cut to
 * its bound here so no checkpoint this writes can fail `checkpointSchema` —
 * `readCheckpoints` is all-or-nothing, and one bad entry would empty the ring.
 */
export function takeCheckpoint(
  draft: OnboardingDraft,
  meta: { readonly seq: number; readonly label: string; readonly userMessageId: string; readonly takenAt: string },
): Checkpoint {
  const sections: Checkpoint["sections"] = {};
  for (const section of DRAFT_SECTIONS) {
    const value = draft[section];
    if (value !== undefined) {
      sections[section] = cloneJson(value);
    }
  }
  return {
    id: randomUUID(),
    seq: meta.seq,
    takenAt: meta.takenAt,
    label: cutToBound(meta.label, MAX_CHECKPOINT_LABEL_CHARS),
    userMessageId: meta.userMessageId,
    sections,
  };
}

/** One above the highest `seq` in the ring, or 1. */
export function nextSeq(ring: readonly Checkpoint[]): number {
  return ring.reduce((max, cp) => Math.max(max, cp.seq), 0) + 1;
}

function ringBytes(ring: readonly Checkpoint[]): number {
  return Buffer.byteLength(JSON.stringify(ring));
}

/**
 * `ring` with `cp` appended, holding at most `MAX_ONBOARDING_CHECKPOINTS`
 * entries and `MAX_CHECKPOINT_RING_BYTES` bytes; the oldest go first. A single
 * snapshot over the byte bound is not recorded and the ring is returned as is.
 */
export function pushCheckpoint(
  ring: readonly Checkpoint[],
  cp: Checkpoint,
): { ring: Checkpoint[]; dropped: "none" | "oldest" | "too_large" } {
  if (ringBytes([cp]) > MAX_CHECKPOINT_RING_BYTES) {
    return { ring: [...ring], dropped: "too_large" };
  }
  const next = [...ring, cp];
  let dropped: "none" | "oldest" = "none";
  while (next.length > MAX_ONBOARDING_CHECKPOINTS || ringBytes(next) > MAX_CHECKPOINT_RING_BYTES) {
    next.shift();
    dropped = "oldest";
  }
  return { ring: next, dropped };
}

/** The entries taken before `cp` (no redo: ADR 0094, plan Q4). */
export function cutRingBefore(ring: readonly Checkpoint[], cp: Checkpoint): Checkpoint[] {
  return ring.filter((entry) => entry.seq < cp.seq);
}

/**
 * A label of at most `MAX_CHECKPOINT_LABEL_CHARS`: the first three action lines,
 * each cut to an equal share, then `moreTail` for the rest. With no lines, the
 * changed section names. Action lines are code-written, so they are not quoted.
 */
export function checkpointLabel(actionLines: readonly string[], changedSections: readonly string[]): string {
  if (actionLines.length === 0) {
    const names = changedSections.length > 0 ? changedSections.join(", ") : "the draft";
    return cutToBound(`Changed ${names}`, MAX_CHECKPOINT_LABEL_CHARS);
  }
  const { shown, omitted } = echoedItems(actionLines, MAX_LABEL_LINES);
  const tail = moreTail(omitted);
  const tailPart = tail ? ` ${tail}` : "";
  const budget = MAX_CHECKPOINT_LABEL_CHARS - tailPart.length - LABEL_SEPARATOR.length * (shown.length - 1);
  const perLine = Math.floor(budget / shown.length);
  const head = shown.map((line) => cutToBound(line, perLine)).join(LABEL_SEPARATOR);
  return `${head}${tailPart}`;
}

/** What a client may see of a checkpoint. Never `sections`. */
export function checkpointSummary(cp: Checkpoint): CheckpointSummary {
  return { id: cp.id, seq: cp.seq, label: cp.label, takenAt: cp.takenAt };
}

type StoredDraft = OnboardingDraft & { _secrets?: Record<string, EncryptedBlob> };

type ConnectionFields = { protocol?: unknown; config?: Record<string, unknown> | null };

/**
 * Security review M2, as `update_rtu` applies it: the fields whose change
 * would send a stored credential to another broker.
 */
function sameConnection(a: ConnectionFields, b: ConnectionFields): boolean {
  const same = (field: string) => JSON.stringify(a.config?.[field]) === JSON.stringify(b.config?.[field]);
  return a.protocol === b.protocol && same("host") && same("port") && same("tls");
}

function trimmedCode(code: unknown): string | null {
  return typeof code === "string" && code.trim().length > 0 ? code.trim() : null;
}

/**
 * Deletes from `draft._secrets` each blob whose restored RTU is not at the
 * connection the blob was entered for — the RTU of that code in `current` —
 * and answers those codes. A blob with no current RTU of its code cannot be
 * checked, so it goes too (fail closed). `reconcileSecrets` matches by code
 * alone, so without this a rollback would hand the credential to the
 * checkpoint's broker.
 */
function dropRebindings(draft: StoredDraft, current: OnboardingDraft): string[] {
  const secrets = draft._secrets;
  if (!secrets) {
    return [];
  }
  const restored = Array.isArray(draft.rtus) ? draft.rtus : [];
  const before = Array.isArray(current.rtus) ? current.rtus : [];
  const dropped: string[] = [];
  for (const code of Object.keys(secrets)) {
    const target = restored.find((rtu) => trimmedCode(rtu?.code) === code);
    if (!target) {
      continue; // No restored RTU holds it; `reconcileSecrets` drops it.
    }
    const held = before.find((rtu) => trimmedCode(rtu?.code) === code);
    if (!held || !sameConnection(target as ConnectionFields, held as ConnectionFields)) {
      delete secrets[code];
      dropped.push(code);
    }
  }
  return dropped;
}

/**
 * `current` with each of the seven sections assigned from `cp` or deleted,
 * `_commitProposal` removed, `_secrets` kept and then reconciled against the
 * restored RTUs. `current` is not mutated.
 *
 * `credentialsLost` names each restored RTU whose checkpoint said
 * `credentialsSet: true` and whose blob is no longer in the store, and each
 * whose blob was dropped because the restore moved its connection.
 */
export function restoreSections(
  current: OnboardingDraft,
  cp: Checkpoint,
  options: { readonly deriveCredentialsSet: boolean },
): { draft: OnboardingDraft; credentialsLost: string[] } {
  const draft = cloneJson(current) as StoredDraft & Record<string, unknown>;
  delete draft[COMMIT_PROPOSAL_KEY];
  for (const section of DRAFT_SECTIONS) {
    const value = cp.sections[section];
    if (value === undefined) {
      delete draft[section];
    } else {
      draft[section] = cloneJson(value) as never;
    }
  }
  const claimed = Array.isArray(draft.rtus) ? draft.rtus.map((rtu) => rtu?.credentialsSet === true) : [];
  const rebound = dropRebindings(draft, current);
  const reconciled = reconcileSecrets(draft, options);
  const credentialsLost: string[] = [...rebound];
  (reconciled.rtus ?? []).forEach((rtu, index) => {
    if (
      claimed[index] &&
      rtu?.credentialsSet !== true &&
      typeof rtu?.code === "string" &&
      !credentialsLost.includes(rtu.code.trim())
    ) {
      credentialsLost.push(rtu.code);
    }
  });
  return { draft: reconciled, credentialsLost };
}
