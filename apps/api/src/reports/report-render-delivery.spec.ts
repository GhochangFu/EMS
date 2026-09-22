import { OBJECT_KEY_PREFIX } from "../storage/object-key";
import {
  assert,
  ASSET_B,
  capturingLogs,
  CHANNEL_ID,
  emailChannel,
  FILE_PDF,
  FILE_XLSX,
  harness,
  KEY_PDF,
  KEY_PRUNED_A,
  KEY_PRUNED_B,
  KEY_XLSX,
  lastUpdate,
  namedError,
  ORG_ID,
  PDF_BYTES,
  PDF_TYPE,
  PRUNED_A,
  PRUNED_B,
  renderedOutcome,
  SCHEDULE_ID,
  SCHEDULE_NAME,
  SMTP_ERROR,
  XLSX_BYTES,
  XLSX_TYPE,
} from "./report-render.service.spec";

/**
 * `F3.5b` (ADR 0071 decision 10; plan R-9, R-11) — `ReportRenderService.finish`
 * (phases B and C) over `report-render.service.spec.ts`'s harness: the
 * pruned objects, the read-back attachments, the subject and body, the R-11
 * outcome table, the ceiling, the second tenant transaction and the retry
 * predicate. Assertions live here; `report-render-delivery.test.ts` is the
 * Vitest entry point (§4.6). Split from the phase-A spec for AGENTS.md §4.5.
 */

// ---------------------------------------------------------------------------
// Phase B — the pruned objects
// ---------------------------------------------------------------------------

export async function assertFinishDeletesThePrunedObjects(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ prunedKeys: new Map([[PRUNED_A, KEY_PRUNED_A], [PRUNED_B, KEY_PRUNED_B]]) }));
  assert(JSON.stringify(h.deleteKeys) === JSON.stringify([KEY_PRUNED_A, KEY_PRUNED_B]), `expected both pruned keys deleted, got ${JSON.stringify(h.deleteKeys)}`);
}

export async function assertFinishDeleteFailureResolves(): Promise<void> {
  const h = harness({ deleteObject: async () => { throw namedError("NoSuchBucket"); } });
  await h.service.finish(renderedOutcome({ prunedKeys: new Map([[PRUNED_A, KEY_PRUNED_A]]) }));
  assert(h.calls.includes("email:send"), "expected finish to carry on to delivery after a failed delete");
}

export async function assertFinishDeleteFailureWarnsWithTheFileIdAndNoKey(): Promise<void> {
  const h = harness({ deleteObject: async () => { throw namedError("NoSuchBucket"); } });
  const { warns } = await capturingLogs(() => h.service.finish(renderedOutcome({ prunedKeys: new Map([[PRUNED_A, KEY_PRUNED_A]]) })));
  assert(
    warns.length === 1 && warns[0]!.includes(PRUNED_A) && warns[0]!.includes("NoSuchBucket") && !warns[0]!.includes(OBJECT_KEY_PREFIX),
    `expected one warn naming the file id and err.name and no key, got ${JSON.stringify(warns)}`,
  );
}

export async function assertSkippedOutcomeFinishesWithoutATransaction(): Promise<void> {
  const h = harness();
  await h.service.finish({ kind: "skipped", reason: "absent" });
  assert(h.calls.length === 0, `expected nothing, got ${h.calls.join(",")}`);
}

// ---------------------------------------------------------------------------
// Phase B — attachments, subject, body
// ---------------------------------------------------------------------------

export async function assertFinishReadsAttachmentsBackFromStorageInFormatOrder(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  assert(JSON.stringify(h.getKeys) === JSON.stringify([KEY_PDF, KEY_XLSX]), `expected getObject for pdf then xlsx, got ${JSON.stringify(h.getKeys)}`);
}

export async function assertAttachmentsAreFilenameContentTypeAndBodyPerRow(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const attachments = h.email.messages[0]?.attachments ?? [];
  const shape = attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, body: a.body.toString() }));
  const expected = [
    { filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf", contentType: PDF_TYPE, body: PDF_BYTES.toString() },
    { filename: "energy-consumption-2026-09-01-to-2026-09-07.xlsx", contentType: XLSX_TYPE, body: XLSX_BYTES.toString() },
  ];
  assert(JSON.stringify(shape) === JSON.stringify(expected), `expected the two attachments in format order, got ${JSON.stringify(shape)}`);
}

export async function assertTheSubjectIsTheNameAndThePeriod(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  assert(h.email.messages[0]?.subject === `${SCHEDULE_NAME} — 2026-09-01 to 2026-09-07`, `got subject ${JSON.stringify(h.email.messages[0]?.subject)}`);
}

export async function assertTheBodyHasTheFourSummaryLines(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const lines = (h.email.messages[0]?.body ?? "").split("\n");
  const expected = ["Total energy: 2345.17 kWh", "Peak demand: 414.66 kW", "PUE estimate: 1.25", "Indicative cost: ZAR 5042.12"];
  assert(JSON.stringify(lines.slice(0, 4)) === JSON.stringify(expected), `expected the four summary lines, got ${JSON.stringify(lines)}`);
}

export async function assertThePreviewRunsOnTheSameScope(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ assetIds: [ASSET_B] }));
  const preview = h.reports.calls.find((c) => c.method === "energyPreview");
  assert(JSON.stringify(preview?.assetIds) === JSON.stringify([ASSET_B]) && JSON.stringify(preview?.query) === JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-07" }), `got ${JSON.stringify(preview)}`);
}

export async function assertTheBodyEndsWithTheNoUrlSentence(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const lines = (h.email.messages[0]?.body ?? "").split("\n");
  assert(lines[4] === "Open Reports & Analytics in TRINETRA to download the files." && lines.length === 5, `got ${JSON.stringify(lines)}`);
}

export async function assertTheBodyCarriesTheHistoryUrlWhenSet(): Promise<void> {
  const h = harness({ config: { historyUrl: "https://bms.example" } });
  await h.service.finish(renderedOutcome());
  const lines = (h.email.messages[0]?.body ?? "").split("\n");
  assert(lines[4] === "Open Reports & Analytics: https://bms.example/reports", `got ${JSON.stringify(lines)}`);
}

export async function assertTheMessageCarriesNoAlarmFields(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const m = h.email.messages[0];
  assert(m !== undefined && m.ruleId === null && m.ruleCode === null && m.alarmId === null && m.severity === null && m.channel.id === CHANNEL_ID, `got ${JSON.stringify(m)}`);
}

// ---------------------------------------------------------------------------
// Phase C — outcomes
// ---------------------------------------------------------------------------

export async function assertNullChannelIsSkippedUnconfigured(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ channelId: null }));
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "skipped_unconfigured" && set.deliveryError === "no channel configured", `got ${JSON.stringify(set)}`);
}

export async function assertNullChannelSendsNothingAndReadsNoChannel(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ channelId: null }));
  assert(!h.calls.includes("email:send") && !h.calls.includes("tx:selectChannel") && h.getKeys.length === 0, `got ${h.calls.join(",")}`);
}

export async function assertAbsentChannelIsUnavailable(): Promise<void> {
  const h = harness({ channel: null });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "skipped_unconfigured" && set.deliveryError === "channel unavailable" && !h.calls.includes("email:send"), `got ${JSON.stringify(set)} after ${h.calls.join(",")}`);
}

export async function assertDisabledChannelIsUnavailable(): Promise<void> {
  const h = harness({ channel: emailChannel({ enabled: false }) });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "skipped_unconfigured" && set.deliveryError === "channel unavailable" && !h.calls.includes("email:send"), `got ${JSON.stringify(set)} after ${h.calls.join(",")}`);
}

export async function assertWebhookChannelIsUnavailable(): Promise<void> {
  const h = harness({ channel: emailChannel({ kind: "webhook", config: { url: "https://hooks.example" } }) });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "skipped_unconfigured" && set.deliveryError === "channel unavailable" && !h.calls.includes("email:send"), `got ${JSON.stringify(set)} after ${h.calls.join(",")}`);
}

export async function assertTheTransportsOwnSkipLandsItsSentence(): Promise<void> {
  const h = harness({ emailResult: { status: "skipped_unconfigured", error: "SMTP_HOST is not set" } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "skipped_unconfigured" && set.deliveryError === "SMTP_HOST is not set", `got ${JSON.stringify(set)}`);
}

export async function assertSentLandsNullError(): Promise<void> {
  const h = harness({ emailResult: { status: "sent", error: null } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "sent" && set.deliveryError === null, `got ${JSON.stringify(set)}`);
}

export async function assertFailedLandsTheCountsOnlySentence(): Promise<void> {
  const h = harness({ emailResult: { status: "failed", error: SMTP_ERROR } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "failed" && set.deliveryError === "email send failed (recipients=2, attachments=2)", `got ${JSON.stringify(set)}`);
}

export async function assertFailedErrorContainsNoAddress(): Promise<void> {
  const h = harness({ emailResult: { status: "failed", error: SMTP_ERROR } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(typeof set.deliveryError === "string" && !set.deliveryError.includes("@") && !set.deliveryError.includes("550"), `got ${JSON.stringify(set.deliveryError)}`);
}

export async function assertOverCeilingSendsWithoutAttachments(): Promise<void> {
  const h = harness({ config: { emailMaxBytes: 1 } });
  await h.service.finish(renderedOutcome());
  assert(h.email.messages[0]?.attachments?.length === 0 && h.getKeys.length === 0, `expected no attachment and no read-back, got ${h.email.messages[0]?.attachments?.length} / ${JSON.stringify(h.getKeys)}`);
}

export async function assertOverCeilingBodySaysSo(): Promise<void> {
  const h = harness({ config: { emailMaxBytes: 1 } });
  await h.service.finish(renderedOutcome());
  const total = PDF_BYTES.length + XLSX_BYTES.length;
  const lines = (h.email.messages[0]?.body ?? "").split("\n");
  assert(lines[lines.length - 1] === `The files (${total} bytes) exceed the attachment ceiling; download them from the history.`, `got ${JSON.stringify(lines)}`);
}

export async function assertOverCeilingIsStillSent(): Promise<void> {
  const h = harness({ config: { emailMaxBytes: 1 } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryStatus === "sent" && set.deliveryError === null, `got ${JSON.stringify(set)}`);
}

/** Strict `>`: a total exactly at the ceiling still attaches (the `>=` mutation reddens here). */
export async function assertATotalAtTheCeilingStillAttaches(): Promise<void> {
  const h = harness({ config: { emailMaxBytes: PDF_BYTES.length + XLSX_BYTES.length } });
  await h.service.finish(renderedOutcome());
  assert(h.email.messages[0]?.attachments?.length === 2, `expected two attachments at the ceiling, got ${h.email.messages[0]?.attachments?.length}`);
}

export async function assertFailedCountsAttachmentsActuallySent(): Promise<void> {
  const h = harness({ config: { emailMaxBytes: 1 }, emailResult: { status: "failed", error: SMTP_ERROR } });
  await h.service.finish(renderedOutcome());
  const { set } = lastUpdate(h);
  assert(set.deliveryError === "email send failed (recipients=2, attachments=0)", `got ${JSON.stringify(set.deliveryError)}`);
}

// ---------------------------------------------------------------------------
// Phase C — the update, the counter, retry idempotency
// ---------------------------------------------------------------------------

export async function assertPhaseCUpdatesTheDeliveredRowsById(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const { where } = lastUpdate(h);
  assert(/"id" in \(\$1, \$2\)/.test(where.sql) && where.params.includes(FILE_PDF) && where.params.includes(FILE_XLSX), `got ${JSON.stringify(where)}`);
}

export async function assertPhaseCRunsInASecondTenantTransactionAfterTheSend(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const sendAt = h.calls.indexOf("email:send");
  const commits = h.calls.map((c, i) => (c === "tx:commit" ? i : -1)).filter((i) => i >= 0);
  assert(h.tenantTransactions() === 2 && commits[0]! < sendAt && sendAt < h.calls.indexOf("tx:update"), `expected read-commit, send, then the update in a second transaction; got ${h.calls.join(",")}`);
}

export async function assertBothTenantTransactionsBindTheOrganization(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const gucs = h.executed.filter((e) => e.sql.includes("set_config"));
  assert(gucs.length === 2 && gucs.every((e) => e.params.includes(ORG_ID)), `got ${JSON.stringify(gucs)}`);
}

export async function assertPhaseCCountsTheDelivery(): Promise<void> {
  const h = harness({ emailResult: { status: "failed", error: SMTP_ERROR } });
  await h.service.finish(renderedOutcome());
  assert(JSON.stringify(h.metrics.deliveries) === JSON.stringify(["failed"]), `got ${JSON.stringify(h.metrics.deliveries)}`);
}

export async function assertRetryDeliversOnlyRowsStillAtNone(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const where = h.deliverableWheres[0];
  assert(
    where !== undefined && /"delivery_status" = \$3/.test(where.sql) && where.params[2] === "none" && where.params[0] === SCHEDULE_ID && where.params[1] === "2026-09-07",
    `expected schedule_id, period_end and delivery_status = 'none', got ${JSON.stringify(where)}`,
  );
}

export async function assertNothingLeftToDeliverSendsNothing(): Promise<void> {
  const h = harness({ deliverable: [] });
  await h.service.finish(renderedOutcome());
  assert(!h.calls.includes("email:send") && h.updates.length === 0 && h.metrics.deliveries.length === 0, `got ${h.calls.join(",")}`);
}

export async function assertDeliveryLogLinesCarryNoNameFilenameOrAddress(): Promise<void> {
  const h = harness({ emailResult: { status: "failed", error: SMTP_ERROR } });
  const { logs, warns } = await capturingLogs(() => h.service.finish(renderedOutcome()));
  const lines = [...logs, ...warns];
  const leaked = lines.filter((l) => l.includes(SCHEDULE_NAME) || l.includes("@") || l.includes("energy-consumption-") || l.includes(OBJECT_KEY_PREFIX));
  assert(lines.length > 0 && leaked.length === 0, `expected id-and-count log lines only, got ${JSON.stringify(lines)}`);
}
