import { alarmKbResponseSchema, type AlarmKbClass } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { cutToBound } from "../../common/text-bounds";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * The JSON budget of one result's classes, below `TOOL_RESULT_MAX_CHARS` by the
 * room the turn's own wrapping takes (the `MIMIC_LAYOUT_PAGE_BUDGET` figure),
 * so a result never reaches the model cut mid-entry.
 */
export const COPILOT_ALARM_KB_BUDGET = TOOL_RESULT_MAX_CHARS - 1_500;

export const COPILOT_ALARM_KB_WRONG_ORGANIZATION = "The alarm knowledge base returned a class from another organization.";

/** The most classes (index mode) or entries (entries mode) one result names. */
export const COPILOT_ALARM_KB_MAX_ENTRIES = COPILOT_TOOL_LIST_MAX_ITEMS;

export type AlarmKbFilters = {
  readonly templateCode?: string;
  readonly alarmCode?: string;
  readonly query?: string;
};

type KbOut = { classes: Array<Record<string, unknown>>; truncated: boolean };

const sizeOf = (value: unknown): number => JSON.stringify(value).length + 1;

const KB_TEXT_FIELDS = ["message", "cause", "impact", "action"] as const;

/**
 * `entry` with each long text field cut to one share of `room` JSON
 * characters, halving the share until it fits (JSON escaping can widen a
 * string), and `textCut: true`.
 */
function cutEntryToFit(entry: Record<string, unknown>, room: number): Record<string, unknown> {
  let share = Math.floor(room / KB_TEXT_FIELDS.length);
  for (;;) {
    const cut: Record<string, unknown> = { ...entry, textCut: true };
    for (const field of KB_TEXT_FIELDS) {
      const value = entry[field];
      if (typeof value === "string") cut[field] = cutToBound(value, Math.max(share - 64, 0));
    }
    if (sizeOf(cut) <= room || share <= 0) return cut;
    share = Math.floor(share / 2);
  }
}

/**
 * The KB, bounded. With no filter, the **index**: per class its header and
 * alarm codes, at most {@link COPILOT_ALARM_KB_MAX_ENTRIES} classes. With any
 * filter, the matching **entries** with their text, at most that many entries
 * in total. Both modes stop at `budget` JSON characters; what is kept is a
 * prefix in the service's order, and `truncated` says something was dropped.
 * `query` is a case-insensitive substring over the class name and code and the
 * entry's code and message.
 */
export function boundAlarmKb(classes: readonly AlarmKbClass[], filters: AlarmKbFilters, budget: number): KbOut {
  const header = (c: AlarmKbClass) => ({
    templateCode: c.templateCode,
    templateName: c.templateName,
    templateVersion: c.templateVersion,
    domain: c.domain,
    organizationId: c.organizationId,
  });
  const out: KbOut = { truncated: false, classes: [] };
  let chars = 0;
  const indexMode = filters.templateCode === undefined && filters.alarmCode === undefined && filters.query === undefined;
  if (indexMode) {
    for (const c of classes) {
      const entry = { ...header(c), alarmCodes: c.alarms.map((a) => a.alarmCode) };
      const size = sizeOf(entry);
      if (out.classes.length >= COPILOT_ALARM_KB_MAX_ENTRIES || chars + size > budget) {
        out.truncated = true;
        break;
      }
      out.classes.push(entry);
      chars += size;
    }
    return out;
  }
  const query = filters.query?.toLowerCase();
  const alarmCode = filters.alarmCode?.toLowerCase();
  const templateCode = filters.templateCode?.toLowerCase();
  let entries = 0;
  for (const c of classes) {
    if (templateCode !== undefined && c.templateCode.toLowerCase() !== templateCode) continue;
    const classText = `${c.templateName}\n${c.templateCode}`.toLowerCase();
    const matches = c.alarms.filter(
      (a) =>
        (alarmCode === undefined || a.alarmCode.toLowerCase() === alarmCode) &&
        (query === undefined || `${classText}\n${a.alarmCode}\n${a.message ?? ""}`.toLowerCase().includes(query)),
    );
    if (matches.length === 0) continue;
    const kept: Array<Record<string, unknown>> = [];
    let classChars = sizeOf({ ...header(c), alarms: [] });
    for (const a of matches) {
      const entry = {
        alarmCode: a.alarmCode,
        message: a.message,
        severity: a.severity,
        cause: a.cause,
        impact: a.impact,
        action: a.action,
        skillCode: a.skillCode,
        skillLabel: a.skillLabel,
      };
      let size = sizeOf(entry);
      let kept1: Record<string, unknown> = entry;
      if (entries === 0 && chars + classChars + size > budget) {
        // The first entry alone is over the budget (an authored entry may be
        // ~6,500 characters): keep it with its text cut rather than drop it.
        kept1 = cutEntryToFit(entry, budget - chars - classChars);
        size = sizeOf(kept1);
        out.truncated = true;
      }
      if (entries >= COPILOT_ALARM_KB_MAX_ENTRIES || chars + classChars + size > budget) {
        out.truncated = true;
        break;
      }
      kept.push(kept1);
      classChars += size;
      entries += 1;
    }
    if (kept.length > 0) {
      out.classes.push({ ...header(c), alarms: kept });
      chars += classChars;
    }
    if (out.truncated) break;
  }
  return out;
}

const filterText = z.string().min(1).max(80);

/**
 * `get_alarm_kb` (`F4.276`) — `AlarmKbService.list`, the body of
 * `GET /alarm-kb`. The service reads on the BYPASSRLS pool and its argument is
 * the whole tenant filter, so the tool passes the allowed set (or the one
 * requested organization) **intersected with the caller's
 * `readableOrganizationIds`**, as the route does — never `null` (the
 * unrestricted-admin scope) and never `[]` (an empty set answers with no
 * read) — and refuses an answer naming any other organization. The route is unpaginated, so
 * the answer is parsed and then bounded in memory ({@link boundAlarmKb}). The
 * KB text is tenant free text; the turn's scrub walks every string of it.
 */
export const getAlarmKbTool = defineReadTool({
  name: "get_alarm_kb",
  description:
    "Read the alarm knowledge base. No filter: the classes and their alarm codes. templateCode, alarmCode or query " +
    "(matches name, code, message): the entries with cause, impact, action, skill. truncated means more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      templateCode: filterText.optional(),
      alarmCode: filterText.optional(),
      query: filterText.optional(),
    })
    .strict(),
  async run({ access, alarmKb }, args, ctx) {
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const readable = target.ids.length === 0 ? [] : await access.readableOrganizationIds(ctx.user);
    const ids = readable === null ? [...target.ids] : target.ids.filter((id) => readable.includes(id));
    if (ids.length === 0) return { ok: true, result: { truncated: false, classes: [] }, organizationIds: [] };
    const kb = parseStoredContract(alarmKbResponseSchema, await alarmKb.list(ids), "copilot_tools.get_alarm_kb.result");
    if (kb.classes.some((c) => !ids.includes(c.organizationId))) return { ok: false, error: COPILOT_ALARM_KB_WRONG_ORGANIZATION };
    const { organizationId: _requested, ...filters } = args;
    return { ok: true, result: boundAlarmKb(kb.classes, filters, COPILOT_ALARM_KB_BUDGET), organizationIds: ids };
  },
});
