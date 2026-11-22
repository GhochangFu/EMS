import { writeFileSync } from "node:fs";

import pg from "pg";

import {
  buildEdgeConfigExport,
  edgeExportWriteOptions,
  parseEdgeExportArgs,
  type EdgeExportRtu,
} from "./edge-config-export";

/**
 * `F1.2` (ADR 0141 decision 17, plan T7.5) — writes an edge box's `EDGE_CONFIG_FILE` for one edge
 * gateway: `--organization <code> --gateway <code> [--out <file>]`. The file goes to `--out` or
 * stdout; what was left out (an RTU and why, a register no point maps) goes to stderr, so the
 * operator sees why. Exit 1 when the arguments are wrong, the gateway is unknown or nothing can be
 * exported. Run it with `tsx packages/db/src/edge-config-export-cli.ts …` or, built,
 * `node packages/db/dist/edge-config-export-cli.js …`.
 *
 * Read-only: three SELECTs in a READ ONLY transaction. Connects as `DATABASE_URL_FLEET`
 * (`bms_fleet`), which **bypasses row-level security**: the isolation is the `WHERE` clauses, each
 * of which names the organization (and the gateway) it was asked for. It falls back to
 * `DATABASE_URL`; there the organization GUC set after the first lookup is what lets the RTU and
 * gateway reads see that organization's rows. The first lookup runs before the GUC is set and
 * cannot be hidden by it: `bms.organizations` carries no row-level policy (it is the tenant table
 * itself). Writes no credential: Modbus carries none (decision 11). `--out` writes the file `0600`
 * and refuses an existing file unless `--force`.
 */

export const EXPORT_ORGANIZATION_SQL = `
SELECT id, default_poll_interval_ms FROM bms.organizations WHERE code = $1`;

export const EXPORT_GATEWAY_SQL = `
SELECT id, status FROM bms.edge_gateways WHERE organization_id = $1 AND code = $2`;

/** The gateway's RTUs, each with its connection row and its active measured points' source keys. */
export const EXPORT_RTUS_SQL = `
SELECT r.code, r.rtu_code, r.active, r.ingest_enabled, c.protocol, c.config,
       coalesce(array_agg(DISTINCT ap.source_data_key) FILTER (WHERE ap.source_data_key IS NOT NULL), '{}') AS mapped
  FROM bms.rtus r
  LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
  LEFT JOIN bms.asset_points ap
         ON ap.rtu_id = r.id AND ap.active = true AND ap.source_kind = 'measured'
 WHERE r.organization_id = $1 AND r.edge_gateway_id = $2
 GROUP BY r.id, r.code, r.rtu_code, r.active, r.ingest_enabled, c.protocol, c.config
 ORDER BY r.code`;

async function main(): Promise<number> {
  const args = parseEdgeExportArgs(process.argv.slice(2));
  if (!args.ok) {
    process.stderr.write(`${args.message}\n`);
    return 1;
  }
  const url = process.env.DATABASE_URL_FLEET ?? process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL_FLEET or DATABASE_URL is required\n");
    return 1;
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const organization = await client.query<{ id: string; default_poll_interval_ms: number | null }>(
      EXPORT_ORGANIZATION_SQL,
      [args.organization],
    );
    const org = organization.rows[0];
    if (!org) {
      process.stderr.write(`no organization with code ${args.organization}\n`);
      return 1;
    }
    await client.query("SELECT set_config('app.current_organization', $1, true)", [org.id]);
    const gateway = (await client.query<{ id: string; status: string }>(EXPORT_GATEWAY_SQL, [org.id, args.gateway])).rows[0];
    if (!gateway) {
      process.stderr.write(`no edge gateway with code ${args.gateway} in ${args.organization}\n`);
      return 1;
    }
    if (gateway.status !== "active") {
      process.stderr.write(`warning: edge gateway ${args.gateway} is ${gateway.status}\n`);
    }
    const rows = await client.query<{
      code: string;
      rtu_code: string | null;
      active: boolean;
      ingest_enabled: boolean;
      protocol: string | null;
      config: unknown;
      mapped: string[];
    }>(EXPORT_RTUS_SQL, [org.id, gateway.id]);
    await client.query("COMMIT");

    const rtus: EdgeExportRtu[] = rows.rows.map((row) => ({
      code: row.code,
      rtuCode: row.rtu_code,
      active: row.active,
      ingestEnabled: row.ingest_enabled,
      protocol: row.protocol,
      config: row.config,
      mappedSourceKeys: row.mapped,
    }));
    const result = buildEdgeConfigExport({ organizationDefaultPollIntervalMs: org.default_poll_interval_ms, rtus });
    for (const skipped of result.notExported) {
      process.stderr.write(`not exported: ${skipped.code}: ${skipped.reason}\n`);
    }
    for (const omitted of result.omittedRegisters) {
      process.stderr.write(
        `registers left out of ${omitted.code} (no active point maps them; a new mapping needs a new export): ${omitted.sourceKeys.join(", ")}\n`,
      );
    }
    if (result.file === null) {
      process.stderr.write(`nothing to export: gateway ${args.gateway} has no exportable Modbus TCP RTU\n`);
      return 1;
    }
    const text = `${JSON.stringify(result.file, null, 2)}\n`;
    if (args.out === null) {
      process.stdout.write(text);
    } else {
      writeFileSync(args.out, text, edgeExportWriteOptions(args.force));
      const devices = result.file.endpoints.reduce((n, endpoint) => n + endpoint.devices.length, 0);
      process.stderr.write(`wrote ${args.out}: ${result.file.endpoints.length} endpoint(s), ${devices} device(s)\n`);
    }
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
