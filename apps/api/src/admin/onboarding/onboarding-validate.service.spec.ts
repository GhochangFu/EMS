/**
 * `F4.157` / ADR 0077 decision 7 — a draft may hold a location without a type
 * (owner ruling OQ2), and the validator is what keeps that draft from
 * committing and keeps the chat asking for the type.
 *
 * The draft schema cannot do either: `type` is `.optional()` there on purpose,
 * so the chat can store the name in one turn and the type in the next. The
 * cross-field error and the phase are the two places the absence is caught.
 */
import type { OnboardingDraft } from "@bms/shared";

import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The four seeded active codes of `bms.location_types`, in `sort_order`.
 * `F4.162` (plan D9): the validator takes the active codes as a required
 * argument, so a type retired after it was stored is caught here too.
 */
const CODES: readonly string[] = ["smoc_campus", "rsmoc", "csmoc", "pump_station"];

/** A draft complete in every section, so the location type is the only gap. */
function completeDraft(type: string | undefined): OnboardingDraft {
  return {
    location: {
      name: "Lotapata",
      slug: "lotapata",
      code: "LOTAPATA",
      ...(type === undefined ? {} : { type }),
      latitude: 22.3,
      longitude: 87.3,
    },
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "modbus_tcp",
        config: { host: "10.0.0.1", port: 502 },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    pointKeys: [{ code: "kw", name: "Active Power", domain: "electrical", unit: "kW" }],
    assets: [
      { code: "LOTAPATA-ASSET-1", name: "Asset 1", siteName: "Lotapata", rtuIndex: 0, domain: "electrical" },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: "s01" }],
  } as OnboardingDraft;
}

/** N1 — a location with no type is a `location.type` error, and the draft cannot commit. */
export function assertMissingLocationTypeIsAnError(): void {
  const result = new OnboardingValidateService().validate(completeDraft(undefined), CODES);
  const paths = result.errors.map((error) => error.path);
  assert(
    paths.includes("location.type"),
    `a location with no type must carry an error at location.type, got ${JSON.stringify(paths)}`,
  );
  assert(result.readyToCommit === false, "a location with no type must never be ready to commit");
}

/**
 * The positive control for N1: the same draft with a type is clean, so the
 * error above comes from the missing type and not from some other gap in the
 * fixture.
 *
 * `F4.162` N5: this is also the positive control for N3 — the type is an
 * active code, so the draft is ready — and it is what reddens a caller that
 * hands the validator `[]` instead of the active codes.
 */
export function assertTypedLocationIsReadyToCommit(): void {
  const result = new OnboardingValidateService().validate(completeDraft("pump_station"), CODES);
  assert(
    result.errors.length === 0,
    `the fixture with a type must be clean, got ${JSON.stringify(result.errors)}`,
  );
  assert(result.readyToCommit === true, "the fixture with a type must be ready to commit");
}

/** N2 — while the type is missing, the phase stays `location`, so the chat asks for it. */
export function assertMissingLocationTypeKeepsTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft(undefined), CODES);
  assert(phase === "location", `a location with no type must stay in the location phase, got ${phase}`);
}

/** The positive control for N2: with a type, the same draft infers `review`. */
export function assertTypedLocationLeavesTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft("pump_station"), CODES);
  assert(phase === "review", `the fixture with a type must reach review, got ${phase}`);
}

/**
 * N3 — a type that is set and not an active code is a `location.type` error
 * whose message names every active code, so the operator is told what to pick.
 * `F4.162` (plan D9, owner ruling OQ3): a type retired after it was stored.
 */
export function assertInactiveLocationTypeIsAnErrorNamingTheCodes(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES);
  const errors = result.errors.filter((error) => error.path === "location.type");
  assert(errors.length === 1, `an inactive type must carry one error at location.type, got ${JSON.stringify(result.errors)}`);
  for (const code of CODES) {
    assert(errors[0].message.includes(code), `the message must name ${code}, got "${errors[0].message}"`);
  }
}

/**
 * N3 — the message never echoes the stored value. It is operator text from a
 * workbook cell or a `PATCH` body; the codes are what the operator can use.
 */
export function assertInactiveLocationTypeMessageDoesNotEchoTheValue(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES);
  const error = result.errors.find((candidate) => candidate.path === "location.type");
  const message = error?.message ?? "";
  assert(error !== undefined, `the positive half: an error at location.type exists, got ${JSON.stringify(result.errors)}`);
  assert(!message.includes("space_port"), `the message must not echo the stored value, got "${message}"`);
}

/**
 * N3 — the draft is not ready to commit. Two guards hold this claim: the
 * `location.type` error and the location phase (N4). Only both removed
 * redden it.
 */
export function assertInactiveLocationTypeIsNotReadyToCommit(): void {
  const result = new OnboardingValidateService().validate(completeDraft("space_port"), CODES);
  assert(result.readyToCommit === false, "a draft whose type is not active must never be ready to commit");
}

/** N4 — an inactive type keeps the phase at `location`, so the chat asks for the type again. */
export function assertInactiveLocationTypeKeepsTheLocationPhase(): void {
  const phase = new OnboardingValidateService().inferPhase(completeDraft("space_port"), CODES);
  assert(phase === "location", `an inactive type must stay in the location phase, got ${phase}`);
}
