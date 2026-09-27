import { ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import {
  RTU_CODE_TAKEN_MESSAGE,
  RTU_EXTERNAL_ID_TAKEN_MESSAGE,
  RTU_LOCATION_CODE_TAKEN_MESSAGE,
  RTU_MQTT_TOPIC_TAKEN_MESSAGE,
  RTU_UNIQUE_CONFLICTS,
  translateRtuUniqueConflict,
} from "./rtus-conflict";

/**
 * `F4.60` / `F4.141` — assertions for the translation of the four `bms.rtus`
 * unique constraints (ADR 0014: the assertions live here, the Vitest blocks
 * live in the sibling `.test.ts`).
 *
 * Pure-function claims only. That the driver actually raises `23505` with these
 * constraint names, that a rollback preserves the object, and that `update`
 * restating an unchanged `rtu_code` does not self-collide are database
 * behaviours, and they are gated in `rtus.unique-conflict.integration.spec.ts`.
 */

/**
 * The constraint names as **independent literals**, deliberately not imported
 * from the module under test.
 *
 * The plan for `F4.60` predicted that renaming the constant to
 * `rtus_rtucode_idx` would keep this spec green and be caught only at the
 * integration layer. That is true of a spec that derives the name from the
 * implementation, and it is exactly why this one does not: each name is a
 * contract with a migration (`0016` for three, `0071` for `rtus_rtu_code_idx`),
 * so the spec states them the same way `onboarding-commit-conflict.spec.ts`
 * states its ten — as strings at the call site.
 */
const LIVE_INDEX_NAME = "rtus_rtu_code_idx";
const EXTERNAL_RTU_INDEX_NAME = "rtus_external_rtu_idx";
const MQTT_TOPIC_INDEX_NAME = "rtus_mqtt_topic_idx";
const LOCATION_CODE_CONSTRAINT_NAME = "rtus_location_code_unique";

/** Every `bms.rtus` unique constraint a caller of the admin routes can reach, sorted. */
const REACHABLE_CONSTRAINTS = [
  "rtus_external_rtu_idx",
  "rtus_location_code_unique",
  "rtus_mqtt_topic_idx",
  "rtus_rtu_code_idx",
];

/**
 * The constraints whose key has no `location_id` — fleet-wide, so the colliding
 * row may belong to another tenant. Sorted. Stated independently of the map's
 * `scope` field, which is what `assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing`
 * checks the map against.
 */
const GLOBAL_CONSTRAINTS = ["rtus_external_rtu_idx", "rtus_mqtt_topic_idx", "rtus_rtu_code_idx"];

/**
 * The owner-ruled sentences, verbatim (2026-09-27 for the three `F4.141` ones).
 *
 * Literals, not the exported constants: equality against a constant the module
 * also exports holds nothing about the wording, since an edit to the constant
 * moves both sides. These are what the owner approved.
 */
const RULED_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    "rtus_rtu_code_idx",
    "That rtuCode is already taken. It is the device key the ingest host routes by, " +
      "so two RTUs cannot share one. Choose a different rtuCode.",
  ],
  [
    "rtus_external_rtu_idx",
    "That externalRtuId is already taken. Choose a different externalRtuId.",
  ],
  ["rtus_mqtt_topic_idx", "That mqttTopic is already taken. Choose a different mqttTopic."],
  [
    "rtus_location_code_unique",
    "Another RTU at this location already uses that code. Choose a different code.",
  ],
]);

type DriverErrorFields = {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
  detail?: string;
};

/**
 * A `node-postgres` 8.20 unique violation, in the shape
 * `onboarding-commit-conflict.spec.ts`'s own `pgUniqueViolation` builds.
 *
 * The default `detail` is **more than the production path can produce** — see
 * the module docblock's two-role probe: under `bms_tenant` and `bms_owner` a
 * real duplicate carries no `DETAIL` at all. A pure function must not be
 * excused by the server having withheld its input, so the field is supplied
 * here on purpose.
 */
function pgUniqueViolation(constraint: string, overrides: DriverErrorFields = {}): unknown {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
    table: "rtus",
    schema: "bms",
    detail: "Key (rtu_code)=(f4.60-dcode) already exists.",
    ...overrides,
  });
}

/** The message the translation produced, or a failure naming what came back instead. */
function messageOf(translated: unknown): string {
  expect(translated).toBeInstanceOf(ConflictException);
  return (translated as ConflictException).message;
}

/**
 * `F4.141` — the map holds exactly the four authored constraint names.
 *
 * **"Authored", not "reachable"**, for the reason
 * `onboarding-commit-conflict.spec.ts`'s `assertTheMapMatchesTheAuthoredReachableList`
 * records: both sides are source in this repository. A migration that adds a
 * fifth unique to `bms.rtus` reddens nothing here and answers 500 until the
 * census is re-run by hand. What this pins is a dropped entry, or a fifth added
 * without a reachability argument.
 */
export function assertTheMapHoldsExactlyTheFourAuthoredConstraints(): void {
  expect([...RTU_UNIQUE_CONFLICTS.keys()].sort()).toEqual(REACHABLE_CONSTRAINTS);
}

/**
 * The mapped case: a `23505` naming this index becomes the ruled 409.
 *
 * `toBe` on the message rather than `toContain`, so appending a sentence to the
 * refusal — the way a leak arrives — reddens this.
 */
export function assertADuplicateRtuCodeBecomesTheRuledConflict(): void {
  const translated = translateRtuUniqueConflict(pgUniqueViolation(LIVE_INDEX_NAME));
  expect(translated).toBeInstanceOf(ConflictException);
  expect((translated as ConflictException).message).toBe(RTU_CODE_TAKEN_MESSAGE);
}

/** `F4.141` — a duplicate `external_rtu_id` becomes the ruled 409, in the ruled words. */
export function assertADuplicateExternalRtuIdBecomesTheRuledConflict(): void {
  const message = messageOf(
    translateRtuUniqueConflict(pgUniqueViolation(EXTERNAL_RTU_INDEX_NAME)),
  );
  expect(message).toBe("That externalRtuId is already taken. Choose a different externalRtuId.");
  expect(message).toBe(RTU_EXTERNAL_ID_TAKEN_MESSAGE);
}

/** `F4.141` — a duplicate `mqtt_topic` becomes the ruled 409, in the ruled words. */
export function assertADuplicateMqttTopicBecomesTheRuledConflict(): void {
  const message = messageOf(translateRtuUniqueConflict(pgUniqueViolation(MQTT_TOPIC_INDEX_NAME)));
  expect(message).toBe("That mqttTopic is already taken. Choose a different mqttTopic.");
  expect(message).toBe(RTU_MQTT_TOPIC_TAKEN_MESSAGE);
}

/** `F4.141` — a duplicate `(location_id, code)` becomes the ruled 409, in the ruled words. */
export function assertADuplicateLocationCodeBecomesTheRuledConflict(): void {
  const message = messageOf(
    translateRtuUniqueConflict(pgUniqueViolation(LOCATION_CODE_CONSTRAINT_NAME)),
  );
  expect(message).toBe(
    "Another RTU at this location already uses that code. Choose a different code.",
  );
  expect(message).toBe(RTU_LOCATION_CODE_TAKEN_MESSAGE);
}

/**
 * `F4.141` — every mapped constraint answers with **its own** sentence.
 *
 * One entry wired right proves nothing about the other three. The mutation is a
 * translation that ignores the entry it looked up — every entry answering the
 * `rtuCode` sentence — which leaves `assertADuplicateRtuCodeBecomesTheRuledConflict`
 * green because that case *is* the `rtuCode` one.
 *
 * The expected side is `RULED_MESSAGES`, an independent literal table, never
 * `entry.message`: a loop that compared the translation against the map's own
 * value would stay green under exactly that mutation.
 */
export function assertEveryMappedConstraintAnswersItsOwnMessage(): void {
  const wrong: string[] = [];
  for (const constraint of REACHABLE_CONSTRAINTS) {
    const translated = translateRtuUniqueConflict(pgUniqueViolation(constraint));
    const got = translated instanceof ConflictException ? translated.message : String(translated);
    if (got !== RULED_MESSAGES.get(constraint)) {
      wrong.push(`${constraint}: ${got}`);
    }
  }
  expect(wrong).toEqual([]);
}

/**
 * Another constraint's `23505` is returned **unchanged**, by identity.
 *
 * `assets_code_unique` is not hypothetical: `AssetTemplatesInstantiateService`
 * translates it into its own 409, and `onboarding-commit-conflict.ts` into a
 * 400. If this function claimed it too, whichever route ran last would decide
 * what an asset-code collision says.
 *
 * `toBe`, not `toEqual` — the point is that the original object survives with
 * its stack and its `cause`, which a structurally equal copy would not prove.
 */
export function assertAnotherConstraintsDuplicateIsReturnedUnchanged(): void {
  const err = pgUniqueViolation("assets_code_unique");
  expect(translateRtuUniqueConflict(err)).toBe(err);
}

/**
 * The second axis: a mapped index name on a **foreign-key** violation is not a
 * duplicate.
 *
 * `23503` sets `constraint` too. `translateAssetCodeCollision` branches on the
 * name alone and would call this a taken `rtuCode`; this function tests the
 * SQLSTATE as well, and that difference is the whole reason for the narrower
 * shape. Contrived as a driver error — Postgres does not name a unique index on
 * a `23503` — and that is the point: the guard must hold on the input, not on a
 * belief about what the server sends.
 */
export function assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged(): void {
  const err = pgUniqueViolation(LIVE_INDEX_NAME, { code: "23503" });
  expect(translateRtuUniqueConflict(err)).toBe(err);
}

/**
 * A non-object rejection survives.
 *
 * `undefined` and a bare string are what a dropped connection, an `abort` or a
 * `throw "boom"` upstream can put through the same `.catch`. Narrowing that read
 * `err.code` off a primitive would throw a `TypeError` from inside the error
 * path and replace a real failure with a confusing one.
 */
export function assertANonObjectRejectionIsReturnedUnchanged(): void {
  expect(translateRtuUniqueConflict(undefined)).toBe(undefined);
  expect(translateRtuUniqueConflict("boom")).toBe("boom");
}

/**
 * §4.3 — nothing the driver supplied reaches the client, for any of the four.
 *
 * `detail` is the dangerous field: it echoes the value the caller sent, which on
 * a fleet-wide index is equal to one in a row the caller may not be allowed to
 * know exists.
 *
 * **The positive control is per entry and it is not decoration.**
 * `JSON.stringify` of an `HttpException` depends on which properties are own and
 * enumerable; if it rendered `{}` the absence checks would pass against an
 * implementation that spliced `err.detail` straight into the sentence. Proving
 * the entry's *own* ruled sentence is in the serialised form first is what
 * makes the absence mean something — a shared phrase such as "already taken"
 * would not do, because the location sentence does not contain it.
 */
export function assertNothingFromTheDriverErrorReachesTheClient(): void {
  const problems: string[] = [];
  for (const constraint of REACHABLE_CONSTRAINTS) {
    const translated = translateRtuUniqueConflict(
      pgUniqueViolation(constraint, {
        detail: "Key (rtu_code)=(F460SENTINEL) already exists.",
      }),
    );
    if (!(translated instanceof ConflictException)) {
      problems.push(`${constraint}: not a ConflictException`);
      continue;
    }
    // The body Nest writes, plus the exception's own message — the two surfaces a
    // splice would land on. `stack` is deliberately excluded: it never reaches the
    // client, and its file paths would make the `detail` scan answer about the
    // wrong thing.
    const wire = JSON.stringify({
      response: translated.getResponse(),
      message: translated.message,
    });
    const ruled = RULED_MESSAGES.get(constraint) ?? "<no ruled message>";
    if (!wire.includes(ruled)) {
      problems.push(`${constraint}: the wire form lacks its own ruled sentence`);
    }
    if (wire.includes("F460SENTINEL")) {
      problems.push(`${constraint}: the driver's value reached the wire`);
    }
    if (wire.includes("detail")) {
      problems.push(`${constraint}: the word "detail" reached the wire`);
    }
  }
  expect(problems).toEqual([]);
}

/**
 * The words `onboarding-commit-conflict.spec.ts` forbids a fleet-wide refusal
 * from using.
 *
 * **Restated, not imported** — the original `CROSS_TENANT_LOCUS_WORDS`
 * in `onboarding-commit-conflict.spec.ts` is a module-private `const`, and that
 * file belongs to another unit, so exporting it is not this unit's edit to
 * make. Copied verbatim from that list on 2026-09-12; if the two drift, the
 * original is the authority.
 */
const CROSS_TENANT_LOCUS_WORDS = [
  "another",
  "other",
  "elsewhere",
  "tenant",
  "organization",
  "organisation",
  "someone else",
  "site",
  "owner",
  "customer",
  "belongs",
];

/**
 * No **global** refusal says where the taken row lives.
 *
 * The three global keys have no `organization_id`, so they refuse across
 * organizations. "That rtuCode is already taken" is what such a caller may be
 * told; naming a second tenant — even anonymously — turns a duplicate into the
 * disclosure that one exists.
 *
 * `rtus_location_code_unique` is skipped, and on purpose: its key includes
 * `location_id`, the caller manages that location on both write paths, and its
 * ruled sentence says "another RTU at this location" — which discloses nothing
 * and contains "another". **The first expectation is what makes that skip
 * safe**: it pins the set the scan covers to exactly the three global names, so
 * a global entry re-scoped to `"location"` (dropping out of the scan) or the
 * location entry re-scoped to `"global"` both redden it.
 *
 * **Named for what it measures.** The mutation it catches is a message that says
 * "already used in another organization"; what reddens is a word match, so a
 * phrasing that leaks the same inference in other words is not covered. The
 * semantic rule is held by review. Do not read a green run here as that rule
 * having been checked.
 */
export function assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing(): void {
  const scanned = [...RTU_UNIQUE_CONFLICTS.entries()]
    .filter(([, entry]) => entry.scope === "global")
    .map(([constraint]) => constraint)
    .sort();
  expect(scanned).toEqual(GLOBAL_CONSTRAINTS);

  const problems: string[] = [];
  for (const constraint of scanned) {
    const body = messageOf(translateRtuUniqueConflict(pgUniqueViolation(constraint))).toLowerCase();
    // The positive control: a message that had been emptied would pass the scan.
    if (!body.includes("already taken")) {
      problems.push(`${constraint}: no "already taken" in the message`);
    }
    for (const word of CROSS_TENANT_LOCUS_WORDS) {
      if (body.includes(word)) {
        problems.push(`${constraint}: "${word}"`);
      }
    }
  }
  expect(problems).toEqual([]);
}
