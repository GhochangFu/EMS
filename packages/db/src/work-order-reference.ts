import { sql } from "drizzle-orm";

import type { BmsDb } from "./client";

/**
 * `E3.1` / ADR 0122 decision 2 (plan D1) — the one place a work order gets its number
 * and its reference.
 *
 * ONE STATEMENT, AND THE UPSERT IS THE LOCK. `INSERT ... ON CONFLICT DO UPDATE` on
 * `bms.work_order_counters` takes the organization's row lock itself, so there is no
 * read-then-write gap and no race for an organization's first ticket. A second
 * transaction waits on the row and reads the bumped value; a rolled-back transaction
 * rolls its bump back with it, so the numbers stay contiguous. Do not replace this with
 * `SELECT max(seq) + 1`: two concurrent creates would read the same maximum.
 *
 * THE PREFIX is the asset's template prefix, else its domain's, else `GEN` (decision
 * 2.5, ruling Q4). It is read here, once, and frozen into `reference`: a later change of
 * the template, the domain or the asset's domain does not move an existing reference.
 *
 * THE WIDTH is at least six digits. `lpad(seq, 6)` alone truncates at seq 1,000,000.
 *
 * Call it inside the transaction that inserts the work order, with
 * `app.current_organization` set to `organizationId` (the tenant pool) or on a role that
 * bypasses row security (the fleet pool, the seed's bracket). Under another
 * organization's setting the counter's `WITH CHECK` refuses the write. The counter row
 * stays locked until that transaction commits, so keep the transaction short: every
 * create in the organization waits behind it.
 */
export type WorkOrderReference = {
  readonly seq: number;
  readonly reference: string;
};

/** Anything that can run one SQL statement: a `BmsDb` or a transaction on one. */
export type WorkOrderReferenceExecutor = Pick<BmsDb, "execute">;

/**
 * Takes the organization's next number and builds the reference for a ticket on
 * `assetId`. Throws when the asset is not this organization's or is not visible.
 */
export async function allocateWorkOrderReference(
  tx: WorkOrderReferenceExecutor,
  organizationId: string,
  assetId: string,
): Promise<WorkOrderReference> {
  const result = await tx.execute(sql`
    WITH bumped AS (
      INSERT INTO bms.work_order_counters (organization_id, next_seq)
      VALUES (${organizationId}::uuid, 2)
      ON CONFLICT (organization_id) DO UPDATE
        SET next_seq = bms.work_order_counters.next_seq + 1,
            updated_at = now()
      RETURNING next_seq - 1 AS seq
    )
    SELECT b.seq::integer AS seq,
           coalesce(t.work_order_prefix, d.work_order_prefix, 'GEN')
             || '-' || lpad(b.seq::text, greatest(6, length(b.seq::text)), '0') AS reference
      FROM bumped b
      JOIN bms.assets a
        ON a.id = ${assetId}::uuid
       AND a.organization_id = ${organizationId}::uuid
      LEFT JOIN bms.asset_templates t ON t.id = a.template_id
      LEFT JOIN bms.asset_domains d ON d.code = a.domain
  `);
  const row = result.rows[0] as { seq?: unknown; reference?: unknown } | undefined;
  if (!row || typeof row.seq !== "number" || typeof row.reference !== "string") {
    // The inner join found no asset: it is not this organization's, or not visible under
    // the current setting. Throwing rolls the caller's transaction back, and the bump
    // with it, so no number is spent and no `GEN` reference is handed out by accident.
    throw new Error("allocateWorkOrderReference: the asset is not visible in this organization");
  }
  return { seq: row.seq, reference: row.reference };
}
