/**
 * `F3.25` (ADR 0094 decisions 3 and 5) — the pure checkpoint module.
 *
 * The restore is **wholesale**: each of the seven sections is assigned from the
 * checkpoint or deleted. `mergeDraftPatch` merges `location` and
 * `onboardingMeta` field by field and keeps a section a patch leaves out, so a
 * restore through it would keep what the undone step added. The section claims
 * below each carry that control beside the restore, so the reason for the
 * design is asserted, not only stated.
 */
import type { OnboardingDraft } from "@bms/shared";

import { moreTail, quoteCell } from "../spreadsheet-guard";
import {
  MAX_CHECKPOINT_LABEL_CHARS,
  MAX_CHECKPOINT_RING_BYTES,
  MAX_ONBOARDING_CHECKPOINTS,
  checkpointLabel,
  cutRingBefore,
  isUndoPhrase,
  pushCheckpoint,
  readCheckpoints,
  restoreSections,
  takeCheckpoint,
  undoReply,
  type Checkpoint,
} from "./onboarding-checkpoints";
import { attachCommitProposal, COMMIT_PROPOSAL_KEY, readCommitProposal } from "./onboarding-commit-proposal";
import { DRAFT_SECTIONS, mergeDraftPatch, type DraftSection } from "./onboarding-draft-merge";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Rtu = NonNullable<OnboardingDraft["rtus"]>[number];
type Blob = { c: string; iv: string; v?: number };
type StoredDraft = OnboardingDraft & { _secrets?: Record<string, Blob>; _commitProposal?: unknown };

const BLOB: Blob = { c: "Y2lwaGVy", iv: "aXY=", v: 1 };

const PROPOSAL = {
  draftHash: "a".repeat(64),
  summary: "Commit 1 RTU.",
  proposedAt: "2026-10-06T00:00:00.000Z",
};

function rtu(code: string, credentialsSet?: boolean): Rtu {
  return {
    code,
    displayName: code,
    protocol: "mqtt",
    config: { host: "broker.local" },
    ...(credentialsSet === undefined ? {} : { credentialsSet }),
  };
}

const LOCATION = { code: "BRH", slug: "brh", name: "Berhampur", latitude: 19.3, longitude: 84.8 };

const META = { takenAt: "2026-10-06T00:00:00.000Z", label: "a step", userMessageId: "m-1" };

function take(draft: StoredDraft, seq: number): Checkpoint {
  return takeCheckpoint(draft, { ...META, seq });
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

/** (1) The copy holds the sections only, deep-equal and detached. */
export function assertTakeCheckpointCopiesTheSectionsOnly(): void {
  const draft = attachCommitProposal<StoredDraft>(
    { location: { ...LOCATION }, rtus: [rtu("RTU-1", true)], _secrets: { "RTU-1": { ...BLOB } } },
    PROPOSAL,
  );
  assert(hasOwn(draft, "_secrets"), "the fixture carries _secrets (adjacent positive)");
  assert(readCommitProposal(draft) !== null, "the fixture carries a commit proposal (adjacent positive)");
  const cp = take(draft, 1);
  assert(JSON.stringify(cp.sections.rtus) === JSON.stringify(draft.rtus), "sections.rtus deep-equals the draft's");
  assert(!("_secrets" in cp.sections), "_secrets is not copied into a checkpoint");
  assert(!(COMMIT_PROPOSAL_KEY in cp.sections), "_commitProposal is not copied into a checkpoint");
  for (const key of Object.keys(cp.sections)) {
    assert((DRAFT_SECTIONS as readonly string[]).includes(key), `section key ${key} is a DRAFT_SECTIONS member`);
  }
  (draft.rtus as Rtu[])[0]!.code = "MUTATED";
  draft.location!.name = "Mutated";
  const rtus = cp.sections.rtus as Rtu[];
  assert(rtus[0]!.code === "RTU-1", "mutating the draft afterwards leaves the checkpoint's rtus unchanged");
  assert((cp.sections.location as { name: string }).name === "Berhampur", "the checkpoint's location is detached");
}

/** (2) An empty draft gives empty sections. */
export function assertTakeCheckpointOfAnEmptyDraftHasNoSections(): void {
  const cp = take({}, 1);
  assert(JSON.stringify(cp.sections) === "{}", `sections is {}, got ${JSON.stringify(cp.sections)}`);
}

/** (3) Anything invalid reads as an empty ring; a valid ring of 3 round-trips. */
export function assertReadCheckpointsFailsClosed(): void {
  const valid = take({ rtus: [rtu("RTU-1")] }, 1);
  const leaky = { ...valid, sections: { ...valid.sections, _secrets: { "RTU-1": BLOB } } };
  for (const [name, column] of [
    ["null", null],
    ['"x"', "x"],
    ['[{ id: "1" }]', [{ id: "1" }]],
    ["an entry with sections._secrets", [leaky]],
  ] as const) {
    assert(readCheckpoints(column).length === 0, `readCheckpoints(${name}) is []`);
  }
  const ring = [take({}, 1), take({ rtus: [rtu("RTU-1")] }, 2), take({ location: { ...LOCATION } }, 3)];
  const read = readCheckpoints(JSON.parse(JSON.stringify(ring)));
  assert(read.length === 3, `a valid ring of 3 reads as 3, got ${read.length}`);
}

/** (4) The ring holds the last ten. */
export function assertPushCheckpointKeepsTheLastTen(): void {
  let ring: Checkpoint[] = [];
  for (let seq = 1; seq <= MAX_ONBOARDING_CHECKPOINTS; seq += 1) {
    ring = pushCheckpoint(ring, take({}, seq)).ring;
  }
  assert(ring.length === MAX_ONBOARDING_CHECKPOINTS, "the fixture ring holds ten");
  const pushed = pushCheckpoint(ring, take({}, 11));
  const seqs = pushed.ring.map((cp) => cp.seq);
  assert(pushed.ring.length === MAX_ONBOARDING_CHECKPOINTS, `length is 10, got ${pushed.ring.length}`);
  assert(!seqs.includes(1), "seq 1 is dropped");
  assert(seqs.includes(11), "seq 11 is held");
  assert(pushed.dropped === "oldest", `dropped is "oldest", got ${pushed.dropped}`);
}

function bigCheckpoint(seq: number, bytes: number): Checkpoint {
  return take({ rtus: [{ ...rtu(`RTU-${seq}`), config: { blob: "x".repeat(bytes) } }] }, seq);
}

function ringBytes(ring: readonly Checkpoint[]): number {
  return Buffer.byteLength(JSON.stringify(ring));
}

/** (5) A ring over the byte bound loses its oldest; one snapshot over it is refused. */
export function assertPushCheckpointHoldsTheByteBound(): void {
  const third = Math.floor(MAX_CHECKPOINT_RING_BYTES / 3);
  const ring = [bigCheckpoint(1, third), bigCheckpoint(2, third)];
  const pushed = pushCheckpoint(ring, bigCheckpoint(3, third));
  assert(ringBytes(pushed.ring) <= MAX_CHECKPOINT_RING_BYTES, "the pushed ring is under the byte bound");
  assert(pushed.dropped === "oldest", `dropped is "oldest", got ${pushed.dropped}`);
  assert(
    JSON.stringify(pushed.ring.map((cp) => cp.seq)) === "[2,3]",
    `only the oldest went, got ${JSON.stringify(pushed.ring.map((cp) => cp.seq))}`,
  );

  const small = [take({}, 1)];
  const refused = pushCheckpoint(small, bigCheckpoint(2, MAX_CHECKPOINT_RING_BYTES));
  assert(refused.dropped === "too_large", `a snapshot over the bound is "too_large", got ${refused.dropped}`);
  assert(JSON.stringify(refused.ring) === JSON.stringify(small), "the ring is unchanged when the snapshot is refused");
}

/** What the undone step added, per section: the checkpoint value and the current value. */
const SECTION_CASES: Record<DraftSection, { checkpoint: StoredDraft; current: StoredDraft; gone: (d: StoredDraft) => boolean }> = {
  location: {
    checkpoint: { location: { ...LOCATION } },
    current: { location: { ...LOCATION, type: "plant" } },
    gone: (d) => d.location !== undefined && !hasOwn(d.location, "type"),
  },
  onboardingMeta: {
    checkpoint: {},
    current: { onboardingMeta: { useExistingPointKeys: true } },
    gone: (d) => d.onboardingMeta === undefined,
  },
  rtus: { checkpoint: {}, current: { rtus: [rtu("RTU-1")] }, gone: (d) => d.rtus === undefined },
  pointKeys: { checkpoint: {}, current: { pointKeys: [{ code: "kw", name: "kW" }] }, gone: (d) => d.pointKeys === undefined },
  assets: {
    checkpoint: {},
    current: { assets: [{ rtuIndex: 0, code: "A-1", name: "Pump", siteName: "BRH", domain: "water" } as never] },
    gone: (d) => d.assets === undefined,
  },
  assetPoints: {
    checkpoint: {},
    current: { assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "kw" }] },
    gone: (d) => d.assetPoints === undefined,
  },
  templates: {
    checkpoint: {},
    current: { templates: [{ code: "PUMP", name: "Pump" } as never] },
    gone: (d) => d.templates === undefined,
  },
};

/**
 * (6)–(12) One claim per section: the value the undone step added is gone after
 * the restore, and — the adjacent control — `mergeDraftPatch` with the same
 * checkpoint value keeps it.
 */
export function assertSectionIsRestoredWholesale(section: DraftSection): () => void {
  return () => {
    const { checkpoint, current, gone } = SECTION_CASES[section];
    const cp = take(checkpoint, 1);
    const kept = mergeDraftPatch(current, { [section]: cp.sections[section] } as never) as StoredDraft;
    assert(!gone(kept), `control: mergeDraftPatch keeps what the step added to ${section}`);
    const { draft } = restoreSections(current, cp, { deriveCredentialsSet: true });
    assert(gone(draft as StoredDraft), `restoreSections removes what the step added to ${section}`);
  };
}

/** (13) Secrets: kept for a present RTU, dropped for an absent one, the flag cleared and reported when lost. */
export function assertRestoreReconcilesSecrets(): void {
  const current: StoredDraft = {
    rtus: [rtu("RTU-1", true), rtu("RTU-2", true)],
    _secrets: { "RTU-1": { ...BLOB }, "RTU-2": { ...BLOB } },
  };
  const cp = take({ rtus: [rtu("RTU-1", true), rtu("RTU-3", true)] }, 1);
  const { draft, credentialsLost } = restoreSections(current, cp, { deriveCredentialsSet: true });
  const restored = draft as StoredDraft;
  const secrets = restored._secrets ?? {};
  const byCode = new Map((restored.rtus ?? []).map((r) => [r.code, r]));
  assert(hasOwn(secrets, "RTU-1"), "the blob of RTU-1, still present, is kept");
  assert(byCode.get("RTU-1")?.credentialsSet === true, "RTU-1 keeps credentialsSet: true");
  assert(!hasOwn(secrets, "RTU-2"), "the blob of RTU-2, absent after the restore, is dropped");
  assert(byCode.get("RTU-3")?.credentialsSet === false, "RTU-3, restored without a blob, has credentialsSet: false");
  assert(
    JSON.stringify(credentialsLost) === JSON.stringify(["RTU-3"]),
    `credentialsLost is ["RTU-3"], got ${JSON.stringify(credentialsLost)}`,
  );
}

/** (14) The commit proposal does not survive a restore. */
export function assertRestoreClearsTheCommitProposal(): void {
  const current = attachCommitProposal<StoredDraft>({ rtus: [rtu("RTU-1")] }, PROPOSAL);
  assert(readCommitProposal(current) !== null, "the draft carries a proposal before the restore (adjacent positive)");
  const { draft } = restoreSections(current, take({ rtus: [rtu("RTU-1")] }, 1), { deriveCredentialsSet: true });
  assert(!hasOwn(draft, COMMIT_PROPOSAL_KEY), "_commitProposal is gone after the restore");
}

/** (15) The caller's draft is not mutated. */
export function assertRestoreDoesNotMutateCurrent(): void {
  const current = attachCommitProposal<StoredDraft>(
    {
      location: { ...LOCATION, type: "plant" },
      rtus: [rtu("RTU-1", true), rtu("RTU-2", true)],
      _secrets: { "RTU-1": { ...BLOB }, "RTU-2": { ...BLOB } },
    },
    PROPOSAL,
  );
  const before = JSON.stringify(current);
  restoreSections(current, take({ rtus: [rtu("RTU-3", true)] }, 1), { deriveCredentialsSet: true });
  assert(JSON.stringify(current) === before, "restoreSections leaves `current` unchanged");
  assert(readCommitProposal(current) !== null, "`current` still carries its proposal");
}

/** (16) The ring cut keeps only the lower seqs. */
export function assertCutRingBeforeKeepsLowerSeqs(): void {
  const ring = [take({}, 1), take({}, 2), take({}, 3)];
  const cut = cutRingBefore(ring, ring[1]!);
  assert(JSON.stringify(cut.map((cp) => cp.seq)) === "[1]", `the cut keeps [1], got ${JSON.stringify(cut.map((cp) => cp.seq))}`);
}

/** (17) The label is bounded, names at most three lines, and falls back to the sections. */
export function assertCheckpointLabelIsBounded(): void {
  const lines = Array.from({ length: 8 }, (_, i) => `L${i}:${"a".repeat(296)}`);
  const label = checkpointLabel(lines, ["rtus"]);
  assert(label.length <= MAX_CHECKPOINT_LABEL_CHARS, `the label is at most 200 chars, got ${label.length}`);
  for (const i of [0, 1, 2]) {
    assert(label.includes(`L${i}:`), `the label names line ${i}`);
  }
  for (const i of [3, 4, 5, 6, 7]) {
    assert(!label.includes(`L${i}:`), `the label does not name line ${i}`);
  }
  assert(label.endsWith(moreTail(5)), `the label ends with ${moreTail(5)}, got ${label}`);

  const fallback = checkpointLabel([], ["rtus", "assets"]);
  assert(fallback.includes("rtus") && fallback.includes("assets"), `with no lines the label names the sections, got ${fallback}`);
}

/** (18) The undo phrase is exact after trim and case-folding. */
export function assertIsUndoPhraseIsExact(): void {
  assert(isUndoPhrase(" UNDO "), '" UNDO " is the phrase');
  assert(!isUndoPhrase("undo."), '"undo." is not the phrase');
  assert(!isUndoPhrase("undo last"), '"undo last" is not the phrase');
}

/** (19) The reply names lost codes through quoteCell, and says nothing about credentials when none were lost. */
export function assertUndoReplyNamesLostCredentials(): void {
  const lost = undoReply("Added RTU RTU-3", ["RTU-3"]);
  assert(lost.includes(quoteCell("RTU-3")), `the reply names ${quoteCell("RTU-3")}, got ${lost}`);
  assert(lost.includes("Enter the credentials"), "the reply asks for the credentials again (adjacent positive)");
  const none = undoReply("Added RTU RTU-3", []);
  assert(!none.includes("Enter the credentials"), `with no loss there is no credentials sentence, got ${none}`);
}
