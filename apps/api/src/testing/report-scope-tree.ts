import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { jwtFor, rememberSubject } from "./seeded-subjects";

/**
 * `F2.10` — a location tree in an organization this run creates, with a
 * location admin granted one site, for the report-files render-scope row.
 *
 * **Why not RSMOC-WC.** That row compared `wc-admin`'s render scope with
 * RSMOC-WC's assets, and other suites commit and delete fixture assets there
 * (F3.37 `f337-*`, F3.78 `f378-pr4-*`, E2.4 `E24-SEED-*`, ...). In CI three of
 * them existed while the scope was read and were gone before every read after
 * it, so no expectation read from a shared location can be race-free. Nothing
 * but this module writes to the organization below, so the expected set is
 * exact.
 *
 * The shape: `root` ── `site` (asset) ── `child` (asset), and `root` ──
 * `sibling` (asset). The location admin holds `site` only, so its scope is
 * `site`'s subtree: the child's asset is in it (a grant means the subtree,
 * ADR 0018 / ADR 0098 decision 4) and the sibling's is not.
 *
 * Users need the superuser pool (`bms_fleet` has no grant on `bms.users`). The
 * caller opens and ends it: ADR 0045 lets only a test file import the
 * integration gate that resolves that URL.
 */
export type ReportScopeTree = {
  readonly organizationId: string;
  readonly siteId: string;
  readonly siteAssetId: string;
  readonly childAssetId: string;
  readonly siblingAssetId: string;
  /** A `location_admin` of the organization granted `site` only. */
  readonly locationAdmin: JwtPayload;
  /** Deletes every row the tree and a save in it wrote. */
  drop(): Promise<void>;
};

function fail(message: string): never {
  throw new Error(message);
}

export async function buildReportScopeTree(pool: pg.Pool, label: string): Promise<ReportScopeTree> {
  const run = randomUUID().slice(0, 8).toUpperCase();
  const code = `RSCOPE-${run}`;
  const email = `rscope-${run.toLowerCase()}@integration.invalid`;
  let organizationId = "";

  const drop = async (): Promise<void> => {
    if (organizationId === "") return;
    const org = [organizationId];
    await pool.query(`DELETE FROM bms.audit_log WHERE organization_id = $1`, org);
    await pool.query(`DELETE FROM bms.report_files WHERE organization_id = $1`, org);
    await pool.query(`DELETE FROM bms.user_location_access WHERE user_id IN (SELECT id FROM bms.users WHERE email = $1)`, [email]);
    await pool.query(`DELETE FROM bms.users WHERE email = $1`, [email]);
    await pool.query(`DELETE FROM bms.assets WHERE organization_id = $1`, org);
    // One statement: the composite parent FK is checked at the statement's end.
    await pool.query(`DELETE FROM bms.locations WHERE organization_id = $1`, org);
    const removed = await pool.query(`DELETE FROM bms.organizations WHERE id = $1`, org);
    if (removed.rowCount !== 1) throw new Error(`${label}: expected to delete organization ${code}, deleted ${removed.rowCount}`);
  };

  try {
    const { rows: orgRows } = await pool.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [code, `F2.10 report scope ${code}`],
    );
    organizationId = orgRows[0]?.id ?? fail(`organization ${code} was not inserted`);

    let seq = 0;
    const node = async (parentId: string | null): Promise<string> => {
      seq += 1;
      const nodeCode = `${code}-L${seq}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
         VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5) RETURNING id`,
        [organizationId, nodeCode, nodeCode.toLowerCase(), `F2.10 ${nodeCode}`, parentId],
      );
      return rows[0]?.id ?? fail(`location ${nodeCode} was not inserted`);
    };
    const asset = async (locationId: string): Promise<string> => {
      seq += 1;
      const assetCode = `${code}-A${seq}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $3, 'F2.10 report scope', (SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1))
         RETURNING id`,
        [organizationId, locationId, assetCode],
      );
      return rows[0]?.id ?? fail(`asset ${assetCode} was not inserted`);
    };

    const root = await node(null);
    const siteId = await node(root);
    const siteAssetId = await asset(siteId);
    const child = await node(siteId);
    const childAssetId = await asset(child);
    const sibling = await node(root);
    const siblingAssetId = await asset(sibling);

    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
       VALUES ($1, $2, 'not-a-usable-hash', 'F2.10 report scope location admin', 'location_admin') RETURNING id`,
      [organizationId, email],
    );
    const userId = userRows[0]?.id ?? fail(`user ${email} was not inserted`);
    await pool.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [userId, siteId]);
    rememberSubject(email, userId);

    return {
      organizationId,
      siteId,
      siteAssetId,
      childAssetId,
      siblingAssetId,
      locationAdmin: jwtFor(email, "location_admin"),
      drop,
    };
  } catch (err) {
    await drop();
    throw err;
  }
}
