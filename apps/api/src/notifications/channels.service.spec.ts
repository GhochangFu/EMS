import { BadRequestException, ConflictException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { ChannelsService } from "./channels.service";
import { buildConfig } from "./notifications.config";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Ctor = ConstructorParameters<typeof ChannelsService>;

/**
 * A db whose writes reject with a given Postgres SQLSTATE (and, optionally,
 * the `constraint` name node-postgres attaches — what distinguishes the
 * `kind` FK from the `organizationId` one in `create`'s translated error).
 *
 * `select` answers `update`/`remove`'s pre-GUC read of the channel's own
 * `organization_id` (E7.1c Task 7) — every `dbRejecting` case except the
 * org-scoped create below is a **global** channel (`organizationId: null`),
 * which is what routes the write onto this same fake `fleetDb` rather than
 * `withTenant`'s tenant pool. `transaction` stands in for the tenant pool's
 * `withTenant` path: it runs the callback against a stub that answers the
 * `SET LOCAL` `execute` and then rejects the same way `fleetDb` does.
 */
function dbRejecting(code: string, constraint?: string): Ctor[0] {
  const failure = Object.assign(new Error(`constraint violation ${code}`), {
    code,
    constraint,
  });
  const tx = {
    execute: () => Promise.resolve(undefined),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(failure) }) }),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ organizationId: null }]) }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.reject(failure) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.reject(failure) }) }),
    }),
    delete: () => ({ where: () => ({ returning: () => Promise.reject(failure) }) }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Ctor[0];
}

/** A db that answers the readiness COUNT with a fixed number. */
function dbCounting(count: number): Ctor[0] {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) }),
  } as unknown as Ctor[0];
}

/**
 * `F3.50` — a db that lets `update()` through and hands back the values it
 * `set`s.
 *
 * One `select` shape serves both reads on that path: `loadExistingForWrite`
 * takes `organizationId` (`null` routes the write onto `fleetDb` rather than
 * `withTenant`) and `audit`'s actor read takes `id`. `insert` swallows the
 * audit row.
 */
function dbCapturingUpdate(onSet: (values: Record<string, unknown>) => void): Ctor[0] {
  const updated = {
    id: CHANNEL_ID,
    organizationId: null,
    code: "ops-email",
    name: "renamed",
    kind: "email",
    config: {},
    enabled: true,
    secretCiphertext: null,
    secretIv: null,
    secretKeyVersion: null,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    updatedAt: new Date("2020-01-01T00:00:00.000Z"),
  };
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([{ organizationId: null, id: "u1" }]) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        onSet(values);
        return { where: () => ({ returning: () => Promise.resolve([updated]) }) };
      },
    }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  } as unknown as Ctor[0];
}

const CHANNEL_ID = "33333333-3333-3333-3333-333333333333";

/** The actor every audited write now takes — a global admin, so
 * `canManageNotificationChannel` allows every organization including `null`. */
const ACTOR = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" } as JwtPayload;

const crypto = {
  encrypt: () => ({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), keyVersion: 1 }),
} as unknown as Ctor[2];

/** A real `AccessControlService`-shaped fake: `ACTOR` is always `admin`, so
 * every gate call answers `true`/the whole `bms.users` row unfiltered. */
const accessControl = {
  requireMasterDataUser: () => Promise.resolve({ role: "admin" }),
  canManageNotificationChannel: () => Promise.resolve(true),
  writableOrganizationIds: () => Promise.resolve(null),
} as unknown as Ctor[3];

/**
 * `E7.1c`: `ChannelsService` now takes `(fleetDb, tenantDb, crypto,
 * accessControl)`. Every path these tests exercise is a **global** channel
 * (`ACTOR` is `admin`, no `organizationId` supplied), which stays on
 * `fleetDb` — the one mock serves both pool slots, same as before this item.
 */
function makeChannels(db: Ctor[0]): ChannelsService {
  return new ChannelsService(db, db, crypto, accessControl);
}

/** `makeChannels` with the crypto slot supplied — the `E8.4` rows below need a
 * fake that answers `decrypt`, which the module-level `crypto` does not. */
function makeChannelsWith(db: Ctor[0], withCrypto: Ctor[2]): ChannelsService {
  return new ChannelsService(db, db, withCrypto, accessControl);
}

/**
 * What a `decrypt` call carried. `keyVersion` is `unknown`, not
 * `number | null`, on purpose: a build that passes only two arguments records
 * `undefined`, and `undefined` must be distinguishable from `null` by `===`.
 */
type RecordedDecrypt = { ciphertext: unknown; iv: unknown; keyVersion: unknown };

/**
 * A crypto fake whose `decrypt` **records its third argument** and answers a
 * secret. Recording is the whole point: the fake could answer `{ secret: "s" }`
 * without ever looking at `keyVersion`, and then a call site that dropped the
 * argument would still produce `secretState: "ready"`. The argument is only
 * observable because it is written down.
 */
function recordingCrypto(calls: RecordedDecrypt[], onDecrypt?: () => void): Ctor[2] {
  return {
    encrypt: () => ({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), keyVersion: 1 }),
    decrypt: (ciphertext: unknown, iv: unknown, keyVersion: unknown) => {
      calls.push({ ciphertext, iv, keyVersion });
      onDecrypt?.();
      return { secret: "s" };
    },
  } as unknown as Ctor[2];
}

/** 32 zero bytes, base64 — a syntactically valid current key. */
const TEST_KEY_B64 = Buffer.alloc(32).toString("base64");

/**
 * Runs `run` with a **live, single-key** window loaded.
 *
 * `toChannelRow` calls the real `CredentialCryptoService.isConfigured()` before
 * it reaches the injected fake, and that static reads `process.env` on every
 * call. Without a current key — or with a *dead* window, which since Task 2
 * also answers `false` — every row below would return `unreadable` without
 * `decrypt` ever being called, and each assertion would pass or fail for a
 * reason that has nothing to do with the version it is about. All three
 * variables are saved and restored, and the two rotation ones are deleted.
 */
function withCredentialKey<T>(run: () => T): T {
  const saved = {
    current: process.env.CREDENTIAL_ENCRYPTION_KEY,
    previous: process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
    version: process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION,
  };
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_B64;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  delete process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION;
  try {
    return run();
  } finally {
    for (const [name, value] of [
      ["CREDENTIAL_ENCRYPTION_KEY", saved.current],
      ["CREDENTIAL_ENCRYPTION_KEY_PREVIOUS", saved.previous],
      ["CREDENTIAL_ENCRYPTION_KEY_VERSION", saved.version],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** A stored channel row in `toChannelRow`'s own parameter type, so a column the
 * projection stops carrying is a `typecheck:tests` failure here too. */
function storedChannelRow(secret: {
  secretCiphertext: Buffer | null;
  secretIv: Buffer | null;
  secretKeyVersion: number | null;
}): Parameters<ChannelsService["toChannelRow"]>[0] {
  return {
    id: "c1",
    organizationId: null,
    code: "ops-webhook",
    name: "Ops",
    kind: "webhook",
    config: {},
    enabled: true,
    updatedAt: new Date("2020-05-04T03:02:01.000Z"),
    ...secret,
  };
}

async function rejectsWith(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

/**
 * `F3.8` U7 — the two things `ChannelsService` answers that a 500 would hide.
 */
export async function runChannelsServiceTests(): Promise<void> {
  // --- constraint violations are answers, not crashes ----------------------
  //
  // Creating a channel with a code that already exists is the first mistake
  // anyone makes on the admin screen, and an undeclared kind is the second.
  // Untranslated, both are 500s.
  {
    const duplicate = makeChannels(dbRejecting("23505"));
    await rejectsWith(
      () =>
        duplicate.create(ACTOR, {
          code: "ops-email",
          name: "Operations",
          kind: "email",
          config: {},
          enabled: true,
        }),
      (e) => e instanceof ConflictException,
      "a duplicate channel code",
    );

    const unknownKind = makeChannels(dbRejecting("23503"));
    await rejectsWith(
      () =>
        unknownKind.create(ACTOR, {
          code: "ops-pigeon",
          name: "Pigeon",
          kind: "carrier-pigeon",
          config: {},
          enabled: true,
        }),
      (e) => e instanceof BadRequestException,
      "a kind the vocabulary does not declare",
    );
    await rejectsWith(
      () => unknownKind.update(ACTOR, "33333333-3333-3333-3333-333333333333", { kind: "pigeon" }),
      (e) => e instanceof BadRequestException,
      "a PATCH to an undeclared kind",
    );

    // Deleting a channel the ledger still references is the same SQLSTATE
    // pointing the other way, and it needs a different sentence: the fix is to
    // disable the channel, not to correct a field. Found by clicking Delete in
    // the browser after a send test, where it read "Internal server error".
    await rejectsWith(
      () => unknownKind.remove(ACTOR, "33333333-3333-3333-3333-333333333333"),
      (e) =>
        e instanceof ConflictException &&
        /delivery history/i.test((e as Error).message) &&
        /disable/i.test((e as Error).message),
      "deleting a channel that has delivery history",
    );

    // E7.1c gave `create` a SECOND foreign key once `body.organizationId`
    // became a real column: the default `onForeignKey` above answers "unknown
    // channel kind" for both, so an admin naming a UUID that is not an
    // organization was told to fix a `kind` that was never wrong. `create`'s
    // own `onForeignKey` distinguishes them by `err.constraint` — verified
    // against a live `pg_constraint` read, not assumed.
    const badOrg = makeChannels(
      dbRejecting("23503", "notification_channels_organization_id_fkey"),
    );
    await rejectsWith(
      () =>
        badOrg.create(ACTOR, {
          organizationId: "99999999-9999-4999-8999-999999999999",
          code: "ops-webhook",
          name: "Ops",
          kind: "email",
          config: {},
          enabled: true,
        }),
      (e) =>
        e instanceof BadRequestException &&
        /does not name an existing organization/i.test((e as Error).message),
      "organizationId naming no organization",
    );

    // Anything else still surfaces as itself — this translates two states, it
    // does not swallow errors.
    const other = makeChannels(dbRejecting("40001"));
    await rejectsWith(
      () =>
        other.create(ACTOR, {
          code: "ops-email",
          name: "Operations",
          kind: "email",
          config: {},
          enabled: true,
        }),
      (e) => !(e instanceof ConflictException) && !(e instanceof BadRequestException),
      "a serialisation failure",
    );
  }

  // --- readiness: the boolean and the sentence must agree ------------------
  //
  // The first draft reported webhook `configured: true` while the detail said
  // CREDENTIAL_ENCRYPTION_KEY was missing. A banner keyed on the boolean would
  // then show nothing while every secret-bearing webhook channel skipped —
  // exactly the visible-when-absent treatment decision 5 requires.
  {
    const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
    try {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      const withSecrets = makeChannels(dbCounting(2));
      const blocked = await withSecrets.readiness(buildConfig({ SMTP_HOST: "mailpit" }));
      const webhook = blocked.find((item) => item.kind === "webhook");
      assert(
        webhook?.configured === false,
        "with no key and channels that store secrets, webhooks are NOT ready",
      );
      assert(
        (webhook?.detail ?? "").includes("CREDENTIAL_ENCRYPTION_KEY"),
        "the sentence names what is missing",
      );

      // No signed webhook anywhere: a missing key genuinely does not affect
      // this deployment, and readiness says so rather than crying wolf.
      const noSecrets = makeChannels(dbCounting(0));
      const fine = await noSecrets.readiness(buildConfig({ SMTP_HOST: "mailpit" }));
      assert(
        fine.find((item) => item.kind === "webhook")?.configured === true,
        "with no secret-bearing channel, a missing key does not block webhooks",
      );

      // Email follows SMTP_HOST and nothing else.
      const email = (await noSecrets.readiness(buildConfig({}))).find(
        (item) => item.kind === "email",
      );
      assert(email?.configured === false, "no SMTP_HOST means email is not ready");
      assert(
        (email?.detail ?? "").includes("SMTP_HOST"),
        "the sentence names the variable to set",
      );
      // Readiness is readable by any authenticated user, so it must never carry
      // a host, a port or a credential (§9.6).
      const all = await noSecrets.readiness(
        buildConfig({ SMTP_HOST: "smtp.internal.example", SMTP_PASSWORD: "hunter2" }),
      );
      const serialised = JSON.stringify(all);
      for (const forbidden of ["smtp.internal.example", "hunter2"]) {
        assert(!serialised.includes(forbidden), `readiness leaked ${forbidden}`);
      }
    } finally {
      if (key === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      else process.env.CREDENTIAL_ENCRYPTION_KEY = key;
    }
  }

  // --- F3.50: the two halves of the channel's release watermark ------------
  //
  // ADR 0057 Amendment 3 ruling Q1 dates a `skipped_unconfigured` delivery row
  // against `max(channel.updatedAt, PROCESS_STARTED_AT)`. Both assertions below
  // guard the `channel.updatedAt` half, and neither is guarded anywhere else.
  {
    // The stored value, not a fresh one. `updatedAt: new Date()` in
    // `toChannelRow`'s `base` compiles, type-checks and passes every other
    // test in this repo — and it would make EVERY unconfigured row stale, so
    // no event key would ever block again and the sweep would write one row
    // per tick for ever. This is the cheapest place that catches it.
    const storedAt = new Date("2020-05-04T03:02:01.000Z");
    const row = makeChannels(dbCounting(0)).toChannelRow({
      id: "c1",
      organizationId: null,
      code: "ops-webhook",
      name: "Ops",
      kind: "webhook",
      config: {},
      enabled: true,
      secretCiphertext: null,
      secretIv: null,
      // `E8.4`: the projection now carries the stored key version too. This row
      // has no secret at all, so it returns before `decrypt` — the widening is
      // here only so the literal still satisfies the parameter type, and the
      // `updated_at` claim below is unchanged by it.
      secretKeyVersion: null,
      updatedAt: storedAt,
    });
    assert(
      row.updatedAt instanceof Date && row.updatedAt.getTime() === storedAt.getTime(),
      `toChannelRow must carry the STORED updated_at, got ${String(row.updatedAt)}`,
    );

    // And every PATCH must move it, because that write is the operator's whole
    // release path: fix the URL, and the next tick retries the step that was
    // refused while there was none. Nothing held this line before `F3.50` —
    // deleting it broke no test, and after `F3.50` its loss is silent.
    //
    // Ruling Q2: `update()` stamps `updatedAt` UNCONDITIONALLY, before it looks
    // at any field, so a rename releases the channel's stranded keys too. That
    // is an accepted cost (Amendment 3 §6(a)), which is why this asserts on a
    // body that carries nothing but `name`.
    let capturedUpdatedAt: unknown = "update() was never reached";
    await makeChannels(
      dbCapturingUpdate((values) => {
        capturedUpdatedAt = values.updatedAt;
      }),
    ).update(ACTOR, CHANNEL_ID, { name: "renamed" });
    assert(
      capturedUpdatedAt instanceof Date,
      `every PATCH must set updated_at — it is F3.50's release trigger; got ${String(capturedUpdatedAt)}`,
    );
  }
}

/**
 * `E8.4` — a channel secret is decrypted at **the version it was stored
 * under** (ADR 0062 decisions 3 and 4).
 *
 * This is the positive control for `runChannelNullKeyVersionTests` directly
 * below, and the two are kept adjacent on purpose: that function asserts an
 * absence — that nothing turned a `null` version into a `1` on the way to
 * `decrypt` — and an absence assertion proves nothing unless something first
 * shows the recorder sees a real version at all. `4` is that something, and it
 * is neither the current version under this fixture (`1`) nor the `1` a `?? 1`
 * would produce, so a build that pins the argument to a literal cannot
 * coincide with it. (It is not "not the column default" either:
 * `notification_channels.secret_key_version` has **no** default — that is
 * `rtu_connection_configs.key_version`, a different column.)
 */
export function runChannelStoredKeyVersionTests(): void {
  const calls: RecordedDecrypt[] = [];
  const row = withCredentialKey(() =>
    makeChannelsWith(dbCounting(0), recordingCrypto(calls)).toChannelRow(
      storedChannelRow({
        secretCiphertext: Buffer.from("ciphertext"),
        secretIv: Buffer.from("iv"),
        secretKeyVersion: 4,
      }),
    ),
  );

  assert(row.secretState === "ready", `a decryptable secret reads ready, got ${row.secretState}`);
  assert(row.secret === "s", `the decrypted secret is carried through, got ${String(row.secret)}`);
  assert(calls.length === 1, `decrypt must be called exactly once, got ${calls.length}`);
  assert(
    calls[0]?.keyVersion === 4,
    `decrypt must receive the STORED version 4; got ${String(calls[0]?.keyVersion)} — ` +
      `\`undefined\` means the third argument was dropped, any number means it was pinned`,
  );
}

/**
 * `E8.4` — a `null` stored version reaches `decrypt` **as `null`**.
 *
 * `notification_channels.secret_key_version` is nullable, so a row can hold
 * ciphertext with no record of which key wrote it. Decision 4 forbids guessing:
 * the null travels to `decrypt`, which refuses it with
 * `CredentialKeyVersionError`, and the caller's `catch` turns that into
 * `unreadable`. A `?? 1` at the call site would silence the compiler and
 * reintroduce exactly the guess the decision forbids.
 *
 * **This is an absence-shaped claim** — "no `?? 1` happened" — so it is stated
 * as a `=== null` on the recorded argument rather than as an outcome. The
 * function above is its positive control, and `4 ?? 1` is `4`, so that row
 * cannot detect this mutation on its own. Do not separate them.
 *
 * The row's `secretState` is deliberately **not** asserted: the fake answers a
 * secret for any version, so the state here is a fact about the fake, not about
 * the build. `credential-crypto.service.spec.ts` holds the real refusal.
 */
export function runChannelNullKeyVersionTests(): void {
  const calls: RecordedDecrypt[] = [];
  withCredentialKey(() =>
    makeChannelsWith(dbCounting(0), recordingCrypto(calls)).toChannelRow(
      storedChannelRow({
        secretCiphertext: Buffer.from("ciphertext"),
        secretIv: Buffer.from("iv"),
        secretKeyVersion: null,
      }),
    ),
  );

  assert(
    calls.length === 1,
    `a null stored version must still REACH decrypt — the refusal belongs to ` +
      `CredentialCryptoService, not to a short-circuit here; got ${calls.length} calls`,
  );
  assert(
    calls[0]?.keyVersion === null,
    `a null stored version must arrive as null, never defaulted; got ${String(
      calls[0]?.keyVersion,
    )} — \`1\` is the \`?? 1\` this row exists to forbid`,
  );
}

/**
 * `E8.4` — a version refusal is **contained**, and the warn names the class.
 *
 * What this gates is containment, not class discrimination: the `catch` in
 * `toChannelRow` is deliberately class-blind, so there is no branch here that
 * a `CredentialKeyVersionError` takes and another error does not. Narrowing
 * that `catch` to any specific class makes this error *escape* a method whose
 * contract is "never throws" on a fire-and-forget path, and the assertions
 * below then fail by the throw rather than by the state.
 *
 * `unreadable` on its own would be a weak claim — every decrypt failure lands
 * there. The two log assertions are what pin *which* failure was reported:
 * `err.name` and not `err.message`. The fixture's message is chosen so that it
 * does not contain the class name, so a build that logged the message instead
 * fails the third assertion rather than sliding past it (§9.6: the warn carries
 * no ciphertext, no key and no key version).
 */
export function runChannelVersionRefusalTests(): void {
  const refusal = Object.assign(new Error("credential key version 4 is not loaded (loaded: 1)"), {
    name: "CredentialKeyVersionError",
  });
  const warnings: string[] = [];
  const service = makeChannelsWith(
    dbCounting(0),
    recordingCrypto([], () => {
      throw refusal;
    }),
  );
  // The logger is a private instance field; the cast replaces it for this one
  // instance, which is the only way the warn is observable from here.
  (service as unknown as { logger: { warn: (message: string) => void } }).logger = {
    warn: (message: string) => warnings.push(message),
  };

  const row = withCredentialKey(() =>
    service.toChannelRow(
      storedChannelRow({
        secretCiphertext: Buffer.from("ciphertext"),
        secretIv: Buffer.from("iv"),
        secretKeyVersion: 4,
      }),
    ),
  );

  assert(
    row.secretState === "unreadable",
    `a refused key version must read unreadable, got ${row.secretState}`,
  );
  assert(row.secret === null, `no secret is carried out of a refusal, got ${String(row.secret)}`);
  assert(warnings.length === 1, `the refusal is warned about exactly once, got ${warnings.length}`);
  assert(
    (warnings[0] ?? "").includes("CredentialKeyVersionError"),
    `the warn must name the error CLASS; got ${String(warnings[0])}`,
  );
  assert(
    !(warnings[0] ?? "").includes("is not loaded"),
    `the warn must carry the class only, never the message (§9.6); got ${String(warnings[0])}`,
  );
}
