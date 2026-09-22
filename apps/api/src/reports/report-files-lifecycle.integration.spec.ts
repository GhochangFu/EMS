import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { vi } from "vitest";

import { reportFiles } from "@bms/db";
import type { ReportFileDto } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { BmsTx } from "../database/tenant-context";
import { withTenant } from "../database/tenant-context";
import { buildReportObjectKey, OBJECT_KEY_PREFIX } from "../storage/object-key";
import { deleteObject, headObject } from "../storage/storage-client";
import { withRollback } from "../testing/with-rollback";
import {
  AUDIT_PAYLOAD_KEYS,
  AuditProbeError,
  PERIOD,
  admin,
  assert,
  captureRejection,
  capturingWarns,
  countFileRow,
  countFilesForOrganization,
  discard,
  errorMessage,
  errorName,
  readAuditRows,
  recordingClient,
  saveAsAdmin,
  service,
  sha256Of,
  type AuditRow,
  type ReportFileIntegrationFixtures,
} from "./report-files.integration.spec";

/**
 * `F3.5a` — the second half of the report-file integration suite: the `0077`
 * policy both directions (and its `42501` refusal under `withRollback`), the cap
 * against committed rows, `remove` row-then-object, decision 11's orphan on
 * a real endpoint, the failed-row cleanup, the R-9 audit rows and decision
 * 5's last sentence. The helpers, the fixtures type and the docblock that
 * explains the two connections and the cleanup live in
 * `report-files.integration.spec.ts`; this file exists because the one
 * file crossed AGENTS.md §4.5's 1000-line cap, and the split is by subject
 * (rows 1–6 there are the save, the scope and the list; rows 7–14 here are
 * the policy and the lifecycle), and the rollback-isolated policy case sits
 * here so the first file's seed-expectation read of `bms.assets` stays
 * outside `tests/integration-fixture-isolation.test.ts`'s scan. Each spec
 * has its own `.test.ts` wrapper over the one shared lifecycle
 * (`openReportFileFixtures`); every count is scoped to this run's own ids,
 * because the two wrappers run in parallel.
 */

function setTenant(tx: BmsTx, organizationId: string): Promise<unknown> {
  return tx.execute(sql`select set_config('app.current_organization', ${organizationId}, true)`);
}

/** The SQLSTATE of a database rejection, dug out of the error **and its cause**. */
function sqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Rows 7, 8 — the 0077 policy, both directions, on a real bms_tenant connection
// ---------------------------------------------------------------------------

/** The tenant policy hides ESKOM's row under PHEWB's GUC and shows it under ESKOM's — scoped to the file id. */
export async function theTenantPolicyHidesTheRowUnderTheOtherOrganization(fx: ReportFileIntegrationFixtures): Promise<void> {
  const recorder = recordingClient(fx);
  const dto = await saveAsAdmin(fx, service(fx, recorder.client));
  try {
    const underPhewb = await withTenant(fx.tenantDb, fx.phewbId, (tx) => countFileRow(tx, dto.id));
    const underEskom = await withTenant(fx.tenantDb, fx.eskomId, (tx) => countFileRow(tx, dto.id));
    assert(underEskom === 1, `the positive control failed: under ESKOM's GUC the row count is ${underEskom}`);
    assert(underPhewb === 0, `under PHEWB's GUC the ESKOM row must be hidden; count ${underPhewb}`);
  } finally {
    await discard(fx, dto.id, recorder.putKeys[0] ?? null);
  }
}

/** The service's own `values` shape, ids apart. */
function serviceValues(fileId: string, organizationId: string, createdBy: string): typeof reportFiles.$inferInsert {
  const bytes = Buffer.from("%PDF-1.4 probe");
  return {
    id: fileId,
    organizationId,
    templateId: "energy_consumption",
    format: "pdf",
    periodStart: PERIOD.startDate,
    periodEnd: PERIOD.endDate,
    locationIds: [],
    objectKey: buildReportObjectKey({ organizationId, fileId }),
    contentType: "application/pdf",
    byteSize: bytes.length,
    sha256: sha256Of(bytes),
    filename: "energy-consumption-probe.pdf",
    deliveryStatus: "none",
    deliveryError: null,
    createdBy,
  };
}

type RlsRun = { readonly crossOrg: unknown; readonly sameOrg: number };

/**
 * F3.4 R-6's negative for `0077`: under ESKOM's GUC, a row stamped
 * `organization_id = PHEWB` is refused by the `WITH CHECK`, and the
 * correctly-stamped row in the same transaction lands. The refused insert runs
 * inside a SAVEPOINT so the control does not die with `25P02`. Nothing
 * commits: the case ends with `tx.rollback()`.
 */
async function runRlsStamp(fx: ReportFileIntegrationFixtures): Promise<RlsRun> {
  let crossOrg: unknown;
  let sameOrg = -1;
  await withRollback(fx.tenantDb, async (tx) => {
    await setTenant(tx, fx.eskomId);
    crossOrg = await captureRejection(() =>
      tx.transaction((inner) => inner.insert(reportFiles).values(serviceValues(randomUUID(), fx.phewbId, fx.adminUserId))),
    );
    const sameId = randomUUID();
    await tx.insert(reportFiles).values(serviceValues(sameId, fx.eskomId, fx.adminUserId));
    sameOrg = await countFileRow(tx, sameId);
    await tx.rollback();
  });
  return { crossOrg, sameOrg };
}

/** `42501` — `insufficient_privilege`, the code Postgres answers a `WITH CHECK` violation with. */
export async function theInsertStampedWithAForeignOrganizationIs42501(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRlsStamp(fx);
  const state = sqlState(run.crossOrg);
  assert(
    state === "42501",
    `a row stamped PHEWB under ESKOM's GUC must be refused with SQLSTATE 42501; got ${String(state)} (${errorName(run.crossOrg)})`,
  );
}

/** The adjacent positive control: the correctly-stamped insert lands. */
export async function theCorrectlyStampedInsertIsAccepted(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRlsStamp(fx);
  assert(
    run.sameOrg === 1,
    `the same insert stamped ESKOM must land; saw ${run.sameOrg} rows — the refusal above would otherwise be ` +
      "consistent with the policy refusing everything",
  );
}

// ---------------------------------------------------------------------------
// Row 9 — the cap against committed rows
// ---------------------------------------------------------------------------

type CapRun = {
  readonly err: unknown;
  readonly rendersDelta: number;
  readonly callsDelta: readonly string[];
  readonly countBefore: number;
  readonly countAfter: number;
  readonly putCount: number;
  readonly heads: readonly ({ contentLength: number } | null)[];
};

/**
 * R-11 on real rows, in PHEWB so the ESKOM rows of other cases never move the
 * threshold: `onDemandCap = <count before> + 2`, two saves land, the third is
 * refused. Every row and object is removed in `finally`.
 */
async function runCap(fx: ReportFileIntegrationFixtures): Promise<CapRun> {
  const recorder = recordingClient(fx);
  const countBefore = await countFilesForOrganization(fx.fleetDb, fx.phewbId);
  const svc = service(fx, recorder.client, {
    config: {
      onDemandCap: countBefore + 2,
      retentionPerSchedule: 24,
      emailMaxBytes: 10_485_760,
      historyUrl: null,
    },
  });
  const renderSpy = vi.spyOn(fx.reports, "energyPdf");
  const saved: ReportFileDto[] = [];
  try {
    saved.push(await saveAsAdmin(fx, svc, "pdf", fx.phewbId));
    saved.push(await saveAsAdmin(fx, svc, "pdf", fx.phewbId));
    const rendersBefore = renderSpy.mock.calls.length;
    const callsBefore = recorder.calls.length;
    const err = await captureRejection(() =>
      svc.saveOnDemand(admin(), { ...PERIOD, format: "pdf", organizationId: fx.phewbId }),
    );
    const heads: ({ contentLength: number } | null)[] = [];
    for (const key of recorder.putKeys) {
      heads.push(await headObject(fx.client, key));
    }
    return {
      err,
      rendersDelta: renderSpy.mock.calls.length - rendersBefore,
      callsDelta: recorder.calls.slice(callsBefore),
      countBefore,
      countAfter: await countFilesForOrganization(fx.fleetDb, fx.phewbId),
      putCount: recorder.putKeys.length,
      heads,
    };
  } finally {
    renderSpy.mockRestore();
    for (const [index, dto] of saved.entries()) {
      await discard(fx, dto.id, recorder.putKeys[index] ?? null);
    }
  }
}

/** The save past the cap is a 409. */
export async function theCapRefusesTheSavePastIt(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runCap(fx);
  assert(errorName(run.err) === "ConflictException", `the third save must be a ConflictException; got ${errorName(run.err)}`);
}

/** …before the render and before any storage call (the fleet pre-check runs first). */
export async function theCapRefusesBeforeTheRenderAndThePut(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runCap(fx);
  // The positive control for the two absences: the two admitted saves did render and put.
  assert(run.putCount === 2, `the positive control failed: ${run.putCount} puts, expected 2`);
  assert(run.rendersDelta === 0, `the refused save must not render; ${run.rendersDelta} render(s)`);
  assert(run.callsDelta.length === 0, `the refused save must make no S3 call; delta ${run.callsDelta.join(", ")}`);
}

/** …and leaves exactly the cap behind: `before + 2` rows as fleet, and both objects present. */
export async function theCapLeavesExactlyTheCapBehind(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runCap(fx);
  assert(
    run.countAfter === run.countBefore + 2,
    `PHEWB must hold exactly ${run.countBefore + 2} rows; the fleet count is ${run.countAfter}`,
  );
  assert(
    run.heads.length === 2 && run.heads.every((head) => head !== null),
    `both put keys must be in the bucket; heads: ${run.heads.map((h) => String(h?.contentLength)).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Rows 10, 11 — remove: row then object, and decision 11 on a real endpoint
// ---------------------------------------------------------------------------

type RemoveRun = {
  readonly rowBefore: number;
  readonly rowAfter: number;
  readonly headBefore: { contentLength: number } | null;
  readonly headAfter: { contentLength: number } | null;
  readonly again: unknown;
};

async function runRemove(fx: ReportFileIntegrationFixtures): Promise<RemoveRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const dto = await saveAsAdmin(fx, svc);
  const key = recorder.putKeys[0] as string;
  try {
    const rowBefore = await countFileRow(fx.fleetDb, dto.id);
    const headBefore = await headObject(fx.client, key);
    await svc.remove(admin(), dto.id);
    return {
      rowBefore,
      rowAfter: await countFileRow(fx.fleetDb, dto.id),
      headBefore,
      headAfter: await headObject(fx.client, key),
      again: await captureRejection(() => svc.remove(admin(), dto.id)),
    };
  } finally {
    await discard(fx, dto.id, key);
  }
}

/** `remove` takes the row out — read as fleet, with the control that it was there. */
export async function removeDeletesTheRow(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRemove(fx);
  assert(run.rowBefore === 1, `the positive control failed: the saved row's count was ${run.rowBefore}`);
  assert(run.rowAfter === 0, `remove must delete the row; the fleet count is ${run.rowAfter}`);
}

/** …and the object: `headObject` on the key answers null. */
export async function removeDeletesTheObject(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRemove(fx);
  assert(run.headBefore !== null, "the positive control failed: the saved object was not in the bucket");
  assert(run.headAfter === null, "remove must delete the object; headObject still answers a length");
}

/** A second `remove` of the same id is 404. */
export async function aSecondRemoveIs404(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runRemove(fx);
  assert(errorName(run.again) === "NotFoundException", `a second remove must be 404; got ${errorName(run.again)}`);
}

type OrphanRun = {
  readonly fileId: string;
  readonly rowAfter: number;
  readonly head: { contentLength: number } | null;
  readonly warns: readonly string[];
};

/**
 * Decision 11 on the real endpoint: the object delete fails after the row is
 * gone. `remove` resolves, warns once, and the orphan really stays in the
 * bucket — which is why this row deletes it by hand in `finally`.
 */
async function runOrphanedRemove(fx: ReportFileIntegrationFixtures): Promise<OrphanRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const dto = await saveAsAdmin(fx, svc);
  const key = recorder.putKeys[0] as string;
  try {
    // Only now, so the save's own put still reached the bucket.
    recorder.state.failDeletes = true;
    const { warns } = await capturingWarns(() => svc.remove(admin(), dto.id));
    recorder.state.failDeletes = false;
    return { fileId: dto.id, rowAfter: await countFileRow(fx.fleetDb, dto.id), head: await headObject(fx.client, key), warns };
  } finally {
    recorder.state.failDeletes = false;
    await discard(fx, dto.id, key);
  }
}

/** The method resolves and the row is gone: the transaction had already committed. */
export async function removeResolvesWithTheRowGoneWhenTheObjectDeleteFails(fx: ReportFileIntegrationFixtures): Promise<void> {
  // `runOrphanedRemove` awaits `remove` without catching, so reaching its result is the resolve claim.
  const run = await runOrphanedRemove(fx);
  assert(run.rowAfter === 0, `the row must be gone even when the object delete failed; count ${run.rowAfter}`);
}

/** Decision 11: the orphan object really is left behind — that is the tolerated cost. */
export async function theOrphanObjectStaysInTheBucket(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  assert(run.head !== null, "the object must still exist after a failed delete; a null head means the 'failed' delete removed it");
}

/** One warn, naming the file id — the id is what an operator can act on. */
export async function theOrphanWarnNamesTheFileIdOnce(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  assert(run.warns.length === 1, `expected one warn, saw ${run.warns.length}: ${run.warns.join(" | ")}`);
  assert(run.warns[0]?.includes(run.fileId) === true, `the warn must name the file id; got: ${String(run.warns[0])}`);
}

/** …and never the key (§9.6): the prefix and the organization id are both absent. */
export async function theOrphanWarnNeverNamesTheKey(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runOrphanedRemove(fx);
  const joined = run.warns.join("\n");
  // The positive control lives in the row above: one warn, and it names the id.
  assert(
    !joined.includes(OBJECT_KEY_PREFIX) && !joined.includes(fx.eskomId),
    `the warn must carry no part of the object key; got: ${joined}`,
  );
}

// ---------------------------------------------------------------------------
// Row 12 — the cleanup after a failed row is real
// ---------------------------------------------------------------------------

type FailedRowRun = {
  readonly err: unknown;
  readonly putCount: number;
  readonly calls: readonly string[];
  readonly head: { contentLength: number } | null;
};

/**
 * R-12 measured against the bucket: the audit write inside the tenant
 * transaction throws once, so the transaction rolls back after `putObject`
 * already landed — the window decision 4 tolerates an orphan in — and the
 * service's cleanup has to really remove the object.
 */
async function runFailedRowWrite(fx: ReportFileIntegrationFixtures): Promise<FailedRowRun> {
  const recorder = recordingClient(fx);
  const audit = new MasterDataAuditService(fx.tenantDb, fx.fleetDb);
  const spy = vi.spyOn(audit, "write").mockRejectedValueOnce(new AuditProbeError("probe: the audit write was refused"));
  const svc = service(fx, recorder.client, { audit });
  let key: string | null = null;
  try {
    const err = await captureRejection(() =>
      svc.saveOnDemand(admin(), { ...PERIOD, format: "pdf", organizationId: fx.eskomId }),
    );
    key = recorder.putKeys[0] ?? null;
    return {
      err,
      putCount: recorder.putKeys.length,
      calls: recorder.calls,
      head: key === null ? null : await headObject(fx.client, key),
    };
  } finally {
    spy.mockRestore();
    if (key !== null) {
      await deleteObject(fx.client, key).catch(() => undefined);
    }
  }
}

/** The failure reaches the caller by its own name — the service rethrows, it does not swallow. */
export async function aFailedRowWriteRejectsWithTheOriginalError(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runFailedRowWrite(fx);
  assert(errorName(run.err) === "AuditProbeError", `the original error must reach the caller by name; got ${errorName(run.err)}`);
}

/** …and the object it had already put is really gone from the bucket. */
export async function aFailedRowLeavesNoObject(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runFailedRowWrite(fx);
  // The positive controls for the absence: the object was really put, and the cleanup really ran.
  assert(run.putCount === 1, `the positive control failed: ${run.putCount} puts, expected 1`);
  assert(run.calls.includes("deleteObject"), `the cleanup never ran; calls: ${run.calls.join(", ")}`);
  assert(run.head === null, `headObject on the cleaned-up key must answer null; got ${String(run.head?.contentLength)} bytes`);
}

// ---------------------------------------------------------------------------
// Row 13 — the audit rows carry ids only (R-9)
// ---------------------------------------------------------------------------

type AuditRun = { readonly filename: string; readonly rows: readonly AuditRow[] };

/** Save then remove; the `bms.audit_log` rows for that file, read as fleet. */
async function runAuditPair(fx: ReportFileIntegrationFixtures): Promise<AuditRun> {
  const recorder = recordingClient(fx);
  const svc = service(fx, recorder.client);
  const dto = await saveAsAdmin(fx, svc);
  try {
    await svc.remove(admin(), dto.id);
    return { filename: dto.filename, rows: await readAuditRows(fx.fleetDb, dto.id) };
  } finally {
    await discard(fx, dto.id, recorder.putKeys[0] ?? null);
  }
}

/** Exactly `report_file.create` and `report_file.delete`, one each. */
export async function auditWritesTheCreateAndDeleteRows(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAuditPair(fx);
  const actions = run.rows.map((row) => row.action);
  assert(
    actions.length === 2 && actions[0] === "report_file.create" && actions[1] === "report_file.delete",
    `expected report_file.create and report_file.delete; got ${actions.join(", ")}`,
  );
}

/** E7.1c: both rows carry ESKOM and resolve the actor to the seeded admin. */
export async function auditRowsCarryTheOrganizationAndTheActor(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAuditPair(fx);
  assert(run.rows.length > 0, "the positive control failed: no audit rows at all");
  for (const row of run.rows) {
    assert(row.organization_id === fx.eskomId, `${row.action}: organization_id must be ESKOM; got ${String(row.organization_id)}`);
    assert(row.actor_id === fx.adminUserId, `${row.action}: actor_id must be the seeded admin; got ${String(row.actor_id)}`);
  }
}

/** R-9 / §9.6: payload keys ⊆ the R-9 set, and no value is the filename. */
export async function auditPayloadsCarryIdsOnly(fx: ReportFileIntegrationFixtures): Promise<void> {
  const run = await runAuditPair(fx);
  assert(run.rows.length > 0, "the positive control failed: no audit rows at all");
  for (const row of run.rows) {
    const payload = row.payload ?? {};
    const keys = Object.keys(payload);
    assert(keys.includes("fileId"), `${row.action}: the positive control failed — the payload has no fileId`);
    const extra = keys.filter((k) => !AUDIT_PAYLOAD_KEYS.has(k));
    assert(extra.length === 0, `${row.action}: payload carries keys outside R-9: ${extra.join(", ")}`);
    const leaked = Object.values(payload).filter((v) => v === run.filename);
    assert(leaked.length === 0, `${row.action}: the payload carries the filename`);
  }
}

// ---------------------------------------------------------------------------
// Row 14 — decision 5's last sentence, both halves
// ---------------------------------------------------------------------------

/** An unconfigured client: `list` is 503 naming the variable. */
export async function unconfiguredStorageAnswers503(fx: ReportFileIntegrationFixtures): Promise<void> {
  const svc = service(fx, { kind: "unconfigured" });
  const err = await captureRejection(() => svc.list(admin(), 50));
  assert(errorName(err) === "ServiceUnavailableException", `list must be 503; got ${errorName(err)}`);
  assert(errorMessage(err).includes("OBJECT_STORAGE_ENDPOINT"), `the 503 must name OBJECT_STORAGE_ENDPOINT; got: ${errorMessage(err)}`);
}

/** …while the direct PDF export still renders (decision 5's last sentence). */
export async function theExportStillAnswersWithoutStorage(fx: ReportFileIntegrationFixtures): Promise<void> {
  const pdf = await fx.reports.energyPdf({ ...PERIOD }, null);
  assert(pdf.subarray(0, 5).toString("latin1") === "%PDF-", "the direct export must still render a PDF");
}
