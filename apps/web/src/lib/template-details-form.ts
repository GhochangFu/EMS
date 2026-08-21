import type { AdminAssetTemplateDto } from "@bms/shared";

/**
 * The Details tab's form rules (`F2.5`, ADR 0038 Unit 9a).
 *
 * ## This tab does not touch `content`
 *
 * The plan says all five tabs "read stored `content` and write through
 * `template-content-merge.ts` — never send a partial `content` object". That is
 * true of the KPIs and Alarms tabs, which write `content.kpis[]` and
 * `content.alarms[]`. It is **not** true here, and following it would be wrong.
 *
 * `updateAssetTemplateBodySchema` makes every field optional, and the service
 * resolves each one independently:
 *
 * ```
 * name:        body.name        ?? template.name
 * assetType:   body.assetType   ?? template.assetType
 * domain:      body.domain      ?? template.domain
 * description: body.description !== undefined ? (body.description ?? null) : template.description
 * content:     body.content     ?? (template.content as Record<string, unknown>)
 * ```
 *
 * So a `PATCH` that omits `content` leaves the stored content untouched **on
 * the server**. Round-tripping it through this tab would gain nothing and would
 * put a 256 KiB object on the wire on every name edit — and would drag the
 * `unwritableContentKeys` refusal onto a tab that writes none of the affected
 * keys.
 *
 * ## The four rules, and the server guard behind each
 *
 * 1. **Blank is refused here, not by the server.** `name`, `assetType` and
 *    `domain` are `.min(1)`, so an empty one is a 400. The message the server
 *    returns names a Zod path; this names the field.
 * 2. **An unchanged field is omitted, not resent.** Resending is harmless to
 *    the row — `?? ` only falls back on null/undefined — but `update()` writes
 *    `payload: { ...body }` to `bms.audit_log`. Sending all four every time
 *    makes every audit row claim all four changed, which is the audit trail
 *    saying something untrue.
 * 3. **An emptied description sends `null`, never `""`.** The service
 *    distinguishes them: `!== undefined` means `""` is a *value* and would
 *    store an empty string in a column whose DTO type is `string | null`. A
 *    reader rendering `description ?? "—"` would then show blank instead of the
 *    dash, which reads as a render defect rather than as an empty field.
 * 4. **An empty patch is not sent at all.** `{}` validates, and would bump
 *    `updatedAt` and write an audit row recording no change.
 *
 * Kept in `lib/` because `vitest.config.ts` counts only `apps/web/src/lib/**`
 * toward coverage and `apps/web`'s Vitest project runs `src/**\/*.test.ts` in a
 * node environment — logic left in a `.tsx` is untestable *and* invisible to
 * the gate.
 */

/** What the Details tab's inputs hold. Strings throughout, as the DOM has them. */
export type TemplateDetailsForm = {
  name: string;
  assetType: string;
  domain: string;
  description: string;
};

/**
 * The `PATCH /:id` body this tab sends.
 *
 * `description` is `string | null` and the key is optional: the three states
 * (leave alone / set / clear) are omitted / string / `null`, matching the
 * service's `!== undefined` check exactly.
 */
export type TemplateDetailsPatch = {
  name?: string;
  assetType?: string;
  domain?: string;
  description?: string | null;
};

/** Field limits, mirroring `updateAssetTemplateBodySchema`. */
const LIMITS = { name: 255, assetType: 64, domain: 64, description: 2000 } as const;

/** Seeds the form from the loaded template. `null` description reads as empty. */
export function detailsFormFrom(template: AdminAssetTemplateDto): TemplateDetailsForm {
  return {
    name: template.name,
    assetType: template.assetType,
    domain: template.domain,
    description: template.description ?? "",
  };
}

/**
 * What the author must fix before this can be sent.
 *
 * Keyed by field so the tab can mark the input, and ordered by the form's own
 * order so the first message names the first broken field rather than whichever
 * key the object happened to enumerate first.
 */
export function detailsFormErrors(form: TemplateDetailsForm): Record<string, string> {
  const errors: Record<string, string> = {};

  // Trimmed before the emptiness check: `z.string().min(1)` accepts a single
  // space, so a name of `" "` would be stored and would render as a template
  // with no visible name anywhere in the list.
  if (form.name.trim() === "") {
    errors.name = "A template needs a name.";
  } else if (form.name.trim().length > LIMITS.name) {
    errors.name = `A name is at most ${LIMITS.name} characters.`;
  }

  if (form.assetType.trim() === "") {
    errors.assetType = "A template needs an asset type.";
  } else if (form.assetType.trim().length > LIMITS.assetType) {
    errors.assetType = `An asset type is at most ${LIMITS.assetType} characters.`;
  }

  if (form.domain.trim() === "") {
    errors.domain = "Choose a domain.";
  }

  if (form.description.trim().length > LIMITS.description) {
    errors.description = `A description is at most ${LIMITS.description} characters.`;
  }

  return errors;
}

/**
 * The patch body, carrying only what changed.
 *
 * Comparison is against the **trimmed** value, so adding a trailing space is
 * not a change worth an audit row — and the trimmed value is what gets sent,
 * so it cannot be stored either.
 *
 * Returns `null` when nothing changed, which the caller uses to keep Save
 * disabled. A caller that ignored it and sent `{}` would still be refused by
 * `detailsFormErrors` only if a field were blank — the empty body itself is
 * valid, which is exactly why this reports "nothing to send" rather than
 * leaving the decision to the button.
 */
export function buildDetailsPatch(
  form: TemplateDetailsForm,
  template: AdminAssetTemplateDto,
): TemplateDetailsPatch | null {
  const patch: TemplateDetailsPatch = {};

  const name = form.name.trim();
  if (name !== template.name) {
    patch.name = name;
  }

  const assetType = form.assetType.trim();
  if (assetType !== template.assetType) {
    patch.assetType = assetType;
  }

  const domain = form.domain.trim();
  if (domain !== template.domain) {
    patch.domain = domain;
  }

  // The three-state field. An emptied box is `null`, not `""`; a description
  // that was already absent and is still absent is omitted rather than sent as
  // a redundant `null`.
  const description = form.description.trim();
  const next = description === "" ? null : description;
  if (next !== (template.description ?? null)) {
    patch.description = next;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
