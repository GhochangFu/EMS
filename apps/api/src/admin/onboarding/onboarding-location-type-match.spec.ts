/**
 * `F4.162` (ADR 0077 Amendment 1, plan D9) — the two helpers that make a
 * location type which is not an active code count as missing.
 *
 * - `hasActiveLocationType` is the rule the chat's rule-based branch enters on
 *   and `resolveLocationTurn` keeps a stored type by: a stored type counts only
 *   when it is an active **code**.
 * - `assertPatchLocationTypeIsActive` is the `PATCH :id/draft` refusal. It asks
 *   the vocabulary only when the patch names a type, so a patch that repairs
 *   another field of a draft whose stored type was retired is still accepted.
 *
 * `OnboardingService.patchDraft` reads the database in `loadSession`, so it has
 * no unit seam; `tests/f4.162-location-type-write-path.test.ts` pins that it
 * calls the helper after `loadSession`.
 */
import { BadRequestException } from "@nestjs/common";

import type { LocationTypeDto } from "@bms/shared";

import {
  assertPatchLocationTypeIsActive,
  hasActiveLocationType,
  matchLocationType,
} from "./onboarding-location-type-match";
import type { OnboardingDraftInput } from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The four seeded rows of `bms.location_types`, in `sort_order`. */
const FOUR: readonly LocationTypeDto[] = [
  { code: "smoc_campus", label: "SMOC campus" },
  { code: "rsmoc", label: "RSMOC" },
  { code: "csmoc", label: "CSMOC" },
  { code: "pump_station", label: "Pump station" },
];

/** A stored location with `type`. */
function storedWith(type: string): NonNullable<OnboardingDraftInput["location"]> {
  return { name: "Lotapata", slug: "lotapata", code: "LOTAPATA", type, latitude: 22.3, longitude: 87.3 };
}

/** A vocabulary fake that counts its calls and refuses every code, as the real one refuses an unknown one. */
function countingVocabulary(): {
  vocabularies: { assertLocationType: (code: string) => Promise<void> };
  calls: string[];
  refusal: BadRequestException;
} {
  const calls: string[] = [];
  const refusal = new BadRequestException('Unknown location type code "nope". Valid codes: pump_station');
  return {
    calls,
    refusal,
    vocabularies: {
      assertLocationType: (code: string) => {
        calls.push(code);
        return Promise.reject(refusal);
      },
    },
  };
}

/** The error `run` rejected with, or `undefined` when it resolved. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
}

/** M1 — a stored type that is not an active code is not active. */
export function assertUnknownStoredTypeIsNotActive(): void {
  assert(
    hasActiveLocationType(storedWith("space_port"), FOUR) === false,
    "space_port is not one of the four codes",
  );
}

/** M1 — a stored active code is active; the rule compares codes, not labels. */
export function assertActiveStoredCodeIsActive(): void {
  assert(
    hasActiveLocationType(storedWith("pump_station"), FOUR) === true,
    "pump_station is one of the four codes",
  );
}

/** M2 — a patch naming a type asks the vocabulary about that type, once. */
export async function assertPatchNamingATypeIsChecked(): Promise<void> {
  const { vocabularies, calls } = countingVocabulary();
  await rejectionOf(assertPatchLocationTypeIsActive({ location: storedWith("nope") }, vocabularies));
  assert(
    JSON.stringify(calls) === JSON.stringify(["nope"]),
    `assertLocationType must be called once with "nope", got ${JSON.stringify(calls)}`,
  );
}

/** M2 — the vocabulary's refusal reaches the caller unchanged, so the PATCH is a 400 naming the codes. */
export async function assertPatchNamingAnInactiveTypeIsRefused(): Promise<void> {
  const { vocabularies, refusal } = countingVocabulary();
  const error = await rejectionOf(assertPatchLocationTypeIsActive({ location: storedWith("nope") }, vocabularies));
  assert(error === refusal, `the vocabulary's BadRequestException must be rethrown, got ${String(error)}`);
}

/** M3 — a patch whose location names no type asks nothing, so a draft with a retired type can still be repaired. */
export async function assertPatchLocationWithoutTypeIsNotChecked(): Promise<void> {
  const { vocabularies, calls } = countingVocabulary();
  const location: Partial<NonNullable<OnboardingDraftInput["location"]>> = storedWith("unused");
  delete location.type;
  await rejectionOf(assertPatchLocationTypeIsActive({ location } as OnboardingDraftInput, vocabularies));
  assert(calls.length === 0, `a patch without a type must make no call, got ${JSON.stringify(calls)}`);
}

/** M4 — a patch with no location asks nothing. */
export async function assertPatchWithoutLocationIsNotChecked(): Promise<void> {
  const { vocabularies, calls } = countingVocabulary();
  await rejectionOf(assertPatchLocationTypeIsActive({ rtus: [] }, vocabularies));
  assert(calls.length === 0, `a patch without a location must make no call, got ${JSON.stringify(calls)}`);
}

/**
 * `F2.10` (ADR 0098 ruling 14) — the eight active rows of `bms.location_types`
 * once migration `0103` has added its four, in `sort_order`.
 */
const EIGHT: readonly LocationTypeDto[] = [
  ...FOUR,
  { code: "campus", label: "Campus" },
  { code: "township", label: "Township" },
  { code: "building", label: "Building" },
  { code: "plant", label: "Plant" },
];

/** The code `message` resolves to against `EIGHT` is `expected`. */
function expectMatch(message: string, expected: string): void {
  const got = matchLocationType(message, EIGHT);
  assert(got === expected, `"${message}" must read as ${expected}, got ${String(got)}`);
}

/** M5 — "treatment plant" names the `plant` type. */
export function assertPlantIsMatched(): void {
  expectMatch("add the Thane treatment plant", "plant");
}

/** M5 — "campus" names `campus`, not `smoc_campus` (whose phrases need "smoc" too). */
export function assertCampusIsMatched(): void {
  expectMatch("a new campus at Hosur", "campus");
}

/** M5 — "township" names `township`; "pump house" is not "pump station". */
export function assertTownshipIsMatched(): void {
  expectMatch("the Ambernath township pump house", "township");
}

/** M5 — "Building 4" names `building`. */
export function assertBuildingIsMatched(): void {
  expectMatch("Building 4 at Patancheru", "building");
}

/**
 * M5 — the false match ruling 14 accepts: the verb "building" reads as the
 * type, and the user corrects it in the draft preview. Pinned so that a change
 * to the matcher which removes it is a decision, not an accident.
 */
export function assertTheAcceptedFalseMatchOnBuilding(): void {
  expectMatch("we are building a site", "building");
}

/** M5 — two types in one message: the longer phrase wins, so "pump station" beats "plant". */
export function assertTheLongerPhraseWins(): void {
  expectMatch("the pump station of the Thane plant", "pump_station");
}
