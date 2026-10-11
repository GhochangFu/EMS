import { templateContentSchema } from "@bms/shared";
import type { TemplateContentParsed } from "@bms/shared";
import type { z } from "zod";

/**
 * The `asset_templates.content` contract (ADR 0019, backlog `E1.7`).
 *
 * The schema itself moved to
 * `packages/shared/src/contracts/asset-template-content-writes.ts` in `F3.85`
 * PR 11a (ADR 0099 decision 6, plan §11.3 Unit 1), so the copilot catalog can
 * name the template body by identity. It is re-exported here, so every api
 * importer keeps its `./asset-templates-content.schema` import. What stays is
 * the api's reading of a parsed or stored `content` value.
 */
export {
  MAX_CONTENT_BYTES,
  skillSchema,
  templateContentSchema,
  templateDashboardWidgetVariants,
  templateHealthSchema,
  templateKpiSchema,
  type DtoMatchesParsedContent,
  type ParsedContentMatchesDto,
  type TemplateContentParsed,
} from "@bms/shared";

/**
 * Every point key the content references, in the order encountered.
 *
 * Takes the *parsed* shape, so a caller cannot pass unvalidated JSON and get a
 * silently empty list back — the empty list would read as "no references" and
 * the reference check would pass a template that is entirely broken.
 */
export function collectContentPointRefs(content: TemplateContentParsed): string[] {
  const refs: string[] = [];
  for (const kpi of content.kpis ?? []) {
    refs.push(...kpi.pointKeys);
  }
  for (const alarm of content.alarms ?? []) {
    refs.push(alarm.pointKey);
  }
  for (const view of Object.values(content.dashboards ?? {})) {
    refs.push(...view.featured);
    // F3.1a: a widget's bindings are references too, and this line is what makes ADR 0019's
    // guarantee reach them. `assertContentRefsResolve` calls this from three places —
    // create, update and publish — because `content` and `points` are patched independently
    // and a points patch can orphan a binding the request never mentioned. Omit this walk and
    // all three checks silently stop covering widgets, with nothing in the type system to say
    // so, and ADR 0019 §3's tier promotion becomes a claim rather than a fact.
    for (const widget of view.widgets ?? []) {
      refs.push(...widget.pointKeys);
    }
  }
  // `E1.3`: a weight names a point, so it is a reference like any other. Without
  // this walk a template can weight a point it does not declare, and the weight
  // is then silently ignored by the roll-up — which shifts the score rather than
  // failing, and shifts it in the direction the author was trying to correct.
  //
  // Only the KEYS are references. The values are numbers and belong to the
  // schema above, not here.
  refs.push(...Object.keys(content.health?.weights ?? {}));
  return refs;
}

/**
 * The point keys `content` references that the template does not declare.
 *
 * Deduplicated and sorted so the error message is stable — an author fixing a
 * pack should get the same list twice, and a test should not depend on object
 * iteration order.
 */
export function findUnresolvedContentRefs(
  content: TemplateContentParsed,
  declared: Iterable<string>,
): string[] {
  const available = new Set(declared);
  const missing = new Set(
    collectContentPointRefs(content).filter((ref) => !available.has(ref)),
  );
  return [...missing].sort();
}

/**
 * A stored `content` value re-read under the current contract — `E2.4`.
 *
 * A **result**, never a throw, because the two callers owe different HTTP
 * answers for the same failure. `publish` returns 400 ("PATCH `content` into
 * conformance first" — matched byte for byte by
 * `asset-templates.lifecycle.integration.spec.ts`); `instantiate` returns 409
 * per ADR 0058's D7, because the caller of an instantiate cannot repair a
 * *published* row and must publish a new version instead. A shared throw would
 * force one of them to catch and re-wrap the other's status, and a shared
 * `@nestjs/common` import would drag the framework into a module that is
 * otherwise pure Zod.
 */
export type StoredContentParse =
  | { ok: true; content: TemplateContentParsed }
  | { ok: false; detail: string };

/**
 * Renders a `ZodError` as **structure**, never as values.
 *
 * Stored content on a pre-ADR-0019 row is arbitrary JSON written by whoever,
 * and Zod's own message text echoes the received value back for several issue
 * codes. Paths, unexpected key names and issue codes say everything an author
 * needs in order to fix it, and nothing a caller could use to read a value back
 * out of a row they are not otherwise permitted to read.
 *
 * Our own `custom` messages are kept, because we wrote them, and they are the
 * only place a reserved section explains which backlog item it is waiting for.
 *
 * **They are not uniformly value-free, and the sentence here used to claim they
 * were** — it said they interpolate only a key name and a byte count. Four in
 * the content schema (`packages/shared/src/contracts/asset-template-content-writes.ts`
 * since `F3.85` PR 11a) interpolate a stored value: the duplicate-code message, the two
 * health-band messages, and the calc-expression error. That was already true on
 * `main` for the publish path; what `E2.4` changed is that this renderer gained
 * a second caller, the instantiate refusal. Both callers sit behind the same
 * read gate as `getById`, which returns `content` raw, so nothing crosses a
 * trust boundary — but the comment mattered, because it is cited as a security
 * property and a future author tightening one copy would have trusted it and
 * skipped those four. Add a `custom` message that interpolates a stored value
 * only where that gate still holds.
 *
 * Extracted from `AssetTemplatesAdminService.parseStoredContent` rather than
 * copied. It is a security property, and a second copy is a second thing to
 * remember when the first one is tightened.
 */
export function describeContentIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join(".") || "content";
      if (issue.code === "custom") {
        return `${at}: ${issue.message}`;
      }
      if (issue.code === "unrecognized_keys") {
        return `${at}: unrecognized key(s) ${issue.keys.join(", ")}`;
      }
      return `${at}: ${issue.code}`;
    })
    .join("; ");
}

/**
 * Re-parses a stored `content` column under the current contract.
 *
 * `?? {}` and not a null guard, matching what the publish path has always done:
 * a `NULL` content column is an empty template, and `templateContentSchema`
 * parses `{}` into `{ contentVersion: 1 }`.
 */
export function parseStoredTemplateContent(content: unknown): StoredContentParse {
  const parsed = templateContentSchema.safeParse(content ?? {});
  return parsed.success
    ? { ok: true, content: parsed.data }
    : { ok: false, detail: describeContentIssues(parsed.error) };
}
