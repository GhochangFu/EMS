import { BadRequestException, ConflictException } from "@nestjs/common";

import { ChannelsService } from "./channels.service";
import { buildConfig } from "./notifications.config";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Ctor = ConstructorParameters<typeof ChannelsService>;

/** A db whose writes reject with a given Postgres SQLSTATE. */
function dbRejecting(code: string): Ctor[0] {
  const failure = Object.assign(new Error(`constraint violation ${code}`), { code });
  return {
    insert: () => ({ values: () => ({ returning: () => Promise.reject(failure) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.reject(failure) }) }),
    }),
    delete: () => ({ where: () => ({ returning: () => Promise.reject(failure) }) }),
  } as unknown as Ctor[0];
}

/** A db that answers the readiness COUNT with a fixed number. */
function dbCounting(count: number): Ctor[0] {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) }),
  } as unknown as Ctor[0];
}

/** The actor every audited write now takes. */
const ACTOR = { sub: "u1", email: "admin@bms.local" };

const crypto = {
  encrypt: () => ({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), keyVersion: 1 }),
} as unknown as Ctor[1];

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
    const duplicate = new ChannelsService(dbRejecting("23505"), crypto);
    await rejectsWith(
      () =>
        duplicate.create({
          code: "ops-email",
          name: "Operations",
          kind: "email",
          config: {},
          enabled: true,
        }, ACTOR),
      (e) => e instanceof ConflictException,
      "a duplicate channel code",
    );

    const unknownKind = new ChannelsService(dbRejecting("23503"), crypto);
    await rejectsWith(
      () =>
        unknownKind.create({
          code: "ops-pigeon",
          name: "Pigeon",
          kind: "carrier-pigeon",
          config: {},
          enabled: true,
        }, ACTOR),
      (e) => e instanceof BadRequestException,
      "a kind the vocabulary does not declare",
    );
    await rejectsWith(
      () => unknownKind.update("33333333-3333-3333-3333-333333333333", { kind: "pigeon" }, ACTOR),
      (e) => e instanceof BadRequestException,
      "a PATCH to an undeclared kind",
    );

    // Deleting a channel the ledger still references is the same SQLSTATE
    // pointing the other way, and it needs a different sentence: the fix is to
    // disable the channel, not to correct a field. Found by clicking Delete in
    // the browser after a send test, where it read "Internal server error".
    await rejectsWith(
      () => unknownKind.remove("33333333-3333-3333-3333-333333333333", ACTOR),
      (e) =>
        e instanceof ConflictException &&
        /delivery history/i.test((e as Error).message) &&
        /disable/i.test((e as Error).message),
      "deleting a channel that has delivery history",
    );

    // Anything else still surfaces as itself — this translates two states, it
    // does not swallow errors.
    const other = new ChannelsService(dbRejecting("40001"), crypto);
    await rejectsWith(
      () =>
        other.create({
          code: "ops-email",
          name: "Operations",
          kind: "email",
          config: {},
          enabled: true,
        }, ACTOR),
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

      const withSecrets = new ChannelsService(dbCounting(2), crypto);
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
      const noSecrets = new ChannelsService(dbCounting(0), crypto);
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
