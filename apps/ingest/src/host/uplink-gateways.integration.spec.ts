import pg from "pg";
import { expect } from "vitest";

import { authenticate, hashToken, loadGateways } from "./uplink-gateways.js";

/**
 * `E7.2` / ADR 0123 decision 5, plan T3.1 — the gateway snapshot against real
 * Postgres.
 *
 * **What `uplink-gateways.spec.ts` cannot reach.** That suite hashes with
 * Node on both sides, so it is green if `GATEWAY_QUERY` names a column
 * migration `0141` does not have, and green if the admin mint (PR 6) and the
 * receiver ever disagree on what "SHA-256 of the token" means — UTF-8 bytes or
 * not, raw digest or hex text. This plants a hash with Postgres's own
 * `sha256(convert_to(…, 'UTF8'))` and authenticates the token through the
 * real query.
 *
 * **Nothing commits.** One client, one `BEGIN … ROLLBACK`, the
 * `normaliser.integration.spec.ts` shape; `bms_fleet` (the host's role)
 * inserts the fixture through migration `0041`'s default privileges. The
 * fixture sits in the seeded `ESKOM` organization and assigns no RTU.
 */

/** A valid token shape; the fixture's own, never minted anywhere. */
const FIXTURE_TOKEN = `bmsgw_${"E72uplinkFixture".padEnd(43, "x")}`;
const FIXTURE_CODE = "E72-UPLINK-AUTH-FIXTURE";

/** Postgres's SHA-256 of the token equals Node's, and authenticates through `GATEWAY_QUERY`. */
export async function assertPostgresSha256AuthenticatesThroughTheQuery(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const org = await client.query<{ id: string }>(
        "SELECT id FROM bms.organizations WHERE code = 'ESKOM'",
      );
      expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms.edge_gateways (organization_id, code, name, token_hash)
         VALUES ($1, $2, 'E7.2 uplink auth fixture', sha256(convert_to($3::text, 'UTF8')))
         RETURNING id`,
        [org.rows[0].id, FIXTURE_CODE, FIXTURE_TOKEN],
      );
      const id = inserted.rows[0].id;

      const snapshot = await loadGateways(client);
      const mine = snapshot.gateways.find((g) => g.id === id);
      expect(mine, "GATEWAY_QUERY did not return the fixture gateway").toBeDefined();
      expect(mine?.tokenHash?.toString("hex"), "Postgres sha256 and Node's digest disagree").toBe(
        hashToken(FIXTURE_TOKEN).toString("hex"),
      );
      expect(mine?.status).toBe("active");
      expect(mine?.organizationCode).toBe("ESKOM");
      expect(mine?.rtuCount, "the fixture assigns no RTU").toBe(0);
      expect(mine?.lastSeenAt).toBeNull();
      expect(mine?.backfillDirtyFrom).toBeNull();

      const outcome = authenticate(snapshot, `Bearer ${FIXTURE_TOKEN}`);
      const organizationOn = mine?.organizationIngestEnabled === true;
      if (organizationOn) {
        expect(outcome.ok && outcome.gateway.id === id, "the planted token did not authenticate").toBe(true);
      } else {
        expect(outcome.ok ? "ok" : outcome.reason).toBe("ingest-disabled");
      }

      await client.query("UPDATE bms.edge_gateways SET status = 'revoked' WHERE id = $1", [id]);
      const revoked = authenticate(await loadGateways(client), `Bearer ${FIXTURE_TOKEN}`);
      expect(revoked.ok ? "ok" : revoked.reason, "a revoked row must answer gateway-revoked").toBe(
        "gateway-revoked",
      );
    } finally {
      await client.query("ROLLBACK");
    }
    const left = await client.query("SELECT 1 FROM bms.edge_gateways WHERE code = $1", [FIXTURE_CODE]);
    expect(left.rows.length, "the fixture gateway survived ROLLBACK").toBe(0);
  } finally {
    client.release();
  }
}
