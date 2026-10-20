import { MAX_DRAFT_RECORD_BYTES, MAX_DRAFT_RECORD_KEYS, type OnboardingDraft } from "@bms/shared";

import { draftCountProblem, draftRecordProblem } from "./onboarding-draft-caps";
import { write, type ToolState } from "./onboarding-tool-outcome";

/**
 * `F4.116` (owner rulings 2026-10-20) — the draft's four free-form records are
 * bounded on key count and bytes. The `PATCH` path is
 * `onboarding-locked-writes.spec.ts` U16/U17. Assertions live here (ADR 0014);
 * the `.test` sibling registers one `it()` per claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function keys(count: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
}

const RTU = { code: "RTU-1", displayName: "RTU-1", protocol: "mqtt" as const, config: { host: "h" } };
const ASSET = { rtuIndex: 0, code: "A1", name: "A1", siteName: "S", domain: "electrical" };

/** One draft with `record` placed at the named path. */
function draftWith(path: "location.meta" | "rtus[0].config" | "rtus[1].meta" | "assets[0].meta", record: unknown): OnboardingDraft {
  const location: Record<string, unknown> = { code: "L1", name: "L1" };
  const rtus: Record<string, unknown>[] = [{ ...RTU }, { ...RTU, code: "RTU-2" }];
  const assets: Record<string, unknown>[] = [{ ...ASSET }];
  if (path === "location.meta") location.meta = record;
  if (path === "rtus[0].config") rtus[0].config = record;
  if (path === "rtus[1].meta") rtus[1].meta = record;
  if (path === "assets[0].meta") assets[0].meta = record;
  return { location, rtus, assets } as unknown as OnboardingDraft;
}

const PATHS = ["location.meta", "rtus[0].config", "rtus[1].meta", "assets[0].meta"] as const;

/** B1 — the owner's numbers. */
export function assertB1TheBoundsArePinned(): void {
  assert(MAX_DRAFT_RECORD_KEYS === 64, `keys ${MAX_DRAFT_RECORD_KEYS}, expected 64`);
  assert(MAX_DRAFT_RECORD_BYTES === 8192, `bytes ${MAX_DRAFT_RECORD_BYTES}, expected 8192`);
}

/** B2 — every record: 64 keys pass, 65 are refused with the record's path and the excess. */
export function assertB2SixtyFiveKeysAreRefusedInEveryRecord(): void {
  for (const path of PATHS) {
    assert(draftRecordProblem(draftWith(path, keys(64))) === null, `${path}: 64 keys were refused`);
    const problem = draftRecordProblem(draftWith(path, keys(65)));
    assert(problem !== null && problem.startsWith(`${path} holds 65 keys`) && problem.includes("remove 1 of them"), `${path}: got ${problem}`);
  }
}

/** B3 — keys count at every nesting level, inside arrays too. */
export function assertB3NestedKeysCount(): void {
  const record = { outer: { ...keys(30) }, list: [{ ...keys(30) }], top: 1 };
  // 3 top-level + 30 + 30 = 63 → passes; one more nested key → 64 passes; two → 65 refused.
  assert(draftRecordProblem(draftWith("rtus[0].config", record)) === null, "63 nested keys were refused");
  const over = { ...record, outer: { ...keys(32) } };
  const problem = draftRecordProblem(draftWith("rtus[0].config", over));
  assert(problem !== null && problem.includes("holds 65 keys"), `got ${problem}`);
}

/** B4 — bytes: exactly 8,192 bytes of JSON pass; one more is refused. */
export function assertB4TheByteBoundIsInclusive(): void {
  const frame = JSON.stringify({ v: "" }).length; // {"v":""}
  const at = { v: "x".repeat(MAX_DRAFT_RECORD_BYTES - frame) };
  assert(draftRecordProblem(draftWith("assets[0].meta", at)) === null, "8,192 bytes were refused");
  const over = { v: "x".repeat(MAX_DRAFT_RECORD_BYTES - frame + 1) };
  const problem = draftRecordProblem(draftWith("assets[0].meta", over));
  assert(problem !== null && problem.startsWith("assets[0].meta is 8193 bytes"), `got ${problem}`);
}

/** B5 — bytes count UTF-8, not UTF-16 code units: 2,731 three-byte characters are over. */
export function assertB5BytesAreUtf8(): void {
  const record = { v: "€".repeat(2_731) };
  const problem = draftRecordProblem(draftWith("location.meta", record));
  assert(problem !== null && problem.includes("bytes"), `a multi-byte record under 8,192 UTF-16 units passed: ${problem}`);
}

/** B6 — `draftCountProblem` carries the record bound, so chat, tools, propose and commit all refuse. */
export function assertB6TheCountCheckCarriesTheRecordBound(): void {
  const problem = draftCountProblem(draftWith("rtus[1].meta", keys(65)));
  assert(problem !== null && problem.startsWith("rtus[1].meta holds 65 keys"), `got ${problem}`);
}

/** B7 — a tool write that would store an oversized record is refused and the working draft is unchanged. */
export function assertB7AToolWriteIsRefused(): void {
  const state: ToolState = { working: draftWith("location.meta", { a: 1 }) };
  const out = write(state, { location: { code: "L1", name: "L1", meta: keys(65) } } as never, "Set location");
  assert(!out.ok && (out.error ?? "").startsWith("location.meta holds 65 keys"), `got ${out.content}`);
  assert(JSON.stringify(state.working.location?.meta) === JSON.stringify({ a: 1 }), "the refused write changed the draft");
}
