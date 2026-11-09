import {
  MQTT_PAYLOAD_FORMAT_SAMPLE_ENCODINGS,
  hexToBytes,
  mqttPayloadFormatDefinitionSchema,
} from "@bms/shared";
import type { TestMqttPayloadFormatResponse } from "@bms/shared";
import { z, type ZodError, type ZodIssue } from "zod";

import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_RESULT_BUDGET_CHARS, defineReadTool } from "./copilot-read-tool";
import { COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL } from "./list-payload-formats.tool";

/** ADR 0099 Amendment 17 decision 3 (ruling Q3): the largest sample the tool takes, 16 KiB. */
export const DECODE_PAYLOAD_SAMPLE_MAX = 16_384;

/** `F4.343` (ADR 0119 decision 5): a hex sample that is not hex; it names no byte of it. */
export const DECODE_PAYLOAD_SAMPLE_NOT_HEX = "The sample is not hex.";

/** The most schema issues one answer carries. */
const ISSUES_MAX = 20;

/**
 * `decode_payload_sample` (`F4.334` PR 5, ADR 0099 Amendment 17 decisions 2 and 3) — decodes a
 * pasted MQTT sample against a candidate definition with the test route's own decoder
 * (`MqttPayloadFormatsAdminService.test`, `decodeMqttPayload`). It writes nothing, writes no audit
 * row and logs nothing (§9.6): the sample goes back only in the answer.
 *
 * **Global admin only**, refused before the decode, as the test route is. The input is strict and
 * has no credential field (ruling Q3); the sample is at most {@link DECODE_PAYLOAD_SAMPLE_MAX}.
 *
 * **The definition is parsed here**, not by the argument schema: Zod's default messages can quote
 * the value they refuse (an enum's `received '…'`), so the tool answers each issue as its path and
 * a fixed message built from the schema alone ({@link fixedIssues}). A definition that parses is
 * decoded; the answer is `decoded` with the device keys, times and readings, or the decoder's
 * fixed `reason`. The records are fitted to the tool-result budget (`truncated`). No tenant data
 * is read, so it names no organization.
 *
 * `F4.343` (ADR 0119 decision 5): `encoding: "hex"` reads the sample as hex bytes for a `binary`
 * format, the test route's twin; a sample that is not hex is refused with a fixed sentence before
 * any decode. Absent, the sample is text, as before.
 */
export const decodePayloadSampleTool = defineReadTool({
  name: "decode_payload_sample",
  description:
    "Decode a pasted MQTT sample with a payload format definition; stores nothing. The sample is text (JSON) or, with encoding \"hex\", hex bytes (binary formats). Answers the readings or the definition's issues. Global admin only.",
  schema: z
    .object({
      definition: z.record(z.unknown()),
      sample: z.string().max(DECODE_PAYLOAD_SAMPLE_MAX),
      topic: z.string().max(255).optional(),
      encoding: z.enum(MQTT_PAYLOAD_FORMAT_SAMPLE_ENCODINGS).optional(),
    })
    .strict(),
  async run({ mqttPayloadFormats }, args, ctx) {
    if (ctx.identity.role !== "admin") return { ok: false, error: COPILOT_PAYLOAD_FORMATS_ROLE_REFUSAL };
    if (args.sample.length > DECODE_PAYLOAD_SAMPLE_MAX) return { ok: false, error: "The sample is longer than 16 KiB." };
    if (args.encoding === "hex" && hexToBytes(args.sample) === null) return { ok: false, error: DECODE_PAYLOAD_SAMPLE_NOT_HEX };
    const parsed = mqttPayloadFormatDefinitionSchema.safeParse(args.definition);
    if (!parsed.success) {
      return { ok: true, result: { valid: false, issues: fixedIssues(parsed.error) }, organizationIds: [] };
    }
    const response = await mqttPayloadFormats.test(ctx.user, {
      definition: parsed.data,
      topic: args.topic ?? "",
      sample: args.sample,
      ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
    });
    return fitDecode(response);
  },
});

/** The decode as the model reads it, its records cut to the budget (`truncated` first). */
function fitDecode(response: TestMqttPayloadFormatResponse): CopilotToolResult {
  const records = [...response.records];
  let truncated = false;
  const assemble = (): Record<string, unknown> => ({
    valid: true,
    decoded: response.ok,
    ...(response.reason === undefined ? {} : { reason: response.reason }),
    truncated,
    records,
  });
  let result = assemble();
  while (records.length > 0 && JSON.stringify(scrubToolResult(result)).length > COPILOT_TOOL_RESULT_BUDGET_CHARS) {
    records.pop();
    truncated = true;
    result = assemble();
  }
  return { ok: true, result, organizationIds: [] };
}

type FixedIssue = { path: string; message: string };

/** A definition's issues as paths and fixed messages: nothing the caller wrote but the path. */
export function fixedIssues(error: ZodError): FixedIssue[] {
  return error.issues.flatMap(flatten).slice(0, ISSUES_MAX);
}

/** An issue, with a union's issues taken from the branch the definition chose (its `kind`, else the closest). */
function flatten(issue: ZodIssue): FixedIssue[] {
  if (issue.code !== "invalid_union") return [{ path: pathOf(issue.path), message: messageOf(issue) }];
  const branches = issue.unionErrors.map((branch) => branch.issues);
  const literalAt = (issues: ZodIssue[]): ZodIssue | undefined => issues.find((i) => i.code === "invalid_literal");
  const misses = branches.map(literalAt);
  if (misses.every((miss) => miss !== undefined) && new Set(misses.map((miss) => pathOf(miss!.path))).size === 1) {
    const expected = misses.map((miss) => JSON.stringify((miss as Extract<ZodIssue, { code: "invalid_literal" }>).expected));
    return [{ path: pathOf(misses[0]!.path), message: `must be one of ${expected.join(", ")}` }];
  }
  const chosen = branches
    .map((issues, index) => ({ issues, rank: misses[index] === undefined ? issues.length : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank)[0];
  return chosen === undefined ? [{ path: pathOf(issue.path), message: "is not valid" }] : chosen.issues.flatMap(flatten);
}

function pathOf(path: ReadonlyArray<string | number>): string {
  return path.map((segment) => String(segment).slice(0, 64)).join(".") || "(definition)";
}

/** A fixed message from the issue's code and the schema's own bounds — never the refused value. */
function messageOf(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? "is required" : `must be ${issue.expected}`;
    case "invalid_literal":
      return `must be ${JSON.stringify(issue.expected)}`;
    case "invalid_enum_value":
      return `must be one of ${issue.options.map((option) => JSON.stringify(option)).join(", ")}`;
    case "unrecognized_keys":
      return `has unknown fields: ${issue.keys.slice(0, 5).map((key) => key.slice(0, 64)).join(", ")}`;
    case "too_small":
      return `is too small (minimum ${String(issue.minimum)})`;
    case "too_big":
      return `is too big (maximum ${String(issue.maximum)})`;
    case "not_finite":
      return "must be a finite number";
    case "custom":
      // The definition schema's refinements carry fixed sentences of its own.
      return issue.message;
    default:
      return "is not valid";
  }
}
