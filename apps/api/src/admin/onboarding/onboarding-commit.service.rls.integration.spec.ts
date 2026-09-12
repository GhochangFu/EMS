import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";
import pg from "pg";

import { CREDENTIAL_KEY_ENV } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { CredentialCryptoService } from "../../security/credential-crypto.service";
import { COMMIT_UNIQUE_CONFLICTS } from "./onboarding-commit-conflict";
import type { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `E7.1b` — the org-stamping proof for the onboarding commit path.
 *
 * `OnboardingCommitService.commit` writes an entire estate in one transaction:
 * a location, point keys, RTUs, RTU connection configs, assets and asset
 * points. The transaction has run inside `withTenant(tenantDb, org, …)` since
 * F4.16, but only `locations` and `point_keys` carried an `organization_id`
 * then. E7.1b gave `rtus`, `assets` and `asset_points` that column (migration
 * `0046`) and a `tenant_isolation` policy + `FORCE` (`0047`), so their inserts
 * here must now stamp it — otherwise the `WITH CHECK` rejects them once the
 * policy lands. This asserts that stamp under a real `bms_tenant` connection,
 * the only proof the owner connection cannot fake.
 *
 * The commit is done through the wizard's own service, so it is also the one
 * place where `rtu_connection_configs` (the encrypted-credential row, ADR 0012)
 * is written as part of a tenant-scoped commit — isolated by `rtu_id → rtus`,
 * so it carries no `organization_id` of its own.
 */
export type CommitRlsFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  organizationId: string;
  /** A seeded, commit-ready draft session in that org. */
  sessionId: string;
};

/** The ids `commit` returns, captured so the lifecycle file can clean them up. */
export type CommitIds = {
  locationId: string;
  rtuIds: string[];
  assetIds: string[];
  pointKeyIds: string[];
  assetPointIds: string[];
};

/**
 * Every row in `table` (a literal from this file, never external input) with an
 * id in `ids` carries `organization_id = org`, and every id resolved to a row.
 */
async function assertAllStamped(
  ownerPool: pg.Pool,
  table: string,
  ids: string[],
  organizationId: string,
): Promise<void> {
  if (ids.length === 0) {
    throw new Error(`E7.1b: expected at least one ${table} row, commit wrote none`);
  }
  const { rows } = await ownerPool.query<{ organization_id: string | null }>(
    `SELECT organization_id FROM bms.${table} WHERE id = ANY($1)`,
    [ids],
  );
  expect(rows.length, `${table}: every id resolves to a row`).toBe(ids.length);
  for (const row of rows) {
    expect(row.organization_id, `${table} row carries the session org`).toBe(organizationId);
  }
}

/**
 * `commit` stamps the session's org on every tenant-bearing row it writes — the
 * three columns E7.1b adds (`rtus`, `assets`, `asset_points`) and, as a
 * regression guard, the two F4.16 already stamped (`locations`, `point_keys`).
 */
export async function assertCommitStampsOrgOnEveryTenantRow(
  ctx: CommitRlsFixtures,
  jwt: JwtPayload,
): Promise<CommitIds> {
  const { commitSvc, ownerPool, organizationId, sessionId } = ctx;

  const result = await commitSvc.commit(jwt, sessionId);
  expect(result.sessionId).toBe(sessionId);
  expect(result.rtuIds.length).toBe(1);
  expect(result.assetIds.length).toBe(1);
  expect(result.assetPointIds.length).toBe(1);

  // The three E7.1b columns, stamped under a real bms_tenant connection.
  await assertAllStamped(ownerPool, "rtus", result.rtuIds, organizationId);
  await assertAllStamped(ownerPool, "assets", result.assetIds, organizationId);
  await assertAllStamped(ownerPool, "asset_points", result.assetPointIds, organizationId);
  // The one F4.16 table still stamped — this guards against a regression that
  // would drop it when the E7.1b stamps were added alongside.
  await assertAllStamped(ownerPool, "locations", [result.locationId], organizationId);

  // **`F3.39` — `point_keys` left this list, and its assertion is inverted
  // rather than deleted.** Migration `0057` drops the column, so a commit
  // cannot stamp an organization on a catalog row and the old assertion tested
  // a mechanism that no longer exists. What is worth holding instead is that
  // the commit still CREATES the codes it declares: the FK `0057` adds means an
  // asset_points row cannot exist without one, so a commit that silently
  // stopped writing them would fail loudly here rather than three tables later.
  expect(result.pointKeyIds.length, "the commit created its declared point key").toBe(1);
  const { rows: keyRows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.point_keys WHERE id = ANY($1)`,
    [result.pointKeyIds],
  );
  expect(
    keyRows.length,
    "every point key the commit reported must exist, readable with no tenant context — " +
      "bms.point_keys carries no policy after 0057",
  ).toBe(result.pointKeyIds.length);

  return {
    locationId: result.locationId,
    rtuIds: result.rtuIds,
    assetIds: result.assetIds,
    pointKeyIds: result.pointKeyIds,
    assetPointIds: result.assetPointIds,
  };
}

/** What the ADR 0051 Amendment 1 refusal needs, beyond the commit itself. */
export type CommitConflictFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft that redeclares `pointKeyCode` with a new unit. */
  sessionId: string;
  /** A catalog code that exists already, registered with no unit. */
  pointKeyCode: string;
  /** The location code that draft would write, if it got that far. */
  locationCode: string;
};

/**
 * ADR 0051 Amendment 1 decisions 2 and 3 — the wiring assertion.
 *
 * The rule itself is proved by `onboarding-point-key-conflict.spec.ts`, which
 * needs no database and therefore runs on every machine. What only a real
 * commit can show is the three things around it: that the service consults the
 * catalog row rather than just its id, that the refusal is a `400` and not a
 * constraint error, and that the transaction rolls back — the location the
 * commit inserts two statements earlier must not survive the throw.
 */
export async function assertCommitRefusesAContradictingPointKey(
  ctx: CommitConflictFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { commitSvc, ownerPool, sessionId, pointKeyCode, locationCode } = ctx;

  await expect(
    commitSvc.commit(jwt, sessionId),
    "a draft declaring a unit the catalog leaves unset is refused",
  ).rejects.toThrow(/already exists in the fleet-wide catalog/);

  const { rows: keyRows } = await ownerPool.query<{ unit: string | null }>(
    `SELECT unit FROM bms.point_keys WHERE code = $1`,
    [pointKeyCode],
  );
  expect(keyRows.length, "the catalog row is still there").toBe(1);
  expect(
    keyRows[0].unit,
    "the refused draft did not fill the unit every organization shares",
  ).toBeNull();

  const { rows: locationRows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE code = $1`,
    [locationCode],
  );
  expect(
    locationRows.length,
    "the location inserted before the point-key loop rolled back with it",
  ).toBe(0);
}

/** What the `F4.109` duplicate-value refusal needs. */
export type CommitDuplicateFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft whose `location.code` a seeded row already holds. */
  sessionId: string;
  organizationId: string;
  /** The code carried by both the seeded row and the draft. */
  locationCode: string;
};

/**
 * `F4.109` — a duplicate value is a per-field `400`, measured through a real
 * transaction rather than a stubbed one.
 *
 * `onboarding-commit-conflict.spec.ts` proves the map, the narrowing and the
 * wiring with a hand-built driver error. **What only a real database can show
 * is the link that spec fakes**: that Postgres raises `23505` naming
 * `locations_org_code_idx` for this insert, that drizzle rolls the transaction
 * back and re-throws the driver's own error object rather than wrapping it, and
 * that `code` and `constraint` are therefore still readable by the time
 * `translateCommitUniqueConflict` sees it. Every one of those three could break
 * without a unit test noticing.
 *
 * The seeded row is written by the fixture, not by a sibling test, so this case
 * does not depend on the order the file's `it()`s run in.
 *
 * **This case shipped with four `expect`s and now has two, because review and
 * then a live probe showed the other two could not fail.** `expect` throws, so
 * only the first failure runs, and both dead ones sat below a body equality
 * against a static literal.
 *
 * - `getStatus() === 400` cannot fail at any position. `BadRequestException` is
 *   400 by construction, and the equality above has already established the
 *   type.
 * - `!body.includes(locationCode)` — an echo check — was dead by construction
 *   too: the body is compared to `conflict.message`, a fixed string, while
 *   `locationCode` carries a per-run suffix, so any edit that could put the
 *   value in the body changes the body and the equality reddens first.
 *   Reordering it was the obvious repair and it **still** did not fire under the
 *   mutation that appends `err.detail` to the message. The reason is worth
 *   keeping: Postgres's `BuildIndexValueDescription` returns NULL when RLS is
 *   enabled on the relation, so on `bms.locations` the value never reaches the
 *   driver at all. Probed as `bms_owner`, `err.detail` is `undefined`; as
 *   `bms_fleet` (`BYPASSRLS`) the same insert yields the full key. There is no
 *   value here to echo, so no assertion here can hold the §4.3 rule.
 *
 * What is left is stronger than either, and it is worth being exact about how
 * far. Equality to a fixed body forbids every **addition** — `detail`,
 * `constraint`, `table`, `schema`, the driver's message — and every substituted
 * **message**. It reddens under the load-bearing mutation, removing the `.catch`
 * from `commit`, which leaves a raw driver error here; measured, the failure
 * reads `expected 'not a BadRequestException: error: dup…'`.
 *
 * It does **not** hold a substituted *field*. A translation that ignored the
 * entry it looked up and hard-coded `location` would leave this case green,
 * because `location` is the field under test. That mutation belongs to
 * `assertEveryMappedConstraintBecomesItsOwnFieldError` in the unit spec, which
 * walks all ten. The §4.3 sentinels live there too, where a synthetic error can
 * carry the `detail` this path withholds.
 */
export async function assertCommitAnswersADuplicateLocationCodeWithAFieldError(
  ctx: CommitDuplicateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { commitSvc, ownerPool, sessionId, organizationId, locationCode } = ctx;

  const conflict = COMMIT_UNIQUE_CONFLICTS.get("locations_org_code_idx");
  if (!conflict) {
    throw new Error("F4.109: locations_org_code_idx is not in COMMIT_UNIQUE_CONFLICTS");
  }

  let raised: unknown;
  try {
    await commitSvc.commit(jwt, sessionId);
  } catch (error) {
    raised = error;
  }

  // One string from whatever was raised, so a raw driver error is compared as
  // readily as a refusal. A `pg` error's `code`, `constraint`, `table` and
  // `schema` are own enumerable properties, so `JSON.stringify` reaches them and
  // the equality below refuses them all.
  const answered =
    raised instanceof BadRequestException
      ? JSON.stringify(raised.getResponse())
      : `not a BadRequestException: ${String(raised)} ${JSON.stringify(raised)}`;

  expect(
    answered,
    "a duplicate location code is answered as a per-field 400, not a 500",
  ).toBe(JSON.stringify({ formErrors: [], fieldErrors: { location: [conflict.message] } }));

  const { rows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE code = $1 AND organization_id = $2`,
    [locationCode, organizationId],
  );
  expect(rows.length, "the refused commit wrote no second location and rolled back").toBe(1);
}

/** What the `F4.60` duplicate-`rtuCode` proof needs. */
export type CommitDuplicateRtuCodeFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft with a fresh location whose one RTU carries `rtuCode`. */
  sessionId: string;
  /** The `rtu_code` carried by both a pre-existing RTU and the draft's RTU. */
  rtuCode: string;
  /** The draft's own location code, which no seeded row holds. */
  draftLocationCode: string;
};

/**
 * `F4.60` — a duplicate `rtuCode` reaches the commit's catch and is answered as
 * a per-field `400` naming `rtus`.
 *
 * **This case exists for one failure the unit spec cannot see: the map key.**
 * `onboarding-commit-conflict.spec.ts` reads `COMMIT_UNIQUE_CONFLICTS` on both
 * sides of every assertion, so a key misspelt as `rtus_rtucode_idx` — in the map
 * and in `REACHABLE_CONSTRAINTS` alike — leaves all eight of its cases green
 * while production answers `500`. Only a real Postgres says what the constraint
 * is actually called, and this is where that string is compared.
 *
 * It differs from the `locations_org_code_idx` case above in what makes it
 * reachable, and the difference is the point. That constraint's key includes
 * `location_id`, and the location is created inside the same transaction, so
 * only two RTUs *within one draft* can collide. `rtus_rtu_code_idx` is keyed on
 * the bare column, so a draft with a perfectly fresh location still collides
 * with an RTU that belongs to a different location — and, since the key carries
 * no `organization_id`, potentially to a different organization. The fixture
 * plants the pre-existing RTU deliberately outside the draft.
 *
 * Measured while writing this: as `bms_tenant`, the role `withTenant` connects
 * as, the refusal carries `code`, `constraint`, `table` and `schema` but **no
 * `detail`** — `BuildIndexValueDescription` returns NULL on a policied relation.
 * So the `rtuCode` the caller sent cannot leak back through this path even if
 * the message were built from `detail`, which it is not.
 */
export async function assertCommitAnswersADuplicateRtuCodeWithAFieldError(
  ctx: CommitDuplicateRtuCodeFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { commitSvc, ownerPool, sessionId, rtuCode, draftLocationCode } = ctx;

  const conflict = COMMIT_UNIQUE_CONFLICTS.get("rtus_rtu_code_idx");
  if (!conflict) {
    throw new Error("F4.60: rtus_rtu_code_idx is not in COMMIT_UNIQUE_CONFLICTS");
  }

  let raised: unknown;
  try {
    await commitSvc.commit(jwt, sessionId);
  } catch (error) {
    raised = error;
  }

  const answered =
    raised instanceof BadRequestException
      ? JSON.stringify(raised.getResponse())
      : `not a BadRequestException: ${String(raised)} ${JSON.stringify(raised)}`;

  expect(
    answered,
    "a duplicate rtuCode is answered as a per-field 400 naming rtus, not a 500",
  ).toBe(JSON.stringify({ formErrors: [], fieldErrors: { rtus: [conflict.message] } }));

  // The whole commit rolled back, so the draft's own location — which nothing
  // else creates — must not exist. This is the positive control for the
  // assertion above: without it, a commit that refused for some unrelated
  // earlier reason would answer the same way and prove nothing about the RTU
  // insert being reached at all.
  const { rows } = await ownerPool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE code = $1`,
    [draftLocationCode],
  );
  expect(rows.length, "the refused commit wrote no location and rolled back").toBe(0);

  const still = await ownerPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.rtus WHERE rtu_code = $1`,
    [rtuCode],
  );
  expect(still.rows[0]?.n, "exactly the one pre-existing RTU still holds the code").toBe(1);
}

/** What the ADR 0062 decision 3 key-version proof needs. */
export type CommitKeyVersionFixtures = {
  commitSvc: OnboardingCommitService;
  ownerPool: pg.Pool;
  /** A commit-ready draft with three RTUs, seeded with `_secrets` already attached. */
  sessionId: string;
  /** 32-byte base64, distinct from `previousKeyBase64`. */
  currentKeyBase64: string;
  /** 32-byte base64, the key that encrypted `rtuCodes.previous`'s blob. */
  previousKeyBase64: string;
  rtuCodes: { current: string; previous: string; none: string };
};

/**
 * ADR 0062 decision 3 — the RTU row's `key_version` travels with the
 * ciphertext, never a literal.
 *
 * Three RTUs, one draft: `rtuCodes.current` carries a blob `{c,iv,v:2}`
 * encrypted under `currentKeyBase64`; `rtuCodes.previous` carries a
 * version-less blob `{c,iv}` encrypted under `previousKeyBase64` — the state
 * every pre-ADR-0062 blob is actually in; `rtuCodes.none` carries no blob at
 * all. The commit runs with `KEY=currentKeyBase64`,
 * `PREVIOUS=previousKeyBase64`, `VERSION=2`.
 *
 * **`rtuCodes.previous`'s row reading `key_version = 1` does not, by itself,
 * distinguish "read as 1" from "the column default is 1"** — `key_version` is
 * `NOT NULL DEFAULT 1`, so an implementation that never wrote the column at
 * all would read back the same value. What kills that mutation is the unit
 * assertion `readEncryptedCredentials({c,iv}).keyVersion === 1` in
 * `onboarding-redaction.spec.ts`; this case's own proof that something was
 * actually written and read correctly is the round trip below, which decrypts
 * the stored ciphertext at the stored version and gets the original plaintext
 * back.
 */
export async function assertCommitWritesTheKeyVersionForEachCredentialState(
  ctx: CommitKeyVersionFixtures,
  jwt: JwtPayload,
): Promise<CommitIds> {
  const { commitSvc, ownerPool, sessionId, currentKeyBase64, previousKeyBase64, rtuCodes } = ctx;

  const saved = {
    current: process.env[CREDENTIAL_KEY_ENV.current],
    previous: process.env[CREDENTIAL_KEY_ENV.previous],
    version: process.env[CREDENTIAL_KEY_ENV.version],
  };
  process.env[CREDENTIAL_KEY_ENV.current] = currentKeyBase64;
  process.env[CREDENTIAL_KEY_ENV.previous] = previousKeyBase64;
  process.env[CREDENTIAL_KEY_ENV.version] = "2";

  try {
    const result = await commitSvc.commit(jwt, sessionId);
    expect(result.rtuIds.length, "the three-RTU draft wrote three RTUs").toBe(3);

    const { rows } = await ownerPool.query<{
      code: string;
      key_version: number;
      credentials_ciphertext: Buffer | null;
      credentials_iv: Buffer | null;
    }>(
      `SELECT r.code, rcc.key_version, rcc.credentials_ciphertext, rcc.credentials_iv
         FROM bms.rtu_connection_configs rcc
         JOIN bms.rtus r ON r.id = rcc.rtu_id
        WHERE rcc.rtu_id = ANY($1)`,
      [result.rtuIds],
    );
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const currentRow = byCode.get(rtuCodes.current);
    const previousRow = byCode.get(rtuCodes.previous);
    const noneRow = byCode.get(rtuCodes.none);

    expect(
      currentRow?.key_version,
      "the RTU encrypted under the current key keeps its written version",
    ).toBe(2);
    expect(
      noneRow?.key_version,
      "a credential-less row is labelled with the current version — it labels nothing, " +
        "but the NOT NULL column needs a value",
    ).toBe(2);
    expect(
      previousRow?.key_version,
      "a version-less blob (every pre-ADR-0062 blob) is labelled version 1 (decision 3)",
    ).toBe(1);

    // The round trip: decrypt the stored ciphertext at **the version read back
    // out of the column**, not at a literal. A literal `1` here would restate
    // the assertion above rather than depend on it — the round trip would still
    // pass if the column held something else and the two assertions had drifted
    // apart. Reading the column makes this prove the stored version selects the
    // key that actually wrote the bytes, which is the whole of decision 3.
    const crypto = new CredentialCryptoService();
    const decrypted = crypto.decrypt(
      previousRow!.credentials_ciphertext!,
      previousRow!.credentials_iv!,
      previousRow!.key_version,
    );
    expect(
      decrypted.password,
      "the version-1 row actually decrypts under the previous key — proving something " +
        "was written, not merely relabelled",
    ).toBe("previous-key-password");

    return {
      locationId: result.locationId,
      rtuIds: result.rtuIds,
      assetIds: result.assetIds,
      pointKeyIds: result.pointKeyIds,
      assetPointIds: result.assetPointIds,
    };
  } finally {
    for (const [name, value] of [
      [CREDENTIAL_KEY_ENV.current, saved.current],
      [CREDENTIAL_KEY_ENV.previous, saved.previous],
      [CREDENTIAL_KEY_ENV.version, saved.version],
    ] as const) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
