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
}
