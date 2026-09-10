import { randomBytes, randomUUID } from "node:crypto";

import { eq, is, isNotNull, TransactionRollbackError } from "drizzle-orm";

import { notificationChannels, rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { fixtureLocation } from "../testing/integration-fixtures";
import { CredentialCryptoService, type EncryptedPayload } from "./credential-crypto.service";
import {
  CredentialRotationService,
  type RotationReport,
  type RotationTableCounts,
} from "./credential-rotation.service";

/**
 * `E8.4` / ADR 0062 decisions 6 and 11, plan §12 rulings 3 and 7 — the
 * `rotate-credentials` walk against a real database.
 *
 * Assertions live here; `credential-rotation.integration.test.ts` is the vitest
 * entry point (ADR 0014), one `it()` per exported function — `assert` throws,
 * so two claims in one `it()` would let only the first redden.
 *
 * Every function runs inside its own transaction and rolls back
 * (`alarm-kb.integration.spec.ts:28`'s `withRollback`), plants its fixtures
 * **inside** that transaction, and drives the service with `run(tx)`. Nothing
 * here commits, so nothing here can collide with another suite's rows on the
 * shared database — fixture codes carry a `randomUUID()` for the same reason
 * `createFixtureAssets` does.
 *
 * **A transaction-local fixture is not enough here, and the plan's §10 did not
 * say so.** The walk is fleet-wide by construction (decision 6): it scans every
 * committed ciphertext-bearing row, including the ones another suite has
 * committed — `onboarding-commit.service.rls.integration` commits a three-RTU
 * draft with two ciphertexts, and this machine had those three rows left behind
 * by a killed run. Measured before this was added: every absolute count was off
 * by two and `failures` carried foreign ids. So {@link withFixtureTx} does two
 * things `withRollback` alone does not: it opens the transaction at
 * `repeatable read`, so a row committed by a concurrent suite after the first
 * statement is invisible for the rest of it, and it **nulls the secret columns
 * of every committed row inside the transaction** before a fixture is planted
 * — rolled back with everything else, so nothing on the shared database is
 * changed. The channels' `notification_channels_secret_complete_check` is why
 * all three columns go together. The residual hazard is a concurrent suite
 * deleting one of those rows in the milliseconds between the snapshot and the
 * quarantine, which surfaces as a named `40001`, not a wrong count.
 *
 * **Decision 11 — no test requires a deployed key.** Each function generates
 * its own two 32-byte keys, encrypts its fixtures under key A at version 1, and
 * only then opens the rotation window `KEY=B, PREVIOUS=A, VERSION=2`. The env
 * is restored in a `finally` so no window leaks into the next `it()`.
 *
 * **The service is constructed as `new CredentialRotationService(tx as BmsDb,
 * …)` and driven with `run(tx)`**, so every proof runs on an explicit
 * transaction and none of them gates the `@Inject(FLEET_DRIZZLE)` token. That
 * one claim — rotation runs as `bms_fleet` — is held by exactly one line,
 * `fleet-read-wiring.spec.ts`'s `injectedToken(CredentialRotationService, 0)`.
 *
 * Errors are matched on `err.name`, never `instanceof` — vitest can load two
 * module instances (`F4.108`).
 */

/** `asserts condition`, so a null check on a read-back row narrows for the closure below it. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run, { isolationLevel: "repeatable read" }).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

/**
 * Makes every committed secret-bearing row invisible to the walk for the rest
 * of the transaction — see the file docblock. The channel update nulls all
 * three columns because the CHECK constraint ties them together.
 */
async function quarantineCommittedSecrets(tx: BmsTx): Promise<void> {
  await tx
    .update(rtuConnectionConfigs)
    .set({ credentialsCiphertext: null, credentialsIv: null })
    .where(isNotNull(rtuConnectionConfigs.credentialsCiphertext));
  await tx
    .update(notificationChannels)
    .set({ secretCiphertext: null, secretIv: null, secretKeyVersion: null })
    .where(isNotNull(notificationChannels.secretCiphertext));
}

/** A rolled-back `repeatable read` transaction with the shared database's secrets quarantined. */
async function withFixtureTx(db: BmsDb, body: (tx: BmsTx) => Promise<void>): Promise<void> {
  await withRollback(db, async (tx) => {
    await quarantineCommittedSecrets(tx);
    await body(tx);
    tx.rollback();
  });
}

const ENV_NAMES = [
  "CREDENTIAL_ENCRYPTION_KEY",
  "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
  "CREDENTIAL_ENCRYPTION_KEY_VERSION",
] as const;

type CredentialEnv = { readonly [name in (typeof ENV_NAMES)[number]]?: string };

/** Sets exactly the named variables and unsets the three that are absent. */
function applyEnv(env: CredentialEnv): void {
  for (const name of ENV_NAMES) {
    const value = env[name];
    if (value === undefined) {
      delete process.env[name];
      continue;
    }
    process.env[name] = value;
  }
}

/**
 * Saves all three variables, applies `env`, runs `body`, and restores them in
 * a `finally`. `body` may be async: the rotation walk is, and the crypto
 * service reads `process.env` on every call, so the window must stay open for
 * the whole walk.
 */
async function withEnv<T>(env: CredentialEnv, body: () => Promise<T> | T): Promise<T> {
  const saved = ENV_NAMES.map((name) => [name, process.env[name]] as const);
  try {
    applyEnv(env);
    return await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
        continue;
      }
      process.env[name] = value;
    }
  }
}

/** Two fresh 32-byte keys: the fixtures are written under A, the rotation moves them to B. */
function keyPair(): { a: string; b: string } {
  return { a: randomBytes(32).toString("base64"), b: randomBytes(32).toString("base64") };
}

/** The window every rotation in this file runs under: B is current at 2, A is previous. */
function rotationWindow(keys: { a: string; b: string }): CredentialEnv {
  return {
    CREDENTIAL_ENCRYPTION_KEY: keys.b,
    CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: keys.a,
    CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
  };
}

/** A real `encrypt` under one temporarily-loaded key, never a hand-built blob (plan §13 correction 8). */
async function encryptUnder(
  keyBase64: string,
  version: number,
  plaintext: Record<string, unknown>,
): Promise<EncryptedPayload> {
  return withEnv(
    { CREDENTIAL_ENCRYPTION_KEY: keyBase64, CREDENTIAL_ENCRYPTION_KEY_VERSION: String(version) },
    () => new CredentialCryptoService().encrypt(plaintext),
  );
}

/** Runs the rotation on `tx` under `env`, constructing both services after the window is set. */
async function rotateUnder(tx: BmsTx, env: CredentialEnv): Promise<RotationReport> {
  return withEnv(env, () =>
    new CredentialRotationService(tx as BmsDb, new CredentialCryptoService()).run(tx),
  );
}

/**
 * A rotation driven through a crypto service whose `encrypt` the caller has
 * wrapped — the race rows use it to enqueue a competing write.
 */
async function rotateWith(
  tx: BmsTx,
  env: CredentialEnv,
  crypto: CredentialCryptoService,
): Promise<RotationReport> {
  return withEnv(env, () => new CredentialRotationService(tx as BmsDb, crypto).run(tx));
}

type StoredSecret = {
  readonly ciphertext: Buffer | null;
  readonly iv: Buffer | null;
  readonly keyVersion: number | null;
};

/** `EncryptedPayload` as the columns hold it, optionally relabelled to a version no key writes. */
function stored(payload: EncryptedPayload, keyVersion = payload.keyVersion): StoredSecret {
  return { ciphertext: payload.ciphertext, iv: payload.iv, keyVersion };
}

const NO_SECRET: StoredSecret = { ciphertext: null, iv: null, keyVersion: null };

/**
 * An RTU and its `rtu_connection_configs` row, inside the caller's transaction.
 * `keyVersion` is `NOT NULL DEFAULT 1` on this table, so a credential-less row
 * is planted at 1 — exactly the row decision 6's hazard is about.
 */
async function plantConfig(
  tx: BmsTx,
  secret: StoredSecret,
  updatedAt?: Date,
): Promise<string> {
  const { locationId, organizationId } = await fixtureLocation(tx);
  const [rtu] = await tx
    .insert(rtus)
    .values({
      organizationId,
      locationId,
      code: `E84-${randomUUID()}`,
      displayName: "E8.4 rotation fixture RTU",
    })
    .returning({ id: rtus.id });
  assert(rtu !== undefined, "fixture RTU was not inserted");
  const [row] = await tx
    .insert(rtuConnectionConfigs)
    .values({
      organizationId,
      rtuId: rtu.id,
      protocol: "mqtt",
      config: {},
      credentialsCiphertext: secret.ciphertext,
      credentialsIv: secret.iv,
      keyVersion: secret.keyVersion ?? 1,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    })
    .returning({ id: rtuConnectionConfigs.id });
  assert(row !== undefined, "fixture rtu_connection_configs row was not inserted");
  return row.id;
}

/** A `notification_channels` row inside the caller's transaction; `keyVersion` may be null here. */
async function plantChannel(tx: BmsTx, secret: StoredSecret, updatedAt?: Date): Promise<string> {
  const { organizationId } = await fixtureLocation(tx);
  const [row] = await tx
    .insert(notificationChannels)
    .values({
      organizationId,
      code: `e84-${randomUUID()}`,
      name: "E8.4 rotation fixture channel",
      kind: "webhook",
      config: {},
      secretCiphertext: secret.ciphertext,
      secretIv: secret.iv,
      secretKeyVersion: secret.keyVersion,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    })
    .returning({ id: notificationChannels.id });
  assert(row !== undefined, "fixture notification_channels row was not inserted");
  return row.id;
}

type ReadBack = StoredSecret & { readonly updatedAt: Date };

async function readConfig(tx: BmsTx, id: string): Promise<ReadBack> {
  const [row] = await tx
    .select({
      ciphertext: rtuConnectionConfigs.credentialsCiphertext,
      iv: rtuConnectionConfigs.credentialsIv,
      keyVersion: rtuConnectionConfigs.keyVersion,
      updatedAt: rtuConnectionConfigs.updatedAt,
    })
    .from(rtuConnectionConfigs)
    .where(eq(rtuConnectionConfigs.id, id));
  assert(row !== undefined, `rtu_connection_configs ${id} vanished`);
  return row;
}

async function readChannel(tx: BmsTx, id: string): Promise<ReadBack> {
  const [row] = await tx
    .select({
      ciphertext: notificationChannels.secretCiphertext,
      iv: notificationChannels.secretIv,
      keyVersion: notificationChannels.secretKeyVersion,
      updatedAt: notificationChannels.updatedAt,
    })
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id));
  assert(row !== undefined, `notification_channels ${id} vanished`);
  return row;
}

/** One assertion over all five counters, so the failure message names which one moved. */
function assertCounts(
  label: string,
  actual: RotationTableCounts,
  expected: RotationTableCounts,
): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected counts ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const counts = (
  scanned: number,
  rotated: number,
  skipped: number,
  raced: number,
  failed: number,
): RotationTableCounts => ({ scanned, rotated, skipped, raced, failed });

const NOTHING = counts(0, 0, 0, 0, 0);

function sameBytes(a: Buffer | null, b: Buffer | null): boolean {
  return a !== null && b !== null && a.equals(b);
}

/**
 * A config row under A/v1 rotates: `{scanned 1, rotated 1}`, the row reads back
 * at version 2 **with different ciphertext bytes**. The bytes check is the
 * positive control that anything was written — a walk that relabels without
 * re-encrypting passes the version assertion alone.
 */
export async function assertConfigRowRotatesToTheCurrentVersion(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const before = await encryptUnder(keys.a, 1, { username: "rtu", password: randomUUID() });
    const id = await plantConfig(tx, stored(before));

    const report = await rotateUnder(tx, rotationWindow(keys));

    assert(report.currentVersion === 2, `currentVersion should be 2, got ${report.currentVersion}`);
    assertCounts("rtu_connection_configs", report.rtuConnectionConfigs, counts(1, 1, 0, 0, 0));
    const after = await readConfig(tx, id);
    assert(
      !sameBytes(after.ciphertext, before.ciphertext),
      "the ciphertext bytes did not change — the row was relabelled, not re-encrypted",
    );
    assert(after.keyVersion === 2, `key_version should be 2 after rotation, got ${after.keyVersion}`);
  });
}

/**
 * The re-encrypt proof. After rotation the row decrypts under a service whose
 * window is `KEY=B, VERSION=2` with **no** previous key, and round-trips the
 * original plaintext. Old bytes under a new label fail here: B cannot open a
 * ciphertext A produced.
 */
export async function assertRotatedRowDecryptsUnderTheCurrentKeyAlone(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const plaintext = { username: "rtu", password: randomUUID() };
    const id = await plantConfig(tx, stored(await encryptUnder(keys.a, 1, plaintext)));

    await rotateUnder(tx, rotationWindow(keys));

    const { ciphertext, iv, keyVersion } = await readConfig(tx, id);
    assert(ciphertext !== null && iv !== null, "the rotated row lost its ciphertext");
    const roundTripped = await withEnv(
      { CREDENTIAL_ENCRYPTION_KEY: keys.b, CREDENTIAL_ENCRYPTION_KEY_VERSION: "2" },
      () => new CredentialCryptoService().decrypt(ciphertext, iv, keyVersion),
    );
    assert(
      JSON.stringify(roundTripped) === JSON.stringify(plaintext),
      `the rotated row does not decrypt under the current key alone: ${JSON.stringify(roundTripped)}`,
    );
  });
}

/**
 * Decision 6's stated hazard. `key_version` is `NOT NULL DEFAULT 1`, so a
 * credential-less row reads `1` — below the current version — and a
 * version-driven walk would select it and hand `null` to `decrypt`. The walk
 * selects on the ciphertext, so the row is not scanned at all.
 */
export async function assertCredentialLessConfigRowIsNotScanned(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const id = await plantConfig(tx, { ...NO_SECRET, keyVersion: 1 });

    const report = await rotateUnder(tx, rotationWindow(keyPair()));

    assertCounts("rtu_connection_configs", report.rtuConnectionConfigs, NOTHING);
    const after = await readConfig(tx, id);
    assert(after.ciphertext === null && after.keyVersion === 1, "the credential-less row was touched");
  });
}

/**
 * The channel walk: a channel under A/v1 rotates, a channel with no secret is
 * not scanned, and a channel already at B/v2 is skipped with its bytes intact.
 * The skip is what makes the command idempotent and what lets the runbook read
 * "zero rows below the current version" off the counts.
 */
export async function assertChannelWalkRotatesSkipsAndIgnoresNoSecret(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const underA = await encryptUnder(keys.a, 1, { secret: randomUUID() });
    const underB = await encryptUnder(keys.b, 2, { secret: randomUUID() });
    const rotatable = await plantChannel(tx, stored(underA));
    const withoutSecret = await plantChannel(tx, NO_SECRET);
    const current = await plantChannel(tx, stored(underB));

    const report = await rotateUnder(tx, rotationWindow(keys));

    assertCounts("notification_channels", report.notificationChannels, counts(2, 1, 1, 0, 0));
    const rotated = await readChannel(tx, rotatable);
    assert(
      rotated.keyVersion === 2 && !sameBytes(rotated.ciphertext, underA.ciphertext),
      "the A/v1 channel was not re-encrypted at version 2",
    );
    const untouched = await readChannel(tx, withoutSecret);
    assert(untouched.ciphertext === null && untouched.keyVersion === null, "the no-secret channel was touched");
    const skipped = await readChannel(tx, current);
    assert(sameBytes(skipped.ciphertext, underB.ciphertext), "the B/v2 channel's bytes changed");
  });
}

/** Idempotence: a second `run()` under the same window rotates nothing and skips both rows. */
export async function assertSecondRunRotatesNothing(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    await plantConfig(tx, stored(await encryptUnder(keys.a, 1, { password: randomUUID() })));
    await plantChannel(tx, stored(await encryptUnder(keys.a, 1, { secret: randomUUID() })));

    const first = await rotateUnder(tx, rotationWindow(keys));
    assertCounts("first run, rtu_connection_configs", first.rtuConnectionConfigs, counts(1, 1, 0, 0, 0));
    assertCounts("first run, notification_channels", first.notificationChannels, counts(1, 1, 0, 0, 0));

    const second = await rotateUnder(tx, rotationWindow(keys));
    assertCounts("second run, rtu_connection_configs", second.rtuConnectionConfigs, counts(1, 0, 1, 0, 0));
    assertCounts("second run, notification_channels", second.notificationChannels, counts(1, 0, 1, 0, 0));
  });
}

/**
 * A row labelled `key_version 7` — a version no loaded key writes — is
 * collected as `failed 1` with the error's **name**, never its message, and its
 * bytes are left alone. **The v1 row in the same run still rotates**: that is
 * the positive control, and without it this passes against a walk that aborts
 * on the first error.
 */
export async function assertUnknownVersionIsCollectedAndTheWalkContinues(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const labelledSeven = await encryptUnder(keys.a, 1, { password: randomUUID() });
    // Planted first so the walk (ordered by id, or by anything) cannot dodge the
    // failure by reaching the good row first — uuids are random, so plant order
    // is not id order, and the claim holds either way.
    const unknown = await plantConfig(tx, stored(labelledSeven, 7));
    const rotatable = await plantConfig(tx, stored(await encryptUnder(keys.a, 1, { password: randomUUID() })));

    const report = await rotateUnder(tx, rotationWindow(keys));

    assertCounts("rtu_connection_configs", report.rtuConnectionConfigs, counts(2, 1, 0, 0, 1));
    assert(
      JSON.stringify(report.failures) ===
        JSON.stringify([
          {
            table: "rtu_connection_configs",
            id: unknown,
            storedVersion: 7,
            error: "CredentialKeyVersionError",
          },
        ]),
      `failures should name the class and the stored version: ${JSON.stringify(report.failures)}`,
    );
    const stillSeven = await readConfig(tx, unknown);
    assert(
      stillSeven.keyVersion === 7 && sameBytes(stillSeven.ciphertext, labelledSeven.ciphertext),
      "the unknown-version row was modified",
    );
    const moved = await readConfig(tx, rotatable);
    assert(moved.keyVersion === 2, `the v1 row in the same run should have rotated, got version ${moved.keyVersion}`);
  });
}

/**
 * Enqueues a competing write on the transaction's own connection from inside
 * `encrypt`, so it runs **before** the rotation's update. The walk reads the
 * row, decrypts, calls `encrypt` — the wrapper submits the competing `UPDATE`
 * to the same `pg` client, which executes queries in submission order — and
 * only then submits its compare-and-set. `encrypt` is synchronous, so the
 * wrapper cannot await; it returns the pending promise for the caller to
 * settle after `run()`.
 *
 * The competing write keeps the **old** version with new bytes: an API replica
 * whose environment has not moved yet, re-saving the secret under key A. That
 * is the write a version-only compare-and-set would overwrite, so the bytes
 * clause is the one this fixture makes load-bearing.
 */
function racingCrypto(
  enqueueCompetingWrite: () => Promise<unknown>,
): { crypto: CredentialCryptoService; settled: () => Promise<unknown> } {
  const crypto = new CredentialCryptoService();
  const encrypt = crypto.encrypt.bind(crypto);
  let pending: Promise<unknown> = Promise.resolve();
  crypto.encrypt = (plaintext) => {
    pending = enqueueCompetingWrite();
    return encrypt(plaintext);
  };
  return { crypto, settled: () => pending };
}

/**
 * Ruling 7, config table. A write that lands between the read and the update
 * wins: the rotation reports `raced 1` and the row holds the competing bytes.
 * Without the compare-and-set the rotation's update matches on `id` alone and
 * overwrites a secret an operator just saved.
 */
export async function assertConcurrentConfigWriteWinsOverTheRotation(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const id = await plantConfig(tx, stored(await encryptUnder(keys.a, 1, { password: randomUUID() })));
    const competing = await encryptUnder(keys.a, 1, { password: `replica-${randomUUID()}` });

    const { crypto, settled } = racingCrypto(() =>
      tx
        .update(rtuConnectionConfigs)
        .set({ credentialsCiphertext: competing.ciphertext, credentialsIv: competing.iv })
        .where(eq(rtuConnectionConfigs.id, id))
        .then(() => undefined),
    );
    const report = await rotateWith(tx, rotationWindow(keys), crypto);
    await settled();

    assertCounts("rtu_connection_configs", report.rtuConnectionConfigs, counts(1, 0, 0, 1, 0));
    const after = await readConfig(tx, id);
    assert(
      sameBytes(after.ciphertext, competing.ciphertext) && after.keyVersion === 1,
      "the rotation overwrote the competing write",
    );
  });
}

/** Ruling 7, channel table — the compare-and-set is written once per table, so it is gated once per table. */
export async function assertConcurrentChannelWriteWinsOverTheRotation(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const id = await plantChannel(tx, stored(await encryptUnder(keys.a, 1, { secret: randomUUID() })));
    const competing = await encryptUnder(keys.a, 1, { secret: `replica-${randomUUID()}` });

    const { crypto, settled } = racingCrypto(() =>
      tx
        .update(notificationChannels)
        .set({ secretCiphertext: competing.ciphertext, secretIv: competing.iv })
        .where(eq(notificationChannels.id, id))
        .then(() => undefined),
    );
    const report = await rotateWith(tx, rotationWindow(keys), crypto);
    await settled();

    assertCounts("notification_channels", report.notificationChannels, counts(1, 0, 0, 1, 0));
    const after = await readChannel(tx, id);
    assert(
      sameBytes(after.ciphertext, competing.ciphertext) && after.keyVersion === 1,
      "the rotation overwrote the competing write",
    );
  });
}

/**
 * Ruling 3. `updated_at` is not touched on either table. `F3.50` dates
 * `skipped_unconfigured` deliveries against `max(channel.updatedAt,
 * PROCESS_STARTED_AT)`, so a bump here would read as an operator release and
 * re-open every blocked event key. Not in the plan's §10 table — ruling 3 had
 * no gate until this function.
 */
export async function assertRotationLeavesUpdatedAtUntouched(db: BmsDb): Promise<void> {
  await withFixtureTx(db, async (tx) => {
    const keys = keyPair();
    const planted = new Date("2020-06-15T12:00:00.000Z");
    const configId = await plantConfig(
      tx,
      stored(await encryptUnder(keys.a, 1, { password: randomUUID() })),
      planted,
    );
    const channelId = await plantChannel(
      tx,
      stored(await encryptUnder(keys.a, 1, { secret: randomUUID() })),
      planted,
    );

    const report = await rotateUnder(tx, rotationWindow(keys));

    assert(
      report.rtuConnectionConfigs.rotated === 1 && report.notificationChannels.rotated === 1,
      `both rows should have rotated: ${JSON.stringify(report)}`,
    );
    const config = await readConfig(tx, configId);
    assert(
      config.updatedAt.getTime() === planted.getTime(),
      `rtu_connection_configs.updated_at moved to ${config.updatedAt.toISOString()}`,
    );
    const channel = await readChannel(tx, channelId);
    assert(
      channel.updatedAt.getTime() === planted.getTime(),
      `notification_channels.updated_at moved to ${channel.updatedAt.toISOString()}`,
    );
  });
}
