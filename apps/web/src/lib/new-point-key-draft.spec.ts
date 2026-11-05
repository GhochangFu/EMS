import { expect, vi } from "vitest";
import { CATALOG_CODE_PATTERN } from "@bms/shared";

import { ApiError } from "./api-error";
import { apiErrorMessage } from "./api-error-message";
import { emptyCalcPointDraft } from "./calc-point-draft";
import {
  BATCH_FORMULA_NOT_CHECKED_CLEAN,
  KeyCreatedPointRefusedError,
  NEW_KEY,
  batchFormulaRefusals,
  createKeyThenWritePoint,
  emptyNewPointKeyDraft,
  isPointKeyAlreadyExists,
  keyCreatedPointRefusedMessage,
  newKeyClashProblem,
  newPointKeyBody,
  newPointKeyDraftChanged,
  newPointKeyProblems,
  pointWriteCause,
} from "./new-point-key-draft";

/**
 * `F4.313` (ADR 0109 Amendment 1, A11–A13) — `new-point-key-draft.ts`'s rules,
 * one exported function per claim; `new-point-key-draft.test.ts` is the
 * Vitest entry point (ADR 0014). Each names the mutation it catches.
 */

const TAKEN = new ApiError(JSON.stringify({ statusCode: 409, message: 'Point key "kvar" already exists' }), 409);
const REFUSED = new ApiError(
  JSON.stringify({ statusCode: 400, message: "Point key must exist in the catalog and be active" }),
  400,
);

// Catches: a sentinel a catalog code could equal (the option would shadow a real key).
export function theSentinelIsNoCatalogCode(): void {
  expect(CATALOG_CODE_PATTERN.test(NEW_KEY)).toBe(false);
}

// Catches: a blank unit sent as `""` rather than left absent, or untrimmed text.
export function theBodyTrimsAndLeavesABlankUnitAbsent(): void {
  expect(newPointKeyBody({ code: " kvar ", name: " Reactive ", unit: "  ", domain: "", openedDomain: "" })).toEqual({ code: "kvar", name: "Reactive" });
}

// Catches: a unit dropped from the body when one is typed.
export function aTypedUnitIsSent(): void {
  expect(newPointKeyBody({ code: "kvar", name: "Reactive", unit: "kVAr", domain: "", openedDomain: "" })).toEqual({
    code: "kvar",
    name: "Reactive",
    unit: "kVAr",
  });
}

// Catches: the pre-filled domain not sent (the parameter ignored), or a blank domain sent as `""`.
export function aPrefilledDomainIsSent(): void {
  const body = newPointKeyBody({ ...emptyNewPointKeyDraft("electrical"), code: "kvar", name: "Reactive" });
  expect(body).toEqual({ code: "kvar", name: "Reactive", domain: "electrical" });
}

// Catches: a cleared domain sent as `""` (the key written with an empty domain).
export function aClearedDomainIsAbsentFromTheBody(): void {
  const body = newPointKeyBody({ ...emptyNewPointKeyDraft("electrical"), code: "kvar", name: "Reactive", domain: "  " });
  expect(body).not.toHaveProperty("domain");
}

// Catches: `null` read as the text "null", or a missing domain not blank.
export function noDomainOpensBlank(): void {
  expect(emptyNewPointKeyDraft(null).domain).toBe("");
  expect(emptyNewPointKeyDraft().domain).toBe("");
}

// Catches: the leave prompt firing on a draft nobody has touched.
export function anUntouchedPrefilledDraftIsNotAChange(): void {
  expect(newPointKeyDraftChanged(emptyNewPointKeyDraft("electrical"))).toBe(false);
}

// Catches: an edited or cleared Domain not counting as a change.
export function anEditedDomainIsAChange(): void {
  expect(newPointKeyDraftChanged({ ...emptyNewPointKeyDraft("electrical"), domain: "" })).toBe(true);
  expect(newPointKeyDraftChanged({ ...emptyNewPointKeyDraft("electrical"), domain: "water" })).toBe(true);
}

// Catches: a restated rule that lets a code outside the catalog class through.
export function aCodeOutsideTheCatalogClassIsRefused(): void {
  expect(newPointKeyProblems({ code: "kv ar", name: "Reactive", unit: "", domain: "", openedDomain: "" })).toEqual([
    "code: letters, digits, '_' and '-' only — like TX_01 or kwh_total",
  ]);
}

// Catches: a label that may be left empty (the schema's `name.min(1)`).
export function anEmptyDraftNamesTheCodeAndTheLabel(): void {
  expect(newPointKeyProblems(emptyNewPointKeyDraft()).map((problem) => problem.split(":")[0])).toEqual([
    "code",
    "code",
    "name",
  ]);
}

// Catches: the schema's unit bound (32) not applied.
export function aUnitLongerThanTheSchemaAllowsIsRefused(): void {
  expect(newPointKeyProblems({ code: "kvar", name: "Reactive", unit: "u".repeat(33), domain: "", openedDomain: "" }).length).toBe(1);
}

// Catches: a usable draft reported as a problem.
export function aCompleteDraftHasNoProblem(): void {
  expect(newPointKeyProblems({ code: "kvar", name: "Reactive", unit: "kVAr", domain: "", openedDomain: "" })).toEqual([]);
}

// Catches: "already exists" read from anything other than the 409 status.
export function onlyA409IsAlreadyExists(): void {
  expect([isPointKeyAlreadyExists(TAKEN), isPointKeyAlreadyExists(REFUSED), isPointKeyAlreadyExists("409")]).toEqual([
    true,
    false,
    false,
  ]);
}

// Catches: a reworded sentence (A13's "the panel says so", in the plan's words).
export function theTwoWriteSentenceIsThePlansWords(): void {
  expect(keyCreatedPointRefusedMessage("kvar", "no.")).toBe(
    'The key "kvar" is in the catalog now; the point was not written: no.',
  );
}

// Catches: the server's envelope rendered raw rather than its sentence.
export function theTwoWriteErrorCarriesTheServersSentence(): void {
  expect(apiErrorMessage(new KeyCreatedPointRefusedError("kvar", REFUSED))).toBe(
    'The key "kvar" is in the catalog now; the point was not written: Point key must exist in the catalog and be active',
  );
}

/** A point write refused with `status` after the key exists, as the panel shows it. */
function afterKey(status: number): string {
  return apiErrorMessage(
    new KeyCreatedPointRefusedError("kvar", new ApiError(JSON.stringify({ statusCode: status, message: "Reason." }), status)),
  );
}

// Catches: a 503 (no worker; the point is saved) reported as "the point was not written".
export function aNoWorker503IsNotReportedAsNotWritten(): void {
  expect(afterKey(503)).toBe('The key "kvar" is in the catalog now. Reason.');
}

// Catches: a 409 (a backfill already running; the point is saved) reported as "not written".
export function aBackfillRunning409IsNotReportedAsNotWritten(): void {
  expect(afterKey(409)).toBe('The key "kvar" is in the catalog now. Reason.');
}

// Catches: the neutral prefix widened to every status, hiding a refusal that wrote nothing.
export function a400Or422IsStillReportedAsNotWritten(): void {
  expect([afterKey(400), afterKey(422)]).toEqual([
    'The key "kvar" is in the catalog now; the point was not written: Reason.',
    'The key "kvar" is in the catalog now; the point was not written: Reason.',
  ]);
}

// Catches: a new code equal to one of the asset's point keys let through (untrimmed included).
export function aCodeTheAssetAlreadyHasIsAClash(): void {
  expect([newKeyClashProblem(" kw ", ["kw", "pf"]), newKeyClashProblem("kvar", ["kw", "pf"])]).toEqual([
    'This asset already has a point "kw"; give the new key another code.',
    null,
  ]);
}

// Catches: the batch's `refused[]` parsed from the wrapper rather than the server's body.
export function thePointCauseIsTheServersError(): void {
  expect([pointWriteCause(new KeyCreatedPointRefusedError("kvar", REFUSED)), pointWriteCause(TAKEN)]).toEqual([
    REFUSED,
    TAKEN,
  ]);
}

// Catches: a key created when there is no new key.
export async function withNoNewKeyOnlyThePointIsWritten(): Promise<void> {
  const createKey = vi.fn().mockResolvedValue({});
  const result = await createKeyThenWritePoint(null, createKey, async () => "point");
  expect([result, createKey.mock.calls.length]).toEqual(["point", 0]);
}

// Catches: the point written before the key (A13: the key, then the point).
export async function theKeyIsCreatedBeforeThePointIsWritten(): Promise<void> {
  const order: string[] = [];
  await createKeyThenWritePoint(
    { code: "kvar", name: "Reactive" },
    async (body) => order.push(`key ${body.code}`),
    async () => order.push("point"),
  );
  expect(order).toEqual(["key kvar", "point"]);
}

// Catches: a 409 on the key treated as a refusal of the flow.
export async function aTakenCodeContinuesToThePoint(): Promise<void> {
  const writePoint = vi.fn().mockResolvedValue("point");
  const result = await createKeyThenWritePoint({ code: "kvar", name: "Reactive" }, () => Promise.reject(TAKEN), writePoint);
  expect([result, writePoint.mock.calls.length]).toEqual(["point", 1]);
}

// Catches: the point written after a create refused for another reason.
export async function aRefusedCreateWritesNoPoint(): Promise<void> {
  const writePoint = vi.fn();
  const outcome = await createKeyThenWritePoint({ code: "kvar", name: "Reactive" }, () => Promise.reject(REFUSED), writePoint).catch(
    (cause: unknown) => cause,
  );
  expect([outcome, writePoint.mock.calls.length]).toEqual([REFUSED, 0]);
}

// Catches: a point refusal after the key thrown bare, without the two-write sentence.
export async function aRefusedPointAfterTheKeyThrowsTheTwoWriteError(): Promise<void> {
  const outcome = await createKeyThenWritePoint(
    { code: "kvar", name: "Reactive" },
    async () => ({}),
    () => Promise.reject(REFUSED),
  ).catch((cause: unknown) => cause);
  expect(outcome instanceof KeyCreatedPointRefusedError ? outcome.pointCause : outcome).toBe(REFUSED);
}

const ASSET_A = { id: "a", code: "PMP-1" };
const ASSET_B = { id: "b", code: "PMP-2" };

// Catches: one asset's key list used for every asset in the batch.
export function theBatchCheckRefusesOnlyTheAssetThatLacksAReference(): void {
  const draft = {
    ...emptyCalcPointDraft("kvar"),
    formula: "{kw} * 2",
    calcIntervalSeconds: "300",
    maxInputAgeSeconds: "600",
  };
  const rows = new Map([
    ["a", [{ pointKey: "kw", sourceKind: "measured" as const }]],
    ["b", [{ pointKey: "pf", sourceKind: "measured" as const }]],
  ]);
  expect(batchFormulaRefusals([ASSET_A, ASSET_B], rows, draft).map((row) => row.assetCode)).toEqual(["PMP-2"]);
}

// Catches: a sentence that lets the author believe the key was created.
export function theBatchRefusalSentenceSaysNoKeyWasWritten(): void {
  expect(BATCH_FORMULA_NOT_CHECKED_CLEAN.startsWith("Nothing was written, not even the new key")).toBe(true);
}
