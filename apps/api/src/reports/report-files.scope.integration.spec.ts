import { sql } from "drizzle-orm";

import type { ReportFileDto } from "@bms/shared";

import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import {
  admin,
  assert,
  discard,
  PERIOD,
  recordingClient,
  type ReportFileIntegrationFixtures,
  service,
} from "./report-files.integration.spec";

/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — the on-demand save's site filter
 * against Postgres and MinIO, on `report-files.integration.spec.ts`'s
 * fixtures (seeded ids by code, the recording client, the id-bounded sweep).
 * The global admin saves ESKOM's report filtered to `RSMOC-WC`, the one
 * location `wc-admin@bms.local` holds: the row records `{RSMOC-WC}`, and the
 * R-7 list predicate (`location_ids <@ writable`) then lists it to `wc-admin`
 * — a file the same admin saved unfiltered (`{}`) it never lists. Every file
 * this run saves is discarded in `finally` and swept again by id in
 * `afterAll`. Vitest entry point: the sibling `.test.ts`.
 */

type FilteredRun = { readonly filtered: ReportFileDto; readonly storedLocationIds: readonly string[]; readonly wcList: readonly string[] };

async function saveFilteredToWc(fx: ReportFileIntegrationFixtures): Promise<FilteredRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const filtered = await svc.saveOnDemand(admin(), { ...PERIOD, format: "pdf", organizationId: fx.eskomId, locationIds: [fx.wcId] });
  fx.createdFileIds.push(filtered.id);
  try {
    // bms_fleet (BYPASSRLS): the stored column as written, not as a policy shows it.
    const stored = await fx.fleetDb.execute<{ location_ids: string[] }>(
      sql`select location_ids from bms.report_files where id = ${filtered.id}::uuid`,
    );
    const wcList = (await svc.list(jwtFor(SEEDED.locationAdmin, "location_admin"), 200)).map((row) => row.id);
    return { filtered, storedLocationIds: stored.rows[0]?.location_ids ?? [], wcList };
  } finally {
    await discard(fx, filtered.id, recorder.putKeys[0] ?? null);
  }
}

/** The saved row's `location_ids` is the named site, as `bms_fleet` reads it. */
export async function aSiteFilteredSaveStoresTheNamedSite(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await saveFilteredToWc(fx);
  assert(
    JSON.stringify(run.storedLocationIds) === JSON.stringify([fx.wcId]),
    `the stored location_ids must be {RSMOC-WC}; got ${JSON.stringify(run.storedLocationIds)}`,
  );
}

/** `wc-admin` lists the admin's file filtered to its own site (it never lists the admin's `{}` file). */
export async function theSitesLocationAdminListsTheFilteredFile(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await saveFilteredToWc(fx);
  assert(run.wcList.includes(run.filtered.id), "wc-admin's list must contain the admin's file filtered to RSMOC-WC");
}
