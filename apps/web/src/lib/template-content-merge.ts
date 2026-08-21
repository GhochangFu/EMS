/**
 * Read-merge-write for a template's `content` column (`F2.5`, ADR 0038 —
 * Unit 6).
 *
 * ## The defect this exists to prevent
 *
 * `PATCH /admin/asset-templates/:id` **replaces** `content` wholesale.
 * `updateAssetTemplateBodySchema.content` is optional, but supplying it is not
 * a merge — the column is overwritten with exactly what arrives. The KPIs tab
 * and the Alarms tab both write `content`. If either sent only its own section,
 * the stored `maintenance` plans and `dashboards` views would be **destroyed**
 * — and maintenance authoring is explicitly out of F2.5's scope, so this UI
 * would silently delete content it refuses to even display.
 *
 * So every write starts from the stored object and changes one key.
 *
 * ## The half a merge cannot fix
 *
 * Preserving a key is not the same as being able to write it back.
 * `templateContentSchema` (`asset-templates-content.schema.ts:328`) is
 * `record -> superRefine -> pipe(contentEnvelopeSchema)`, and that envelope is
 * `.strict()`. Its known set is `contentVersion`, `kpis`, `alarms`,
 * `maintenance` and `dashboards`. Anything else is rejected:
 *
 * - a **reserved** key (`health`, `optimisation`) with the server's own message
 *   naming the backlog item it waits for;
 * - a **prototype-pollution** key, refused by `safeKeySchema` on the way in;
 * - any other **unknown** key, refused by `.strict()` as an unrecognized key.
 *
 * The read DTO is deliberately looser — `adminAssetTemplateDtoSchema.content`
 * is `z.record(z.unknown())` so that rows written before ADR 0019 still read.
 * A row can therefore be read and **cannot be written back unchanged**.
 *
 * `mergeTemplateContent` never drops a key to make a request succeed. Dropping
 * it *would be* the silent-destruction defect above, only harder to notice.
 * `unwritableContentKeys` names the problem instead, so the page can say what
 * is wrong before the author fills in a form and collects a 400.
 */
import type { TemplateAlarm, TemplateKpi } from "@bms/shared";

/** The stored column, as the read DTO delivers it. */
export type StoredTemplateContent = Readonly<Record<string, unknown>>;

/** The two sections F2.5 authors. Everything else is carried, not edited. */
export type TemplateContentPatch =
  | { section: "kpis"; value: readonly TemplateKpi[] }
  | { section: "alarms"; value: readonly TemplateAlarm[] };

/**
 * Keys `contentEnvelopeSchema` accepts.
 *
 * Copied rather than imported: the envelope lives in `apps/api`, which
 * `apps/web` does not depend on, and moving it to `@bms/shared` would drag
 * every KPI, alarm, maintenance and dashboard sub-schema across a package
 * boundary to answer a five-string question. `template-content-merge.spec.ts`
 * pins the list so the copy cannot drift unnoticed.
 */
const WRITABLE_KEYS = ["contentVersion", "kpis", "alarms", "maintenance", "dashboards"];

/**
 * `RESERVED_SECTIONS` from `asset-templates-content.schema.ts:142`, with the
 * owning item each one names. One shared message would point an author blocked
 * on `optimisation` at an item three waves earlier.
 */
const RESERVED_KEYS: Readonly<Record<string, string>> = {
  health: "E1.1 (ML serving foundation)",
  optimisation: "E1.6 (optimisation advisories)",
};

/** `UNSAFE_KEYS` from `asset-templates-content.schema.ts:116`. */
const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

/**
 * Copies stored content and replaces one section.
 *
 * Every other key survives byte for byte, including keys this UI does not
 * understand. `contentVersion` is **not** invented where the row lacks it — the
 * envelope's `.default(1)` supplies it server-side, and adding a key here would
 * mean a template gained a field because someone opened its KPIs tab.
 *
 * An empty section array writes `[]`, never deletes the key. "Delete this
 * section" is a different intent and must be asked for, not inferred from the
 * author removing the last row.
 *
 * ## Why the copy is a filtered loop and not a spread
 *
 * Object spread uses `CreateDataPropertyOrThrow`, so `{ ...stored }` carries a
 * `__proto__` **own property** straight through — and `JSON.parse` is what
 * creates one, which is exactly how a stored row would hold it. The unsafe keys
 * are therefore removed explicitly. It is not free, and the plain-looking
 * alternative does not do it.
 *
 * Assignment order matters too: the filter runs first, so `merged[key] = value`
 * can never be reached with `key === "__proto__"` — which would invoke the
 * prototype setter rather than create a property.
 *
 * The dropped keys are reported by `unwritableContentKeys`, which the caller
 * must render. This function refuses silently to nobody.
 */
export function mergeTemplateContent(
  stored: StoredTemplateContent,
  patch: TemplateContentPatch,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(stored)) {
    if (UNSAFE_KEYS.includes(key)) {
      continue;
    }
    merged[key] = stored[key];
  }
  merged[patch.section] = [...patch.value];
  return merged;
}

/** Why a stored key will not survive a write. */
export type UnwritableContentReason = "unsafe" | "reserved" | "unknown";

export type UnwritableContentKey = {
  key: string;
  reason: UnwritableContentReason;
  /** Ready to render — names the key and what the server will do about it. */
  message: string;
};

/**
 * The stored keys that `PATCH` will reject, in the order they appear.
 *
 * Call this on the content the page just read, before offering to save. An
 * empty result means a merged write is accepted; a non-empty one means this
 * template holds content the current contract refuses, and the author needs to
 * be told which key and why rather than shown a 400 whose body lists a key they
 * never typed.
 *
 * This is a **read-side** check on rows that predate ADR 0019. Nothing this UI
 * writes can add a key to the list.
 */
export function unwritableContentKeys(stored: StoredTemplateContent): UnwritableContentKey[] {
  const problems: UnwritableContentKey[] = [];
  for (const key of Object.keys(stored)) {
    if (UNSAFE_KEYS.includes(key)) {
      problems.push({
        key,
        reason: "unsafe",
        message:
          `"${key}" is not a usable key in template content. It cannot be saved and is not ` +
          "carried forward — copy anything you need out of it before saving.",
      });
      continue;
    }
    const owner = RESERVED_KEYS[key];
    if (owner !== undefined) {
      problems.push({
        key,
        reason: "reserved",
        message:
          `"${key}" is reserved for ${owner} and is not yet specified. It is deferred, not ` +
          "dropped — saving this template will be refused until it is removed.",
      });
      continue;
    }
    if (!WRITABLE_KEYS.includes(key)) {
      problems.push({
        key,
        reason: "unknown",
        message:
          `"${key}" is not part of the template content contract. It was stored before the ` +
          "contract tightened, and saving this template will be refused until it is removed.",
      });
    }
  }
  return problems;
}

/**
 * Whether a merged write is worth sending.
 *
 * `false` does not mean the content is corrupt — it reads and it instantiates.
 * It means this template cannot be *edited* until someone removes the offending
 * key, which is a decision for a person and not for a save button.
 */
export function contentCanBeWrittenBack(stored: StoredTemplateContent): boolean {
  return unwritableContentKeys(stored).length === 0;
}
