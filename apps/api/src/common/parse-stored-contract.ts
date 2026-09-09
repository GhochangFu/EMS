import { InternalServerErrorException, Logger } from "@nestjs/common";
import { ZodError } from "zod";

/**
 * `F4.108` / **ADR 0060 ruling 2** — parsing data *this application stored*,
 * with a contract violation raised as an explicit server fault.
 *
 * ---
 *
 * ## Why this exists at all, and why it had to land before the filter
 *
 * ADR 0060 registers one global `@Catch(ZodError)` answering **400**. A filter
 * cannot tell who supplied the value it failed on: `ZodError` carries `issues`
 * with a path *inside* the parsed value and nothing about its origin. A
 * controller parse validates what the client sent, so 400 is honest. A service
 * parse of a `*DtoSchema` or of a row's `content` validates what this
 * application itself wrote, on the way back out — when that throws, a row does
 * not match the contract ADR 0030 says every response type is `z.infer`red
 * from. Answering 400 there would tell the caller that the server's own corrupt
 * row is their bad request, and would delete a real fault from every signal
 * that watches for one.
 *
 * So the eight stored-data parses ADR 0060 Amendment 1 enumerates route through
 * here **first**, and only then is the filter registered. What changes at those
 * eight sites is not the status — they answer 500 before and after — it is the
 * **type** of what escapes: an `HttpException` carrying 500, which the filter
 * ignores, instead of a `ZodError`, which the filter would have reclassified.
 *
 * ## Why this is a second helper and not a §4.8 vocabulary split
 *
 * `notifications.controller.ts` declares a local `parse<T>` with the same
 * signature shape and the opposite meaning: it maps a `ZodError` to
 * `BadRequestException(err.flatten())` because it stands on a request path.
 * The two are not one idea spelled twice — they are the two halves of the
 * distinction ruling 2 turns on, and collapsing them would delete it. The name
 * says which half this is.
 *
 * ## Why `apps/api/src/common/`
 *
 * `apps/api/src` had no cross-cutting directory before `F4.108` and every other
 * folder is a domain module. A stored-contract parse belongs to no domain —
 * `admin/` holds five of the eight sites today and would be wrong the first
 * time a sixth module needs it — so the two files ADR 0060 adds (this and
 * `zod-error.filter.ts`) open one.
 */

/**
 * Which contract broke, as an authored literal.
 *
 * **A union rather than `string`, and that is §4.3 enforced by the compiler.**
 * The message below reaches the wire, so a call site that passed
 * `row.name` or `String(err)` would echo stored data into a 500 body.
 * `parseStoredContract(schema, value, row.code)` does not compile.
 *
 * One entry per site, spelled `<module>.<method>.<what>`, because "which of the
 * five `sectionTemplateContentSchema` parses failed" is the only question the
 * fault has to answer. Adding a site means adding a literal here — deliberately
 * a visible edit rather than a free-form string.
 */
export type StoredContractContext =
  | "asset_templates_stock.list.entry"
  | "dashboard_templates.create.empty_content"
  | "dashboard_templates.publish.content"
  | "dashboard_templates.map.dto"
  | "dashboard_templates.map.content"
  | "dashboard_templates.map_summary.content"
  | "dashboard_templates_instantiate.instantiate.content"
  | "dashboard_templates_instantiate.read_back.dto";

const logger = new Logger("StoredContract");

/**
 * The structural schema type `notifications.controller.ts` already uses, rather
 * than `ZodType<T>`: it infers the output without dragging zod's three-parameter
 * generic through every call site, and it keeps the eight sites readable.
 */
export interface StoredContractSchema<T> {
  parse: (value: unknown) => T;
}

/**
 * Parse `value` against `schema`, treating a contract violation as a server
 * fault attributed to `context`.
 *
 * **Nothing from `value` reaches the message or the log**, and the fixture in
 * `parse-stored-contract.spec.ts` is built out of the two zod constructs that
 * *do* echo caller data (`z.enum`, `.strict()`) so that assertion can fail.
 *
 * The log carries the issue **count** and the distinct issue **codes** and not
 * the issue paths. Codes are a closed zod vocabulary (`invalid_type`,
 * `unrecognized_keys`, …) so they are authored text by proxy; a path is not —
 * for a record-shaped schema its segments are keys read out of the row, which
 * is exactly what §9.6 keeps out of a log line. `context` plus the codes says
 * which contract broke and how, and the row itself is one query away for
 * whoever is holding the incident.
 *
 * A non-`ZodError` — the `RangeError` a deep value raises out of a walk, say
 * (`F4.115`) — passes through untouched. Labelling it a contract violation
 * would send the next reader to a schema that is not the problem.
 */
export function parseStoredContract<T>(
  schema: StoredContractSchema<T>,
  value: unknown,
  context: StoredContractContext,
): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (!(err instanceof ZodError)) {
      throw err;
    }
    const codes = [...new Set(err.issues.map((issue) => issue.code))].sort();
    logger.error(
      `Stored data does not match its contract: ${context} ` +
        `(${err.issues.length} issue(s): ${codes.join(", ")})`,
    );
    // 500, deliberately. ADR 0060 ruling 2: the caller did nothing wrong and has
    // no request to correct, so there is no 4xx that would be true.
    throw new InternalServerErrorException(
      `Stored data does not match its contract: ${context}`,
    );
  }
}
