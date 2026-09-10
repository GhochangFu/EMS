import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { notificationChannels, rtuConnectionConfigs } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import type { BmsTx } from "../database/tenant-context";
import { CredentialCryptoService, type EncryptedPayload } from "./credential-crypto.service";

export type RotationTableCounts = {
  scanned: number;
  rotated: number;
  skipped: number;
  raced: number;
  failed: number;
};

export type RotationFailure = {
  table: "rtu_connection_configs" | "notification_channels";
  id: string;
  storedVersion: number | null;
  /** `err.name` only, never the message — the report is written to stdout and kept. */
  error: string;
};

export type RotationReport = {
  currentVersion: number;
  rtuConnectionConfigs: RotationTableCounts;
  notificationChannels: RotationTableCounts;
  failures: RotationFailure[];
};

/** A row selected for rotation, as both tables hold it. Nullability is the columns' own. */
type StoredRow = {
  readonly id: string;
  readonly ciphertext: Buffer | null;
  readonly iv: Buffer | null;
  readonly keyVersion: number | null;
};

/** The row after the walk has proved it carries both halves of the ciphertext. */
type ReadableRow = {
  readonly id: string;
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly keyVersion: number | null;
};

/**
 * One table's half of the walk. The loop, the counters and the failure
 * collection are shared; only the column names differ.
 */
type TableWalk = {
  readonly table: RotationFailure["table"];
  /** Every row that stores ciphertext — selected on the bytes, never the version. */
  select(): Promise<StoredRow[]>;
  /** Compare-and-set against the bytes and version that were read; resolves to the rows matched. */
  update(row: ReadableRow, next: EncryptedPayload): Promise<number>;
};

/**
 * A row that stores ciphertext without its IV cannot be read at any version.
 * Named so the report distinguishes it from a key-window refusal.
 */
class CredentialRowUnreadableError extends Error {
  override readonly name = "CredentialRowUnreadableError";

  constructor() {
    super("ciphertext is stored without its iv");
  }
}

function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err && typeof err.name === "string") {
    return err.name;
  }
  return "UnknownError";
}

/**
 * `E8.4` / ADR 0062 decision 6 — the `rotate-credentials` walk.
 *
 * Re-encrypts every ciphertext-bearing row of `rtu_connection_configs` and
 * `notification_channels` at the current key version, one row at a time, and
 * reports counts per table so "rotation finished" is a number rather than an
 * absence of errors.
 *
 * **Selected on the ciphertext, never on the version.** `key_version` is
 * `NOT NULL DEFAULT 1`, so a credential-less RTU row still reads `1` — below
 * any rotated version — and a version-driven walk would select it and hand
 * `null` to `decrypt`. `WHERE credentials_ciphertext IS NOT NULL` does not.
 *
 * **Compare-and-set** (plan §12 ruling 7, a plan addition rather than an ADR
 * decision): the update matches on `id`, the bytes that were read and the
 * version that was read, so a secret rewritten between the read and the update
 * is left alone and counted as `raced` — an operator's fresh save, or an API
 * replica still on the previous key, must never be overwritten with a
 * re-encryption of stale plaintext. The next run rotates it.
 *
 * **`updated_at` is not touched** (ruling 3). `F3.50` dates
 * `skipped_unconfigured` deliveries against `max(channel.updatedAt,
 * PROCESS_STARTED_AT)`, so bumping it would read as an operator release and
 * re-open every blocked event key.
 *
 * **Failures are collected, never thrown.** A row whose stored version no
 * loaded key writes, or whose bytes do not authenticate, is counted and named
 * by its error's `name` only — the walk continues, so one bad row cannot leave
 * every row after it unrotated. `CredentialCryptoService`'s constructor is
 * what refuses a dead window before any row is read.
 *
 * No `JSON.parse` here: `decrypt` owns the one parse this feature makes
 * (`tests/f4.108-service-parses-are-guarded.test.ts`).
 */
@Injectable()
export class CredentialRotationService {
  constructor(
    // ADR 0043 Amendment 3 named reason, quoted from ADR 0062 decision 6:
    // rotation is a fleet-wide operation and an RLS-scoped connection would
    // silently skip every other organization's rows and still report success.
    // A single tenant GUC cannot express "every organization's credentials",
    // so this is `bms_fleet` (BYPASSRLS) by construction, and
    // `fleet-read-wiring.spec.ts` is the one gate on that token.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly crypto: CredentialCryptoService,
  ) {}

  /**
   * Walks both tables on `db` — the fleet pool by default, or a caller's
   * transaction — and returns the report. Throws only if the window is dead
   * (`currentKeyVersion` propagates `CredentialKeyConfigError`) or a `SELECT`
   * itself fails; a per-row failure is collected.
   */
  async run(db: BmsTx | BmsDb = this.fleetDb): Promise<RotationReport> {
    const currentVersion = CredentialCryptoService.currentKeyVersion();
    const failures: RotationFailure[] = [];
    const rtu = await this.walk(configWalk(db), currentVersion, failures);
    const channels = await this.walk(channelWalk(db), currentVersion, failures);
    return {
      currentVersion,
      rtuConnectionConfigs: rtu,
      notificationChannels: channels,
      failures,
    };
  }

  private async walk(
    walk: TableWalk,
    currentVersion: number,
    failures: RotationFailure[],
  ): Promise<RotationTableCounts> {
    const counts: RotationTableCounts = { scanned: 0, rotated: 0, skipped: 0, raced: 0, failed: 0 };
    for (const row of await walk.select()) {
      counts.scanned += 1;
      // Idempotence: a row the current key already wrote has nothing to move.
      // A null channel version is never equal, and `decrypt` refuses it below.
      if (row.keyVersion === currentVersion) {
        counts.skipped += 1;
        continue;
      }
      try {
        if (row.ciphertext === null || row.iv === null) {
          throw new CredentialRowUnreadableError();
        }
        const readable: ReadableRow = {
          id: row.id,
          ciphertext: row.ciphertext,
          iv: row.iv,
          keyVersion: row.keyVersion,
        };
        // Decrypted at the stored version (decision 4) and re-encrypted at the
        // current one; the resolver, not this walk, decides which key reads.
        const plaintext = this.crypto.decrypt(readable.ciphertext, readable.iv, readable.keyVersion);
        const next = this.crypto.encrypt(plaintext);
        const matched = await walk.update(readable, next);
        if (matched === 1) {
          counts.rotated += 1;
        } else {
          counts.raced += 1;
        }
      } catch (err) {
        counts.failed += 1;
        failures.push({
          table: walk.table,
          id: row.id,
          storedVersion: row.keyVersion,
          error: errorName(err),
        });
      }
    }
    return counts;
  }
}

/**
 * The version half of each compare-and-set. The `isNull` branch is unreachable
 * twice over: `rtu_connection_configs.key_version` is `NOT NULL`, and
 * `notification_channels_secret_complete_check` (migration 0038) ties
 * `secret_key_version` to `secret_ciphertext`, so no row the walk selects can
 * hold a null version — and `decrypt` would refuse one before any update ran.
 * Kept so the predicate is total over the column's declared type rather than
 * resting on a non-null assertion; no test can reach it, and none claims to.
 */
function versionMatches(
  column: typeof rtuConnectionConfigs.keyVersion | typeof notificationChannels.secretKeyVersion,
  storedVersion: number | null,
) {
  return storedVersion === null ? isNull(column) : eq(column, storedVersion);
}

function configWalk(db: BmsTx | BmsDb): TableWalk {
  const t = rtuConnectionConfigs;
  return {
    table: "rtu_connection_configs",
    select: () =>
      db
        .select({ id: t.id, ciphertext: t.credentialsCiphertext, iv: t.credentialsIv, keyVersion: t.keyVersion })
        .from(t)
        .where(isNotNull(t.credentialsCiphertext))
        .orderBy(asc(t.id)),
    update: async (row, next) => {
      const result = await db
        .update(t)
        .set({ credentialsCiphertext: next.ciphertext, credentialsIv: next.iv, keyVersion: next.keyVersion })
        .where(
          and(
            eq(t.id, row.id),
            eq(t.credentialsCiphertext, row.ciphertext),
            versionMatches(t.keyVersion, row.keyVersion),
          ),
        );
      return result.rowCount ?? 0;
    },
  };
}

function channelWalk(db: BmsTx | BmsDb): TableWalk {
  const t = notificationChannels;
  return {
    table: "notification_channels",
    select: () =>
      db
        .select({ id: t.id, ciphertext: t.secretCiphertext, iv: t.secretIv, keyVersion: t.secretKeyVersion })
        .from(t)
        .where(isNotNull(t.secretCiphertext))
        .orderBy(asc(t.id)),
    update: async (row, next) => {
      const result = await db
        .update(t)
        .set({ secretCiphertext: next.ciphertext, secretIv: next.iv, secretKeyVersion: next.keyVersion })
        .where(
          and(
            eq(t.id, row.id),
            eq(t.secretCiphertext, row.ciphertext),
            versionMatches(t.secretKeyVersion, row.keyVersion),
          ),
        );
      return result.rowCount ?? 0;
    },
  };
}
