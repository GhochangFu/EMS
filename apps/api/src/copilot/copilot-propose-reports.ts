import { HttpException } from "@nestjs/common";

import type { ReportProposalCheckService } from "../reports/report-proposal-check.service";
import { PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR, PROPOSE_REPORT_EMAIL_ON_FOLLOW_UP_ERROR } from "./copilot-outward-intent";
import type { CopilotToolContext } from "./copilot-read-tools";

/**
 * `F4.280` (ADR 0099 Amendment 8 D2, D4, D5, Q14; owner rulings Q2, Q3, Q5) —
 * the propose tools' report step, split from `copilot-propose-tools.ts` (the
 * `copilot-propose-notifications.ts` shape).
 *
 * D4 per field (Q2): the report tools stay offered, and a schedule body that
 * starts email — `channelId` set, or (Q5) `enabled: true` on a schedule whose
 * stored channel is set — is refused in a follow-up turn and in a user turn
 * whose own message did not ask (`reportEmailIntent`, Q3's own switch). The
 * same guard holds for `fill_step`.
 *
 * Before a report card is stored the server runs `ReportProposalCheckService`:
 * the route's own write checks, read-only. A refusal is the route's sentence,
 * returned to the model. The check's note (the channel name and the recipient
 * count only) is appended to the summary, and a schedule's `recipients` (every
 * address in full) are stored under its `cardOnly` key, for the card alone.
 * The file save has no card-only key, so it stores none.
 */

/** The three report entries (`packages/shared/src/copilot/catalog/reports.ts`). */
export const REPORT_ENTRY_IDS: ReadonlySet<string> = new Set(["reportSchedule.create", "reportSchedule.update", "reportFile.save"]);

/** The entries whose body can start email delivery (D4). */
export const REPORT_EMAIL_ENTRY_IDS: ReadonlySet<string> = new Set(["reportSchedule.create", "reportSchedule.update"]);

/** A report proposal on tools built without the check fails closed: nothing is stored. */
export const PROPOSE_REPORTS_UNAVAILABLE_ERROR = "A report change cannot be proposed here. Tell the user to use the Reports page.";

export type CopilotReportChecks = Pick<ReportProposalCheckService, "check" | "startsEmail">;

/**
 * D4: the refusal for a schedule body that starts email outside a user turn that asked, or
 * `null`. A read the check makes (Q5: the stored channel) that the route refuses is the route's
 * sentence; without the check the body is refused (fail closed).
 */
export async function reportEmailRefusal(
  reports: CopilotReportChecks | undefined,
  entryId: string,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  ctx: CopilotToolContext,
): Promise<string | null> {
  if (!REPORT_EMAIL_ENTRY_IDS.has(entryId)) return null;
  if (reports === undefined) return PROPOSE_REPORTS_UNAVAILABLE_ERROR;
  let starts: boolean;
  try {
    starts = await reports.startsEmail({ entryId, params, body, user: ctx.user });
  } catch (err) {
    if (err instanceof HttpException) return err.message;
    throw err;
  }
  if (!starts) return null;
  if (ctx.turnKind === "follow_up") return PROPOSE_REPORT_EMAIL_ON_FOLLOW_UP_ERROR;
  if (ctx.reportEmailIntent !== true) return PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR;
  return null;
}

/** Runs the D4 guard, then the check; an `HttpException` is the route's refusal, any other error is re-thrown. */
export async function checkReport(
  reports: CopilotReportChecks | undefined,
  entryId: string,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  organizationId: string,
  ctx: CopilotToolContext,
): Promise<{ ok: true; note: string; cardBody: Record<string, unknown> } | { ok: false; error: string }> {
  if (reports === undefined) return { ok: false, error: PROPOSE_REPORTS_UNAVAILABLE_ERROR };
  const refused = await reportEmailRefusal(reports, entryId, params, body, ctx);
  if (refused !== null) return { ok: false, error: refused };
  try {
    const { note, recipients } = await reports.check({ entryId, params, body, organizationId, user: ctx.user });
    return { ok: true, note, cardBody: REPORT_EMAIL_ENTRY_IDS.has(entryId) ? { recipients } : {} };
  } catch (err) {
    if (err instanceof HttpException) return { ok: false, error: err.message };
    throw err;
  }
}
