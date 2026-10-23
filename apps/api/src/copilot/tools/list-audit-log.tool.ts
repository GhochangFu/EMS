import { ForbiddenException } from "@nestjs/common";

import { auditLogListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/** The refusal when the audit service's role gate refuses the caller (`resolveReadScope`). */
export const COPILOT_TOOL_AUDIT_ROLE_REFUSED = "The audit log is read only by a provisioned global admin or organization admin.";

/** The refusal of a page past the first when the read spans more than one organization (each has its own offset). */
export const COPILOT_TOOL_AUDIT_PAGE_NEEDS_ONE_ORGANIZATION = "To page past the first page, name one organizationId.";

/** One row's `payload` above this many JSON characters is replaced by a summary. */
export const AUDIT_PAYLOAD_MAX_CHARS = 1_500;

/**
 * The JSON budget of the rows of one result, below `TOOL_RESULT_MAX_CHARS`
 * (8,000) by the room the organization entries and the turn's own wrapping
 * take, so a result never reaches the model cut mid-row.
 */
export const AUDIT_RESULT_BUDGET_CHARS = 6_000;

/** The deepest offset the copilot pages to (the route allows 100,000). */
export const AUDIT_LIST_MAX_OFFSET = 1_000;

const AUDIT_PAYLOAD_MAX_KEYS = 20;

type AuditRow = z.infer<typeof auditLogListResponseSchema>["items"][number];

/** A payload over {@link AUDIT_PAYLOAD_MAX_CHARS} as its size and (for an object) its first top-level keys. */
function boundPayload(payload: unknown): unknown {
  const json = JSON.stringify(payload);
  if (json === undefined || json.length <= AUDIT_PAYLOAD_MAX_CHARS) return payload;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return { omitted: true, chars: json.length, keys: Object.keys(payload).slice(0, AUDIT_PAYLOAD_MAX_KEYS) };
  }
  return { omitted: true, chars: json.length };
}

/**
 * The payload without the acting operator's top-level `oidcSubject`, the same
 * key `AuditAdminService.selectRows` strips in SQL for every reader but the
 * global admin (ADR 0046 Amendment 2). The copilot strips it for every caller:
 * the turn's scrub does not recognise it, and a conversation bound to an
 * own-key organization sends the result to that tenant's provider.
 */
export function withoutActorSubject(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || !("oidcSubject" in payload)) return payload;
  // A filter, not a `{ oidcSubject: _, ...rest }` destructure: `tests/e7.1h-audit-subject-writer-shape`
  // reads every `oidcSubject:` under apps/api/src as an audit write site.
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "oidcSubject"));
}

/**
 * The rows, newest first, with each large payload summarised, kept while their
 * JSON fits in `budgetChars`. The kept rows are a prefix (nothing reordered);
 * `dropped` says a row did not fit.
 */
export function boundAuditRows(
  items: readonly AuditRow[],
  budgetChars: number,
): { rows: AuditRow[]; chars: number; dropped: boolean } {
  const rows: AuditRow[] = [];
  let chars = 0;
  for (const item of items) {
    const row = { ...item, payload: boundPayload(withoutActorSubject(item.payload)) };
    const size = JSON.stringify(row).length + 1;
    if (chars + size > budgetChars) return { rows, chars, dropped: true };
    rows.push(row);
    chars += size;
  }
  return { rows, chars, dropped: false };
}

const isoTimestamp = z.string().datetime({ offset: true });

/**
 * `list_audit_log` (`F4.277`) — `AuditAdminService.list`, the body of
 * `GET /admin/audit`, with the route's own read gate (the global admin or an
 * organization admin with a provisioned row; its `ForbiddenException` becomes
 * {@link COPILOT_TOOL_AUDIT_ROLE_REFUSED}). One read per organization the turn
 * may read, each restricted to that organization (`organizationIds`, ADR 0099
 * decision 10): the row carries no organization, so the restriction is the
 * only thing that keeps an own-key organization's history from the platform
 * provider. A restricted read never shows a `NULL`-organization platform row.
 * The export is not reachable (`CopilotReadServices["audit"]` is `list` only).
 *
 * `payload` is the verbatim request body (ADR 0021): the turn's scrub withholds
 * a value under a secret-named key and a value that looks like a credential.
 * The residual is `E8.5`'s: `rtus.meta` is `z.record(z.unknown())`, so a secret
 * there under an innocent key with an innocent-looking value reaches the model,
 * exactly as it reaches every `GET /admin/audit` reader.
 */
export const listAuditLogTool = defineReadTool({
  name: "list_audit_log",
  description:
    "List audit-log rows, newest first: who did what to which record, with the request body. Filter by entityId (an asset, user, rule...), " +
    "entityType, action, actorId, from/to. Bounded page; total says how many match. offset needs one organizationId. Platform rows with no organization are not shown.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      entityId: z.string().uuid().optional(),
      entityType: z.string().min(1).max(64).optional(),
      action: z.string().min(1).max(64).optional(),
      actorId: z.string().uuid().optional(),
      from: isoTimestamp.optional(),
      to: isoTimestamp.optional(),
      limit: z.number().int().min(1).max(COPILOT_TOOL_LIST_MAX_ITEMS).default(10),
      offset: z.number().int().min(0).max(AUDIT_LIST_MAX_OFFSET).optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      if (args.from !== undefined && args.to !== undefined && Date.parse(args.from) > Date.parse(args.to)) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "is before from" });
      }
    }),
  async run({ audit }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const { organizationId: _requested, limit, offset: requestedOffset, ...filters } = args;
    const offset = requestedOffset ?? 0;
    // Each organization pages on its own, so a shared offset would skip rows of the later ones.
    if (offset > 0 && target.ids.length > 1) return { ok: false, error: COPILOT_TOOL_AUDIT_PAGE_NEEDS_ONE_ORGANIZATION };
    const out = collectByOrganization<AuditRow>();
    let room = limit;
    let budget = AUDIT_RESULT_BUDGET_CHARS;
    let truncated = false;
    for (const organizationId of target.ids) {
      if (room <= 0 || budget <= 0) {
        truncated = true;
        break;
      }
      let stored;
      try {
        stored = await audit.list(ctx.user, { ...filters, limit: room, offset, organizationIds: [organizationId] });
      } catch (error) {
        // The service's role gate is the one refusal; anything else (a database failure) is the tool's error.
        if (error instanceof ForbiddenException) return { ok: false, error: COPILOT_TOOL_AUDIT_ROLE_REFUSED };
        throw error;
      }
      const page = parseStoredContract(auditLogListResponseSchema, stored, "copilot_tools.list_audit_log.page");
      // The entry's own JSON counts against the budget too, so many organizations cannot pass the cut.
      budget -= JSON.stringify({ total: page.total, organizationId, items: [] }).length + 1;
      const bounded = boundAuditRows(page.items, budget);
      const kept = out.add(organizationId, bounded.rows, room, { total: page.total });
      room -= kept;
      budget -= bounded.chars;
      if (bounded.dropped || kept < page.items.length || page.total > offset + kept) truncated = true;
      // A row the budget refused ends the read: no later organization is queried for rows it cannot show.
      if (bounded.dropped) break;
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
