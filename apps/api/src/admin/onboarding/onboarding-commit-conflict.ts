/**
 * `F4.109` — the one map from a unique-constraint name to the refusal an
 * onboarding commit answers with, and the narrow translation that reads it.
 *
 * ## What it fixes
 *
 * `onboarding-commit.service.ts` contains **no** `onConflict` anywhere. Every
 * insert writes the draft's value verbatim, so a duplicate raised `23505`,
 * reached Nest's default handler and became
 * `500 {"statusCode":500,"message":"Internal server error"}`. Two things are
 * wrong with that, the same two `F4.108` recorded for a malformed id: a 500 is
 * recorded as a *server* fault, so an operator's typo pollutes whatever watches
 * for real ones; and the operator cannot tell which value to change.
 *
 * The row was filed as "a truncated `location.code` can still collide" and
 * asked for a hash suffix on `location.code`. **That framing is too narrow and
 * the owner superseded it.** `draftLocationSchema` *requires* `code`, so an
 * operator — or the model — can simply supply a code that already exists;
 * truncation is one narrow way into a hole that is open by typing. So the three
 * derivation sites in `onboarding-chat.service.ts` are unchanged and the
 * conflict is answered here, where every constraint reaches, not only the one.
 *
 * ## Why the message is built from the constraint name alone
 *
 * **This paragraph was rewritten twice, and both corrections were measurements.**
 * The first draft said `err.detail` carries a value belonging to a row in an
 * organization the caller cannot see. Postgres in fact builds `detail` from the
 * key of the tuple being *inserted*, so the value is the caller's own — equal to
 * the colliding row's on those columns, because that equality is why it
 * collided, but not read out of that row. The second draft said that value
 * reaches this function. **On nine of the ten constraints it does not reach it
 * at all.**
 *
 * `BuildIndexValueDescription` returns NULL when RLS is enabled on the relation,
 * so the server omits the key description before it ever reaches the wire.
 * Probed live, same INSERT and same server, two roles:
 *
 * - as `bms_owner`, which `FORCE ROW LEVEL SECURITY` binds — `err.detail` is
 *   `undefined`. `code`, `constraint`, `table` and `schema` all arrive; only the
 *   value is gone. (This bullet used to say `bms_owner` is "the role the API
 *   connects as". It is not: `commit` runs inside `withTenant(this.tenantDb, …)`
 *   and therefore connects as **`bms_tenant`**, which is `rolbypassrls = f` and
 *   is bound by the same policy. `F4.60` measured `bms_tenant` directly and it
 *   withholds `detail` exactly as `bms_owner` does, so the conclusion this
 *   paragraph draws is unchanged — but the role named in it was wrong, and the
 *   whole §4.3 argument below rests on which role the server withholds from.)
 * - as `bms_fleet`, which holds `BYPASSRLS`, the same insert yields
 *   `Key (organization_id, code)=(1ddf7041-…, RSMOC-EC) already exists.`
 *
 * The exception is `bms.point_keys`, whose RLS migration `0057` dropped
 * entirely. There `bms_owner` does receive `Key (code)=(CALCWRITE_A) already
 * exists.` So `point_keys_code_unique` is the **one** mapped constraint on which
 * the no-echo rule is load-bearing rather than belt-and-braces, and it is the
 * one already reachable only as a race.
 *
 * `F4.60`'s `rtus_rtu_code_idx` joins the silent majority, and that was measured
 * on the same server rather than assumed from the pattern: as `bms_tenant` — the
 * role `withTenant` actually connects as — and as `bms_owner`, a duplicate
 * `rtu_code` yields `code`, `constraint`, `table` and `schema` with **no `DETAIL`
 * line emitted at all**; as `bms_fleet` the same insert yields
 * `Key (rtu_code)=(f4.60-dcode) already exists.` `bms.rtus` keeps its policy, so
 * `BuildIndexValueDescription` returns NULL exactly as it does for the other
 * eight.
 *
 * Passing nothing on is right either way, and neither correction weakens it.
 * §4.3 forbids echoing the input back in a refusal, and `detail` is the input.
 * What a refusal built from `detail` would disclose is not a foreign *value* but
 * the *existence* of a colliding row — which, on a constraint with no
 * `organization_id` in its key, is a row in an organization the caller cannot
 * see. Measured live: an insert for PHEWB was refused by a slug ESKOM holds. So
 * nothing from the driver is passed on: not `detail`, not `table`, not `schema`,
 * not the driver's own message. The unit spec's sentinels supply a `detail` the
 * production path mostly cannot produce, on purpose — a pure function must not
 * depend on the server having withheld it.
 *
 * `scope` is what decides the wording, and it is a field rather than a habit
 * because the wording rule differs by scope:
 *
 * - `"global"` — the row that refused this write may belong to another tenant,
 *   so the message must not imply that another organization exists at all.
 *   "That slug is already taken" is admissible; "already used in another
 *   organization" is not.
 * - `"tenant"` — the colliding row is one the caller can see (its own
 *   organization, or a second element of the very draft being committed), so
 *   the message may say so.
 *
 * **Nothing here logs.** §9.6 would allow the constraint name and nothing else,
 * and a pure function with no logger is one fewer place for `detail` to be
 * added later by someone who reads a `Logger` field as an invitation.
 *
 * ## The eleven constraints, and the one that is not here
 *
 * Measured from `pg_constraint` and `pg_indexes`, a commit's six *draft-derived*
 * inserts sit under eleven unique constraints. Six is the count of inserts that
 * write a value the draft supplied; the transaction runs two more — the
 * `audit.write(…, tx)` calls at `onboarding-commit.service.ts:423` and `:441` —
 * and neither can collide, because every column they key on is a
 * `defaultRandom()` primary key. **Ten of the eleven are mapped. The eleventh,
 * `rtu_connection_configs_rtu_id_key` `(rtu_id)`, is unreachable from this
 * path** and is deliberately absent rather than mapped for symmetry:
 * `onboarding-commit.service.ts:320` is the only write to that table in the
 * transaction, it inserts exactly one row per loop iteration, and the `rtuId`
 * it uses is the `id` the `rtus` insert on the line above just returned from
 * `defaultRandom()`. Two iterations cannot share one, and no pre-existing row
 * can reference an RTU created moments earlier inside an uncommitted
 * transaction. An entry for it would be a mapping no mutation could redden.
 *
 * That name will not be found by grepping this repository, which is the usual
 * reason a reader doubts a paragraph like this one. Postgres generated it: the
 * column is declared inline as `rtu_id uuid NOT NULL UNIQUE …` at
 * `packages/db/drizzle/0019_onboarding_credentials.sql:22`, and an inline
 * `UNIQUE` is named `<table>_<column>_key` by the server. It was probed live to
 * confirm the constraint exists and fires under a duplicate `rtu_id`.
 *
 * Reachability of the ten, stated per constraint because the brief asked for
 * it rather than for a list copied across:
 *
 * - `locations_org_code_idx`, `locations_slug_unique` — the draft supplies both
 *   `code` and `slug` and nothing pre-checks either. Reachable by typing.
 * - `assets_code_unique` — same; `OnboardingValidateService` is a pure
 *   synchronous check with no database read, so no asset code is pre-checked.
 * - `rtus_external_rtu_idx`, `rtus_mqtt_topic_idx` — partial unique indexes on
 *   a bare column (`WHERE … IS NOT NULL`), fed straight from `rtus[].config`
 *   and `rtus[].externalRtuId`.
 * - `rtus_location_code_unique` — the location is created by this same
 *   transaction, so no pre-existing RTU shares its id; what reaches this is two
 *   RTUs in one draft with one code.
 * - `rtus_rtu_code_idx` — `F4.60`, migration `0071`. A partial unique index on a
 *   bare column (`WHERE rtu_code IS NOT NULL AND rtu_code <> ''`), fed straight
 *   from `rtus[].rtuCode`, which `onboarding.schema.ts:91` accepts as free text
 *   with no database read behind it. Reachable **two** ways where the three
 *   above are reachable one: two RTUs in one draft carrying one `rtuCode`, and a
 *   draft whose `rtuCode` an RTU outside this transaction already holds — the
 *   fresh-`location_id` argument that narrows `rtus_location_code_unique` does
 *   not apply, because this key does not mention the location.
 * - `asset_points_asset_id_point_key_unique`,
 *   `asset_points_asset_source_key_idx` — likewise `asset_id` is fresh, so what
 *   reaches these is two points on one draft asset.
 * - `point_keys_code_unique` — the loop at `:250` reads the catalog by `code`
 *   first and reuses the row, and migration `0057` dropped this table's RLS
 *   entirely, so that read is blind to nothing. What is left is the race: a
 *   concurrent commit whose insert is invisible under READ COMMITTED until it
 *   commits. The message says so.
 *
 * **Six of the ten are cross-tenant** — five when this paragraph was first
 * written, and `F4.60` adds the sixth. `rtus_external_rtu_idx` and
 * `rtus_mqtt_topic_idx` are unique on one bare column with no `organization_id`
 * in the key — migration `0016` lines 65 and 67 — so they refuse across
 * organizations exactly as `locations_slug_unique` does, and they carry
 * `scope: "global"`. `rtus_rtu_code_idx` (migration `0071`) is the same shape
 * for the same reason, and the reason is written down rather than inherited:
 * `BINDING_QUERY` in `apps/ingest/src/host/bindings.ts` selects across the whole
 * fleet with no `organization_id` filter, so a key scoped per organization would
 * not have closed the defect `F4.60` exists to close.
 *
 * Re-measured from `pg_constraint` and `pg_indexes` on 2026-09-12 after `0071`
 * applied, rather than incremented: the six tables carry 17 unique indexes, 6 of
 * them primary keys, leaving 11. `locations_org_code_idx` is still the only one
 * whose key mentions `organization_id`.
 *
 * ## The other translation of `assets_code_unique`
 *
 * `AssetTemplatesInstantiateService.translateAssetCodeCollision`
 * (`asset-templates-instantiate.service.ts:862`) already translates that same
 * constraint, and answers **409** where this map answers **400**. Both are
 * right for their route and neither should be made to match the other: there,
 * the service generates the codes itself and a collision means one was taken
 * mid-batch, so the caller retries unchanged and `409 Conflict` says exactly
 * that. Here the operator typed the code, so retrying unchanged repeats the
 * failure and the answer has to name the field to correct — which is a `400`.
 */
import { BadRequestException } from "@nestjs/common";

import type { OnboardingDraft } from "@bms/shared";

/** The draft's own top-level key that a refusal names, less the metadata block. */
export type CommitConflictField = keyof Omit<OnboardingDraft, "onboardingMeta">;

/** Whether the row that refused the write is one this caller could ever see. */
export type CommitConflictScope = "global" | "tenant";

export type CommitUniqueConflict = {
  /**
   * The draft's own top-level name, so the body matches the shape
   * `z.flatten()` produces at the 75 `BadRequestException(…flatten())` sites in
   * `apps/api/src` outside `*.spec.ts` and `*.test.ts`. `flatten()`
   * cannot name an array element either — `F4.103`'s recorded residual — so
   * the element is named in prose inside `message`, never as a key.
   */
  readonly field: CommitConflictField;
  readonly scope: CommitConflictScope;
  readonly message: string;
};

/**
 * Constraint name → the refusal. A `Map`, not an object literal: a lookup by a
 * caller-influenced string on a plain object finds `Object.prototype` members,
 * so a constraint named `toString` would resolve to a function.
 */
export const COMMIT_UNIQUE_CONFLICTS: ReadonlyMap<string, CommitUniqueConflict> = new Map<
  string,
  CommitUniqueConflict
>([
  [
    "locations_org_code_idx",
    {
      field: "location",
      scope: "tenant",
      message:
        "That location code is already used by another location in this organization. " +
        "Choose a different code.",
    },
  ],
  [
    "locations_slug_unique",
    {
      field: "location",
      scope: "global",
      message: "That location slug is already taken. Choose a different slug.",
    },
  ],
  [
    "point_keys_code_unique",
    {
      field: "pointKeys",
      scope: "global",
      message:
        "A point key code in this draft was taken while the commit was running. " +
        "Nothing was written — retry the commit.",
    },
  ],
  [
    "assets_code_unique",
    {
      field: "assets",
      scope: "global",
      message: "An asset code in this draft is already taken. Choose a different code for it.",
    },
  ],
  [
    "rtus_location_code_unique",
    {
      field: "rtus",
      scope: "tenant",
      message:
        "Two RTUs in this draft use the same code. An RTU code must be unique within its location.",
    },
  ],
  [
    "rtus_external_rtu_idx",
    {
      field: "rtus",
      scope: "global",
      message:
        "An external RTU id in this draft is already taken. Choose a different external RTU id.",
    },
  ],
  [
    "rtus_mqtt_topic_idx",
    {
      field: "rtus",
      scope: "global",
      message: "An MQTT topic in this draft is already taken. Choose a different topic.",
    },
  ],
  [
    "rtus_rtu_code_idx",
    {
      field: "rtus",
      scope: "global",
      message:
        "An rtuCode in this draft is already taken. It is the device key the ingest host " +
        "routes by, so two RTUs cannot share one. Choose a different rtuCode.",
    },
  ],
  [
    "asset_points_asset_id_point_key_unique",
    {
      field: "assetPoints",
      scope: "tenant",
      message:
        "Two points on the same asset in this draft use the same point key. " +
        "A point key may appear once per asset.",
    },
  ],
  [
    "asset_points_asset_source_key_idx",
    {
      field: "assetPoints",
      scope: "tenant",
      message:
        "Two points on the same asset in this draft use the same source data key. " +
        "A source data key may appear once per asset.",
    },
  ],
]);

/**
 * The mapped refusal for a driver error, or `null` for everything else.
 *
 * **Narrow on both axes, and the narrowing is the safety argument.**
 * `asset-templates-instantiate.service.ts` branches on the constraint name
 * alone; that is the weaker pattern, because `constraint` is set on other
 * integrity violations too — a `23503` foreign-key failure names the foreign
 * key. A commit that violated one is not a duplicate value and must not be
 * described as one, so the SQLSTATE is tested as well.
 */
export function commitUniqueConflict(err: unknown): CommitUniqueConflict | null {
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const { code, constraint } = err as { code?: unknown; constraint?: unknown };
  if (code !== "23505" || typeof constraint !== "string") {
    return null;
  }
  return COMMIT_UNIQUE_CONFLICTS.get(constraint) ?? null;
}

/**
 * A mapped `23505` as the repository's refusal body, and **anything else
 * returned unchanged** — the shape `translateAssetCodeCollision` established,
 * so the caller writes `throw translate(err)` and a re-throw preserves the
 * original error object, its stack and its `cause`.
 *
 * `HttpException.createBody` returns an object argument unchanged, so the wire
 * body is `{"formErrors":[],"fieldErrors":{…}}` with no `message`, `error` or
 * `statusCode` — exactly what `apiErrorMessage` renders. `formErrors` stays
 * empty because every conflict here belongs to a field; a whole-body complaint
 * is what `formErrors` means, and putting the sentence in both would render it
 * twice.
 */
export function translateCommitUniqueConflict(err: unknown): unknown {
  const conflict = commitUniqueConflict(err);
  if (conflict === null) {
    return err;
  }
  return new BadRequestException({
    formErrors: [] as string[],
    fieldErrors: { [conflict.field]: [conflict.message] },
  });
}
