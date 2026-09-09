import { BadRequestException } from "@nestjs/common";

import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  COMMIT_UNIQUE_CONFLICTS,
  translateCommitUniqueConflict,
  type CommitUniqueConflict,
} from "./onboarding-commit-conflict";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/**
 * The nine constraints a commit can violate, listed here rather than read back
 * from the map — a set-equality assertion that derived both sides from the map
 * would be an identity and could not fail.
 *
 * `rtu_connection_configs_rtu_id_key` is the tenth constraint on the commit's
 * six inserts and is deliberately absent; the module header carries why it is
 * unreachable.
 */
const REACHABLE_CONSTRAINTS = [
  "asset_points_asset_id_point_key_unique",
  "asset_points_asset_source_key_idx",
  "assets_code_unique",
  "locations_org_code_idx",
  "locations_slug_unique",
  "point_keys_code_unique",
  "rtus_external_rtu_idx",
  "rtus_location_code_unique",
  "rtus_mqtt_topic_idx",
];

/**
 * The words that carry the cross-tenant inference, not only the obvious one.
 *
 * **This is a word list, not a semantic check, and reading it as one is the
 * §4.6 trap.** "already used by another site" leaks the same fact as "already
 * used in another organization" and a check for `organization` alone passes it,
 * which is why `another`, `other`, `elsewhere` and `tenant` are here too. A
 * sentence that leaks the inference in words none of these cover still passes;
 * what this gates is the class of edit that reaches for the obvious phrasing.
 */
const CROSS_TENANT_LEAK_WORDS = [
  "another",
  "other",
  "elsewhere",
  "tenant",
  "organization",
  "organisation",
  "someone else",
];

type DriverErrorFields = {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
  detail?: string;
};

/** A `node-postgres` 8.20 unique violation, measured live in `bms-api-1`. */
function pgUniqueViolation(constraint: string, overrides: DriverErrorFields = {}): unknown {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
    table: "locations",
    schema: "bms",
    detail: "Key (slug)=(rsmoc-eastern-cape) already exists.",
    ...overrides,
  });
}

/** The error a call refused with, or a failure if it did not refuse at all. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("commit resolved where it had to refuse");
}

/**
 * The refusal body as JSON, or a sentence naming what came back instead.
 *
 * Written as one expression so each case below spends exactly one `assert`:
 * `assert` throws, so a preceding `instanceof` assertion would be the only one
 * that ever reddens and the body claim would never be measured.
 */
function bodyOf(error: unknown): string {
  return error instanceof BadRequestException
    ? JSON.stringify(error.getResponse())
    : `not a BadRequestException: ${String(error)}`;
}

function expectedBody(conflict: CommitUniqueConflict): string {
  return JSON.stringify({
    formErrors: [],
    fieldErrors: { [conflict.field]: [conflict.message] },
  });
}

function conflictFor(constraint: string): CommitUniqueConflict {
  const conflict = COMMIT_UNIQUE_CONFLICTS.get(constraint);
  if (!conflict) {
    throw new Error(`${constraint} is not in COMMIT_UNIQUE_CONFLICTS`);
  }
  return conflict;
}

/** A draft that reaches the first insert: one location, no RTU, no asset. */
const LOCATION_ONLY_DRAFT: OnboardingDraft = {
  location: {
    code: "WC-1",
    slug: "wc-1",
    name: "Western Cape",
    type: "rsmoc",
    latitude: -33.9,
    longitude: 18.4,
  },
};

/**
 * `OnboardingCommitService` wired to reach the `locations` insert and fail it.
 *
 * Wider than `onboarding-commit-caps.spec.ts`'s harness on purpose: every case
 * there throws before `withTenant` opens, so it passes `{} as never` for
 * `tenantDb`. This one has to get *inside* the transaction, which is the only
 * place the defect exists — so `tenantDb.transaction` runs its callback and the
 * first `.returning()` rejects. The audit writer stays `{} as never`: reaching
 * it would mean the insert did not refuse, and a `TypeError` naming the missing
 * method is a clearer report than a stub that quietly accepts the call.
 */
function serviceFailingTheLocationInsert(err: unknown): OnboardingCommitService {
  const session = {
    id: "s-1",
    organizationId: "org-1",
    status: "draft",
    draft: LOCATION_ONLY_DRAFT,
  };
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([session]),
  };
  const fleetDb = { select: () => chain } as never;

  const tx = {
    execute: () => Promise.resolve(),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(err) }) }),
  };
  const tenantDb = {
    transaction: (fn: (inner: unknown) => Promise<unknown>) => fn(tx),
  } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;

  const validateService = {
    validate: () => ({
      valid: true,
      errors: [],
      readyToCommit: true,
      suggestedPhase: "review",
    }),
  } as never;

  const vocabularies = { assertAssetDomain: () => Promise.resolve() } as never;

  return new OnboardingCommitService(
    fleetDb,
    tenantDb,
    accessControl,
    {} as never,
    validateService,
    vocabularies,
  );
}

/**
 * `F4.109` — a duplicate value inside the commit transaction is answered as a
 * per-field 400, not as a 500.
 *
 * **This is the assertion the row exists for, and it is the only one here that
 * observes the service.** The map and its translation could be perfect and
 * every other case below green while `commit` still let the driver error reach
 * Nest's default handler — `onboarding-commit.service.ts` had no `onConflict`
 * and no `catch` at all, so `500 {"statusCode":500,"message":"Internal server
 * error"}` was the whole answer to a `location.code` an operator can simply
 * type twice.
 *
 * The mutation that reddens it is removing the `.catch` from `commit`, which
 * every map-only case below survives.
 *
 * The expected message is read from the map rather than restated: what this
 * case claims is that the refusal is wired and carries the mapped field, not
 * what the sentence says. `assertEveryMappedConstraintBecomesItsOwnFieldError`
 * is where the pairing itself is measured.
 */
export async function assertACommitCollisionIsAFieldErrorNotAServerFault(): Promise<void> {
  const service = serviceFailingTheLocationInsert(pgUniqueViolation("locations_org_code_idx"));
  const error = await rejectionOf(service.commit(JWT, "s-1"));
  assert(
    bodyOf(error) === expectedBody(conflictFor("locations_org_code_idx")),
    `a duplicate location code is a 400 naming the field, got ${bodyOf(error)}`,
  );
}

/**
 * `F4.109` — the map covers every unique constraint a commit can violate, and
 * covers nothing it cannot.
 *
 * Owner ruling 2 asks for one map read by one catch. The failure this pins is
 * the quiet one: a tenth entry added without a reachability argument, or one of
 * the nine dropped by a refactor, both of which leave every other case here
 * green because each of those tests only the entries that exist.
 */
export function assertTheMapCoversEveryReachableUniqueConstraint(): void {
  const mapped = [...COMMIT_UNIQUE_CONFLICTS.keys()].sort();
  assert(
    JSON.stringify(mapped) === JSON.stringify(REACHABLE_CONSTRAINTS),
    `the map holds exactly the nine reachable constraints, got ${JSON.stringify(mapped)}`,
  );
}

/**
 * `F4.109` — every mapped constraint answers with **its own** field and **its
 * own** sentence.
 *
 * One map entry wired to the right field proves nothing about the other eight.
 * The mutation is a translation that ignores the entry it just looked up —
 * hard-coding `location`, or the first entry's message — which leaves the
 * wiring case above green because that case *is* the location one.
 */
export function assertEveryMappedConstraintBecomesItsOwnFieldError(): void {
  const wrong: string[] = [];
  for (const [constraint, conflict] of COMMIT_UNIQUE_CONFLICTS) {
    const body = bodyOf(translateCommitUniqueConflict(pgUniqueViolation(constraint)));
    if (body !== expectedBody(conflict)) {
      wrong.push(`${constraint}: expected ${expectedBody(conflict)}, got ${body}`);
    }
  }
  assert(wrong.length === 0, `each constraint answers with its own field: ${wrong.join(" | ")}`);
}

/**
 * `F4.109` — a refusal from a constraint with no `organization_id` in its key
 * never implies that another organization exists.
 *
 * The cross-tenant case is real and was reproduced against the deployment: an
 * insert for PHEWB was refused by a slug ESKOM holds. "That slug is already
 * taken" is what such a caller may be told; naming a second tenant — even
 * anonymously — turns a duplicate into a disclosure that one exists.
 *
 * **Five entries carry `scope: "global"`, not the four the row's brief states**
 * and not the three its table marks: `rtus_external_rtu_idx` and
 * `rtus_mqtt_topic_idx` are unique on one bare column (migration `0016` lines
 * 65 and 67) and refuse across organizations exactly as `locations_slug_unique`
 * does.
 *
 * Read the word list's own docblock before trusting this: it gates a class of
 * phrasing, not the semantics.
 */
export function assertACrossTenantMessageNeverImpliesAnotherOrganization(): void {
  const leaks: string[] = [];
  for (const [constraint, conflict] of COMMIT_UNIQUE_CONFLICTS) {
    if (conflict.scope !== "global") {
      continue;
    }
    const body = bodyOf(translateCommitUniqueConflict(pgUniqueViolation(constraint))).toLowerCase();
    for (const word of CROSS_TENANT_LEAK_WORDS) {
      if (body.includes(word)) {
        leaks.push(`${constraint} says "${word}"`);
      }
    }
  }
  assert(leaks.length === 0, `a global constraint must not imply a second tenant: ${leaks.join(", ")}`);
}

/**
 * `F4.109` / §4.3 — no part of the driver's error reaches the client.
 *
 * `err.detail` is the dangerous one — `Key (slug)=(rsmoc-eastern-cape) already
 * exists.` echoes a value that, on the five global constraints, belongs to a
 * row in an organization the caller cannot see. `table`, `schema` and the
 * driver's own message are checked beside it because a later edit reaching for
 * "a more helpful message" reaches for whichever of the four is nearest.
 *
 * Four sentinels, one per field, and the failure names which leaked — this is a
 * runtime check on the rendered body, not a source scan, so the blanking rule
 * for a comment or a string literal does not apply.
 */
export function assertNothingFromTheDriverErrorReachesTheClient(): void {
  const sentinels = {
    detail: "SENTINEL-DETAIL-Key-(slug)=(rsmoc-eastern-cape)",
    table: "SENTINEL-TABLE-locations",
    schema: "SENTINEL-SCHEMA-bms",
    message: "SENTINEL-MESSAGE-duplicate-key-value",
  };
  const leaked: string[] = [];
  for (const constraint of COMMIT_UNIQUE_CONFLICTS.keys()) {
    const err = Object.assign(new Error(sentinels.message), {
      code: "23505",
      constraint,
      table: sentinels.table,
      schema: sentinels.schema,
      detail: sentinels.detail,
    });
    const body = bodyOf(translateCommitUniqueConflict(err));
    for (const [field, sentinel] of Object.entries(sentinels)) {
      if (body.includes(sentinel)) {
        leaked.push(`${constraint} echoed ${field}`);
      }
    }
  }
  assert(leaked.length === 0, `the driver's error must not reach the client: ${leaked.join(", ")}`);
}

/**
 * `F4.109` — an error carrying a mapped constraint name but **no** SQLSTATE is
 * returned unchanged.
 *
 * `asset-templates-instantiate.service.ts:864` branches on the constraint name
 * alone, and that is the weaker pattern this case exists to keep out of here:
 * `constraint` is not a `23505` field. Dropping the `code === "23505"` test
 * reddens this, and every other case in this file stays green because they all
 * supply a real `23505`.
 */
export function assertAMappedConstraintWithoutASqlstatePassesThrough(): void {
  const err = Object.assign(new Error("something else entirely"), {
    constraint: "assets_code_unique",
  });
  assert(
    translateCommitUniqueConflict(err) === err,
    `an error with no SQLSTATE passes through as itself, got ${bodyOf(translateCommitUniqueConflict(err))}`,
  );
}

/**
 * `F4.109` — a different SQLSTATE on a mapped constraint name is returned
 * unchanged.
 *
 * `23503` is a foreign-key violation and it sets `constraint` too. Describing
 * one as a duplicate value would send the operator to change a code that is
 * not the problem. The mutation is relaxing the test to a prefix —
 * `String(code).startsWith("23")` — which admits every integrity violation.
 */
export function assertADifferentSqlstatePassesThrough(): void {
  const err = Object.assign(new Error("insert violates foreign key constraint"), {
    code: "23503",
    constraint: "assets_code_unique",
  });
  assert(
    translateCommitUniqueConflict(err) === err,
    `a 23503 passes through as itself, got ${bodyOf(translateCommitUniqueConflict(err))}`,
  );
}

/**
 * `F4.109` — a `23505` on a constraint the map does not hold falls through to
 * the 500 it answers today.
 *
 * This is the half of ruling 2 that is easy to lose: a fallback entry for an
 * unknown constraint would let a future table's collision be described with a
 * field name invented for it. `audit_log` is written by the same transaction
 * and is not in the map, so the case is not hypothetical.
 */
export function assertAnUnmappedConstraintPassesThrough(): void {
  const err = pgUniqueViolation("audit_log_pkey");
  assert(
    translateCommitUniqueConflict(err) === err,
    `an unmapped constraint passes through as itself, got ${bodyOf(translateCommitUniqueConflict(err))}`,
  );
}
